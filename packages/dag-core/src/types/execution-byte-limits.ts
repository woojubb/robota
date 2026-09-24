/** Host-owned per-operation ceilings, never read from workflow or queue data. */
export interface IDagExecutionByteLimits {
  readonly maxTextRepeatOutputBytes: number;
}

/** Keep text-repeat allocations bounded even when no host policy is supplied. */
export const DEFAULT_DAG_EXECUTION_BYTE_LIMITS: IDagExecutionByteLimits = Object.freeze({
  maxTextRepeatOutputBytes: 4 * 1024 * 1024,
});

/** Snapshot a trusted host policy; hosts may tighten the built-in ceiling. */
export function resolveDagExecutionByteLimits(
  limits?: IDagExecutionByteLimits,
): IDagExecutionByteLimits {
  const maxTextRepeatOutputBytes = limits?.maxTextRepeatOutputBytes
    ?? DEFAULT_DAG_EXECUTION_BYTE_LIMITS.maxTextRepeatOutputBytes;
  if (!Number.isSafeInteger(maxTextRepeatOutputBytes) || maxTextRepeatOutputBytes < 0
    || maxTextRepeatOutputBytes > DEFAULT_DAG_EXECUTION_BYTE_LIMITS.maxTextRepeatOutputBytes) {
    throw new RangeError('maxTextRepeatOutputBytes must be a safe integer between 0 and 4194304');
  }
  return Object.freeze({ maxTextRepeatOutputBytes });
}
