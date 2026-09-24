/**
 * Robota telemetry settings can carry collector credentials. The CLI takes them out of the
 * environment it was started with, so no child process (shell, hook, subagent worker, MCP server)
 * inherits them; the one deliberate handover is the supervised runtime a session command launches.
 */
export function takeRobotaTelemetryEnvironment(
  env: NodeJS.ProcessEnv = process.env,
): Readonly<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const key of Object.keys(env)) {
    if (!key.startsWith('ROBOTA_TELEMETRY_')) continue;
    const value = env[key];
    if (value !== undefined) snapshot[key] = value;
    delete env[key];
  }
  return Object.freeze(snapshot);
}
