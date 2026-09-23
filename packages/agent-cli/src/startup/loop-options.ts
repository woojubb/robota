/** Product-owned fallback; it carries no authority beyond the current session permissions. */
export const DEFAULT_LOOP_MAINTENANCE_PROMPT =
  'Resume only the current authorized work, tend its existing PR and checks, and report blockers. ' +
  'Do not start a new initiative or take an irreversible action without its existing authorization.';

export function areSessionLoopsDisabled(env: NodeJS.ProcessEnv): boolean {
  return env['ROBOTA_DISABLE_SESSION_LOOPS'] === '1';
}
