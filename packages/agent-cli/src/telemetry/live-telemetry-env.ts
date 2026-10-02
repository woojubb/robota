/** Canonical environment namespace after the product bootstrap has normalized external aliases. */
export const PRODUCT_TELEMETRY_ENV_PREFIX = 'PRODUCT_TELEMETRY_';

/**
 * Take an immutable snapshot of normalized telemetry settings for one invocation.
 * This function has no process-wide state and never mutates its input; bootstrap owns removing
 * captured keys from child-bound environments and handing the snapshot to a supervised runtime.
 */
export function takeProductTelemetryEnvironment(
  env: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string>> {
  const snapshot: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith(PRODUCT_TELEMETRY_ENV_PREFIX) || value === undefined) continue;
    snapshot[key] = value;
  }
  return Object.freeze(snapshot);
}
