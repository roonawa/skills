import { createHash } from 'node:crypto';
import type { CheckResult } from './adapter.js';
import { checked, content } from './files.js';

/** One issue the reviewing AI found. Summaries are written for the human handoff, so they must not contain secrets. */
export interface Finding {
  kind?: 'deviation' | 'excess';
  ref: string;
  file: string;
  summary: string;
}
export type RecordedFinding = Finding & {fingerprint: string};

// security: vulnerabilities and unsafe handling. spec: deviation from the specification and over-implementation.
export const REVIEW_GATES = ['security', 'spec'] as const;
const maxFindings = 30;
const maxNotes = 10;
/** Thrown for a reason the reviewer can act on; other parse errors share one generic message. */
class ReviewInputError extends Error {}
const control = /[\u0000-\u001f\u007f]/;

export function findingFingerprint(gate: string, finding: Finding): string {
  // The summary wording changes between reviews, so only the classification identifies the same issue.
  return createHash('sha256').update(JSON.stringify([gate, finding.kind ?? '', finding.ref, finding.file])).digest('hex');
}

/** Returns the finding when valid. Rejects unknown keys so that unreviewed data does not reach the records. */
export function parseFinding(gate: string, value: unknown): Finding {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
  const {kind, ref, file, summary, ...rest} = value as Record<string, unknown>;
  if (Object.keys(rest).length) throw new Error();
  if (gate === 'spec' ? kind !== 'deviation' && kind !== 'excess' : kind !== undefined) throw new Error();
  if (kind !== undefined && kind !== 'deviation' && kind !== 'excess') throw new Error();
  if (typeof ref !== 'string' || !/^[A-Za-z0-9._:-]{1,64}$/.test(ref)) throw new Error();
  if (typeof file !== 'string' || !file.length || file.length > 200 || control.test(file)) throw new Error();
  if (typeof summary !== 'string' || !summary.trim() || summary.length > 300 || control.test(summary)) throw new Error();
  return kind === undefined ? {ref, file, summary} : {kind, ref, file, summary};
}

function parseGate(gate: string, value: unknown): CheckResult {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error();
  const {status, findings, ...rest} = value as Record<string, unknown>;
  if (Object.keys(rest).length || !Array.isArray(findings) || findings.length > maxFindings) throw new Error();
  const parsed = findings.map(finding => parseFinding(gate, finding));
  // The CLI identifies a finding by kind, ref and file, so two entries with the same three would count as one.
  const keys = parsed.map(finding => findingFingerprint(gate, finding));
  if (new Set(keys).size !== keys.length) {
    throw new ReviewInputError('レビュー結果の ' + gate + ' に、種類・ref・file が同じ指摘が重複しています。1件の summary にまとめてください。');
  }
  // A failed gate needs a reason, and a passed gate must not hide open findings.
  if (status === 'passed' && !parsed.length) return {name:gate, status};
  if (status === 'failed' && parsed.length) return {name:gate, status, findings:parsed};
  throw new Error();
}

/**
 * Validates review notes: points a person must decide that do not block the gate (an unclear specification,
 * an assumption). They reach the handoff and the result, so the same limits as summaries apply.
 */
export function parseNotes(value: unknown): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maxNotes) throw new Error();
  return value.map(note => {
    if (typeof note !== 'string' || !note.trim() || note.length > 300 || control.test(note)) throw new Error();
    return note;
  });
}

export interface ReviewResult {checks: CheckResult[]; notes: string[]}

/** Reads the AI review result for the security and spec gates. Invalid input is rejected before an attempt is reserved. */
export function readReview(root: string, relative: string): ReviewResult {
  const text = content(checked(root, relative));
  if (text === undefined) throw new Error('レビュー結果のファイルがありません: ' + relative);
  try {
    const data: unknown = JSON.parse(text);
    if (typeof data !== 'object' || data === null || Array.isArray(data)) throw new Error();
    const {notes, ...gates} = data as Record<string, unknown>;
    if (Object.keys(gates).sort().join() !== [...REVIEW_GATES].sort().join()) throw new Error();
    return {checks:REVIEW_GATES.map(gate => parseGate(gate, gates[gate])), notes:parseNotes(notes)};
  } catch (error) {
    if (error instanceof ReviewInputError) throw new Error(error.message);
    throw new Error('レビュー結果の形式が不正です。security と spec の status・findings、任意の notes を確認してください。');
  }
}
