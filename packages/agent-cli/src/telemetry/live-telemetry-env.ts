/**
 * Robota telemetry settings can carry collector credentials. The CLI takes them out of the
 * environment it was started with, so no child process (shell, hook, subagent worker, MCP server)
 * inherits them; the one deliberate handover is the supervised runtime a session command launches.
 *
 * A later in-process call (an embedding host, or a test, that starts the CLI more than once in the
 * same process) never gets the settings back into `process.env` — but it still needs them, since a
 * previous call already stripped whatever was there. The most recently captured non-empty settings
 * are kept in memory, as a whole, for the lifetime of the process, and reused only when a later call
 * sets NONE of its own: a destination and the credentials configured for it always come from the
 * same call. They are never mixed key-by-key across calls — that would let a header configured for
 * one destination reach a different one a later call names, or let an endpoint from an earlier call
 * outlive the settings it was part of. A later call that sets ANY `ROBOTA_TELEMETRY_*` key — even
 * only `ROBOTA_TELEMETRY_ENABLED=0` — uses only its own settings, whole, and that becomes what the
 * next empty call reuses.
 */
let retainedSnapshot: Readonly<Record<string, string>> | undefined;

export function takeRobotaTelemetryEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  const current: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    if (!key.startsWith('ROBOTA_TELEMETRY_')) continue;
    const value = env[key];
    if (value !== undefined) current[key] = value;
    delete env[key];
  }
  if (Object.keys(current).length > 0) {
    retainedSnapshot = Object.freeze(current);
    return retainedSnapshot;
  }
  return retainedSnapshot ?? Object.freeze(current);
}
