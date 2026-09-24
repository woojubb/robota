/** Host-owned per-operation ceilings, never read from workflow or queue data. */
export interface IDagExecutionByteLimits {
  readonly maxTextRepeatOutputBytes: number;
  /** Literal replacement only; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextReplaceOutputBytes?: number;
}

/** Keep text-repeat allocations bounded even when no host policy is supplied. */
export const DEFAULT_DAG_EXECUTION_BYTE_LIMITS: IDagExecutionByteLimits = Object.freeze({
  maxTextRepeatOutputBytes: 4 * 1024 * 1024,
  maxTextReplaceOutputBytes: 4 * 1024 * 1024,
});

/** Snapshot a trusted host policy; hosts may tighten the built-in ceiling. */
export function resolveDagExecutionByteLimits(
  limits?: IDagExecutionByteLimits,
): Required<IDagExecutionByteLimits> {
  const maxTextRepeatOutputBytes = limits === undefined
    ? DEFAULT_DAG_EXECUTION_BYTE_LIMITS.maxTextRepeatOutputBytes
    : limits.maxTextRepeatOutputBytes;
  if (!Number.isSafeInteger(maxTextRepeatOutputBytes) || maxTextRepeatOutputBytes < 0
    || maxTextRepeatOutputBytes > DEFAULT_DAG_EXECUTION_BYTE_LIMITS.maxTextRepeatOutputBytes) {
    throw new RangeError('maxTextRepeatOutputBytes must be a safe integer between 0 and 4194304');
  }
  const maxTextReplaceOutputBytes = limits && 'maxTextReplaceOutputBytes' in limits
    ? limits.maxTextReplaceOutputBytes : 4 * 1024 * 1024;
  if (typeof maxTextReplaceOutputBytes !== 'number' || !Number.isSafeInteger(maxTextReplaceOutputBytes)
    || maxTextReplaceOutputBytes < 0 || maxTextReplaceOutputBytes > 4 * 1024 * 1024) {
    throw new RangeError('maxTextReplaceOutputBytes must be a safe integer between 0 and 4194304');
  }
  return Object.freeze({ maxTextRepeatOutputBytes, maxTextReplaceOutputBytes });
}
