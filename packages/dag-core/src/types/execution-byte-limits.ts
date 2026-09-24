/** Host-owned per-operation ceilings, never read from workflow or queue data. */
export interface IDagExecutionByteLimits {
  readonly maxTextRepeatOutputBytes: number;
  /** Literal replacement only; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextReplaceOutputBytes?: number;
  /** Template expansion; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextTemplateOutputBytes?: number;
  /** Text join expansion; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextJoinOutputBytes?: number;
  /** Text split expansion; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextSplitOutputBytes?: number;
  /** Prefixed transform output; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextTransformOutputBytes?: number;
  /** Unicode uppercase output; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextUpperOutputBytes?: number;
  /** Unicode lowercase output; omitted by older hosts to retain the built-in ceiling. */
  readonly maxTextLowerOutputBytes?: number;
}

/** Keep supported text expansion bounded even when no host policy is supplied. */
export const DEFAULT_DAG_EXECUTION_BYTE_LIMITS: IDagExecutionByteLimits = Object.freeze({
  maxTextRepeatOutputBytes: 4 * 1024 * 1024,
  maxTextReplaceOutputBytes: 4 * 1024 * 1024,
  maxTextTemplateOutputBytes: 4 * 1024 * 1024,
  maxTextJoinOutputBytes: 4 * 1024 * 1024,
  maxTextSplitOutputBytes: 4 * 1024 * 1024,
  maxTextTransformOutputBytes: 4 * 1024 * 1024,
  maxTextUpperOutputBytes: 4 * 1024 * 1024,
  maxTextLowerOutputBytes: 4 * 1024 * 1024,
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
  const maxTextTemplateOutputBytes = limits && 'maxTextTemplateOutputBytes' in limits
    ? limits.maxTextTemplateOutputBytes : 4 * 1024 * 1024;
  if (typeof maxTextTemplateOutputBytes !== 'number' || !Number.isSafeInteger(maxTextTemplateOutputBytes)
    || maxTextTemplateOutputBytes < 0 || maxTextTemplateOutputBytes > 4 * 1024 * 1024) {
    throw new RangeError('maxTextTemplateOutputBytes must be a safe integer between 0 and 4194304');
  }
  const maxTextJoinOutputBytes = limits && 'maxTextJoinOutputBytes' in limits
    ? limits.maxTextJoinOutputBytes : 4 * 1024 * 1024;
  if (typeof maxTextJoinOutputBytes !== 'number' || !Number.isSafeInteger(maxTextJoinOutputBytes)
    || maxTextJoinOutputBytes < 0 || maxTextJoinOutputBytes > 4 * 1024 * 1024) {
    throw new RangeError('maxTextJoinOutputBytes must be a safe integer between 0 and 4194304');
  }
  const maxTextSplitOutputBytes = limits && 'maxTextSplitOutputBytes' in limits
    ? limits.maxTextSplitOutputBytes : 4 * 1024 * 1024;
  if (typeof maxTextSplitOutputBytes !== 'number' || !Number.isSafeInteger(maxTextSplitOutputBytes)
    || maxTextSplitOutputBytes < 0 || maxTextSplitOutputBytes > 4 * 1024 * 1024) {
    throw new RangeError('maxTextSplitOutputBytes must be a safe integer between 0 and 4194304');
  }
  const maxTextTransformOutputBytes = limits && 'maxTextTransformOutputBytes' in limits
    ? limits.maxTextTransformOutputBytes : 4 * 1024 * 1024;
  if (typeof maxTextTransformOutputBytes !== 'number' || !Number.isSafeInteger(maxTextTransformOutputBytes)
    || maxTextTransformOutputBytes < 0 || maxTextTransformOutputBytes > 4 * 1024 * 1024) {
    throw new RangeError('maxTextTransformOutputBytes must be a safe integer between 0 and 4194304');
  }
  const maxTextUpperOutputBytes = limits && 'maxTextUpperOutputBytes' in limits
    ? limits.maxTextUpperOutputBytes : 4 * 1024 * 1024;
  if (typeof maxTextUpperOutputBytes !== 'number' || !Number.isSafeInteger(maxTextUpperOutputBytes)
    || maxTextUpperOutputBytes < 0 || maxTextUpperOutputBytes > 4 * 1024 * 1024) {
    throw new RangeError('maxTextUpperOutputBytes must be a safe integer between 0 and 4194304');
  }
  const maxTextLowerOutputBytes = limits && 'maxTextLowerOutputBytes' in limits
    ? limits.maxTextLowerOutputBytes : 4 * 1024 * 1024;
  if (typeof maxTextLowerOutputBytes !== 'number' || !Number.isSafeInteger(maxTextLowerOutputBytes)
    || maxTextLowerOutputBytes < 0 || maxTextLowerOutputBytes > 4 * 1024 * 1024) {
    throw new RangeError('maxTextLowerOutputBytes must be a safe integer between 0 and 4194304');
  }
  return Object.freeze({
    maxTextRepeatOutputBytes, maxTextReplaceOutputBytes, maxTextTemplateOutputBytes,
    maxTextJoinOutputBytes, maxTextSplitOutputBytes, maxTextTransformOutputBytes,
    maxTextUpperOutputBytes, maxTextLowerOutputBytes,
  });
}
