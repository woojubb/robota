/**
 * SELFHOST-014 — the single source of the sensitive-key redaction (SSOT).
 *
 * The recursive secret-key scrub used to live privately in `session-logger.ts`, logging-coupled and not exported.
 * It is extracted here so exactly ONE definition of "which keys are sensitive" exists, consumed by BOTH the file
 * session logger (persistence-time redaction) and the SELFHOST-014 share-artifact `redact` transform (an opt-in
 * the app composes). This utility is a pure, mechanism-level key scrub only: it carries NO field/trust-boundary
 * policy (which of `cwd`/`sandboxSnapshotId`/… to strip is an app decision) and is NEVER forced into the
 * full-fidelity local round-trip.
 */

/** Values a scrub can walk (mirrors the logger's log-value shape; avoids `any`/`unknown`). */
export type TScrubbableValue = string | number | boolean | object | null | undefined;

const DEFAULT_REDACTED_VALUE = '[REDACTED]';

/**
 * Keys whose VALUE is a secret and must be redacted before persistence or sharing:
 * `apiKey`/`authorization`/`accessToken`/`refreshToken`/`secret`/`password`/`xApiKey` (case/`-`/`_`-insensitive).
 */
export const SENSITIVE_KEY_PATTERN =
  /^(api[-_]?key|authorization|access[-_]?token|refresh[-_]?token|secret|password|x[-_]?api[-_]?key)$/i;

/** True when a key's value should be redacted. The one predicate both the logger and the artifact scrub use. */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

function scrubValue(
  key: string | undefined,
  value: TScrubbableValue,
  redactedValue: string,
): TScrubbableValue {
  if (key !== undefined && isSensitiveKey(key)) {
    return redactedValue;
  }
  if (Array.isArray(value)) {
    return value.map((item) => scrubValue(undefined, item as TScrubbableValue, redactedValue));
  }
  // A Date (or any non-plain object without own enumerable keys) is returned as-is by the Object.entries walk.
  if (value !== null && typeof value === 'object' && !(value instanceof Date)) {
    const record = value as Record<string, TScrubbableValue>;
    const out: Record<string, TScrubbableValue> = {};
    for (const [childKey, childValue] of Object.entries(record)) {
      out[childKey] = scrubValue(childKey, childValue, redactedValue);
    }
    return out;
  }
  return value;
}

/**
 * Deep-copy `value`, replacing any value whose KEY is sensitive with `redactedValue` (default `[REDACTED]`).
 * Pure — does not mutate the input. Returns the same shape (`T`).
 */
export function scrubSensitiveKeys<T>(value: T, redactedValue: string = DEFAULT_REDACTED_VALUE): T {
  return scrubValue(undefined, value as TScrubbableValue, redactedValue) as T;
}
