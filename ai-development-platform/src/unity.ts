import type { CheckResult } from './adapter.js';
import { checked, content } from './files.js';

const editor = '2022.3.62f1';
const framework = '1.4.6';
const stages = ['EditMode', 'PlayMode', 'build'] as const;
type MockRunner = (stage: typeof stages[number]) => Omit<CheckResult, 'name'>;

function checkProject(root: string): CheckResult {
  const name = 'Unity project';
  try {
    const version = content(checked(root, 'ProjectSettings/ProjectVersion.txt'));
    if (version?.match(/^m_EditorVersion:[ \t]*(\S+)[ \t]*\r?$/m)?.[1] !== editor) {
      return {name, status: 'failed', detail: 'ProjectSettings/ProjectVersion.txt に Editor ' + editor + ' を指定してください。'};
    }
    const manifest = content(checked(root, 'Packages/manifest.json'));
    if (!manifest || JSON.parse(manifest)?.dependencies?.['com.unity.test-framework'] !== framework) {
      return {name, status: 'failed', detail: 'Packages/manifest.json に com.unity.test-framework ' + framework + ' を指定してください。'};
    }
    return {name, status: 'passed', detail: 'Editor ' + editor + ' / Test Framework ' + framework + ' の設定を確認しました。'};
  } catch {
    return {name, status: 'failed', detail: 'ProjectVersion.txt と manifest.json の形式・読み取り権限を確認してください。'};
  }
}

export function checkUnity(root: string, mockRunner?: MockRunner): CheckResult[] {
  const project = checkProject(root);
  const results: CheckResult[] = [project];
  for (const name of stages) {
    if (project.status === 'failed') {
      results.push({name, status: 'unavailable', detail: project.detail});
    } else if (mockRunner) {
      const result = mockRunner(name);
      results.push({name, status: result.status, detail: 'mock: ' + (result.detail ?? result.status)});
    } else {
      results.push({name, status: 'unavailable', detail: 'Editor ' + editor + ' で実機検証済みのランナーがありません。'});
    }
  }
  return results;
}
