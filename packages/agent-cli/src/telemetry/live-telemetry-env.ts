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

/**
 * Settings resolve under their canonical names, where the product bootstrap has already folded the
 * product's own alias: the operator only ever set the alias. A refusal therefore names the alias
 * the running product accepts, by putting `envPrefix` in place of the canonical namespace on the
 * way out. Which variables are read is not affected. Without a prefix (a caller that has no product
 * identity) the canonical names are the only names there are, and the error passes unchanged.
 */
export function nameAcceptedTelemetryVariables<T>(
  envPrefix: string | undefined,
  resolve: () => T,
): T {
  try {
    return resolve();
  } catch (error) {
    if (envPrefix === undefined || !(error instanceof Error)) throw error;
    throw new Error(
      error.message.replaceAll(PRODUCT_TELEMETRY_ENV_PREFIX, () => `${envPrefix}TELEMETRY_`),
    );
  }
}
