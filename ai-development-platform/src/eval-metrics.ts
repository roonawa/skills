import type { Scenario } from './scenarios.js';

const arms = ['withSkill','withoutSkill'] as const;
type Arm = typeof arms[number];
interface Observation {
  decision:string; rubricMet:boolean; taskSucceeded:boolean; testsPassed:number; testsTotal:number;
  reviewFindings:number; elapsedMs:number; retries:number; costUsd:number|null;
  selectedSkills:string[]; reused:number; reuseOpportunities:number;
}

function object(value: unknown): Record<string,unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('観測値には JSON オブジェクトを指定してください。');
  return value as Record<string,unknown>;
}
function count(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) throw new Error('件数・時間には非負の整数が必要です。');
  return value;
}
function flag(value: unknown): boolean {
  if (typeof value !== 'boolean') throw new Error('実測した判定を true または false で入力してください。');
  return value;
}
function tag(value: unknown): string {
  if (typeof value !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,95}$/.test(value)) throw new Error('実行条件には短い識別名を指定してください。');
  return value;
}
function observation(input: unknown): Observation {
  const v = object(input);
  const testsPassed = count(v.testsPassed), testsTotal = count(v.testsTotal);
  const reused = count(v.reused), reuseOpportunities = count(v.reuseOpportunities);
  if (testsPassed > testsTotal || reused > reuseOpportunities) throw new Error('分子が分母を超えています。');
  if (!Array.isArray(v.selectedSkills)) throw new Error('selectedSkills は配列で指定してください。');
  const selectedSkills = v.selectedSkills.map(tag);
  if (new Set(selectedSkills).size !== selectedSkills.length) throw new Error('選択 Skill が重複しています。');
  if (v.costUsd !== null && (typeof v.costUsd !== 'number' || !Number.isFinite(v.costUsd) || v.costUsd < 0)) throw new Error('costUsd は非負の金額または null です。');
  return {decision:tag(v.decision),rubricMet:flag(v.rubricMet),taskSucceeded:flag(v.taskSucceeded),
    testsPassed,testsTotal,reused,reuseOpportunities,reviewFindings:count(v.reviewFindings),
    elapsedMs:count(v.elapsedMs),retries:count(v.retries),costUsd:v.costUsd,selectedSkills};
}
function rate(numerator:number, denominator:number) {
  return {numerator,denominator,rate:denominator ? numerator/denominator : null};
}
function summarize(rows:Observation[], decisions:number) {
  const sum = (field:'testsPassed'|'testsTotal'|'reused'|'reuseOpportunities'|'reviewFindings'|'elapsedMs'|'retries') =>
    rows.reduce((total,row)=>total+row[field],0);
  const skills:Record<string,number> = Object.create(null);
  for (const row of rows) for (const name of row.selectedSkills) skills[name]=(skills[name] ?? 0)+1;
  return {decisionAndRubric:rate(decisions,rows.length),taskSuccess:rate(rows.filter(row=>row.taskSucceeded).length,rows.length),
    tests:rate(sum('testsPassed'),sum('testsTotal')),reuse:rate(sum('reused'),sum('reuseOpportunities')),
    reviewFindings:sum('reviewFindings'),elapsedMs:sum('elapsedMs'),retries:sum('retries'),skillUsage:skills,
    costUsd:rows.some(row=>row.costUsd===null) ? null : rows.reduce((total,row)=>total+(row.costUsd ?? 0),0)};
}

export function scoreObservations(input:unknown, fixture:string, name:string, cases:Scenario[]) {
  const v=object(input);
  if (v.fixture !== fixture || v.schemaVersion !== 1 || !Array.isArray(v.cases) || v.cases.length !== cases.length) throw new Error('fixture、schemaVersion、ケース数を確認してください。');
  const conditions={host:tag(v.host),model:tag(v.model),budget:tag(v.budget)};
  const byId=new Map(v.cases.map(value=>{const row=object(value);return [row.id,row] as const;}));
  const observations:Record<Arm,Observation[]>={withSkill:[],withoutSkill:[]};
  const successes={withSkill:0,withoutSkill:0};
  const results=cases.map(scenario=>{
    const row=byId.get(scenario.id);
    if (!row) throw new Error('評価ケースが不足または重複しています。');
    const passed={withSkill:false,withoutSkill:false};
    for (const arm of arms) {
      const value=observation(row[arm]);
      if (arm==='withoutSkill' && value.selectedSkills.includes(name)) throw new Error('対照群で対象 Skill が使われています。');
      observations[arm].push(value);
      passed[arm]=value.decision===scenario.expected && value.rubricMet;
      if (passed[arm]) successes[arm]++;
    }
    return {id:scenario.id,passed,withSkill:observations.withSkill.at(-1),withoutSkill:observations.withoutSkill.at(-1)};
  });
  const withSkill=summarize(observations.withSkill,successes.withSkill);
  const withoutSkill=summarize(observations.withoutSkill,successes.withoutSkill);
  return {source:'operator-observations',conditions,results,withSkill,withoutSkill,
    decisionPassCountDelta:successes.withSkill-successes.withoutSkill,
    improvementCandidates:cases.filter((_,i)=>!results[i].passed.withSkill).map(s=>({id:s.id,review:s.rubric}))};
}
