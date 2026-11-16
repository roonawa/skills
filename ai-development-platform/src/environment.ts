/**
 * Environment for processes that run project code (AI sessions and the gate's npm scripts). The project code may
 * have been written by an AI session, so credentials in the caller's environment must not reach it.
 * Names are matched broadly; `keep` lists the few a process cannot start without.
 */
const credential = /TOKEN|SECRET|PASSW|CREDENTIAL|API_?KEY|PRIVATE|COOKIE|AUTH|CHUB|GITEA/i;

export function withoutCredentials(source: NodeJS.ProcessEnv, keep: readonly string[] = []): NodeJS.ProcessEnv {
  const kept = new Set(keep);
  return Object.fromEntries(Object.entries(source).filter(([name]) => kept.has(name) || !credential.test(name)));
}
