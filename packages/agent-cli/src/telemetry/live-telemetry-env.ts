/**
 * Robota telemetry settings can carry collector credentials. The CLI takes them out of the
 * environment it was started with, so no child process (shell, hook, subagent worker, MCP server)
 * inherits them; the one deliberate handover is the supervised runtime a session command launches.
 *
 * A later in-process call (an embedding host, or a test, that starts the CLI more than once in the
 * same process) never gets the settings back into `process.env` — but it still needs them, since the
 * first call already stripped whatever was there. The settings the very first call captured are kept
 * in memory for the lifetime of the process and merged under whatever the caller has explicitly set
 * again by the time of a later call, key by key, with the later call's own value winning.
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
  if (retainedSnapshot === undefined) {
    retainedSnapshot = Object.freeze(current);
    return retainedSnapshot;
  }
  return Object.freeze({ ...retainedSnapshot, ...current });
}
