import { buildTaskExecutionError, type IDagError, type TResult } from '@robota-sdk/dag-core';

type TCaseNodeType = 'text-upper' | 'text-lower';

/** Count case-mapped UTF-8 output before materializing the whole result. */
export function changeCaseWithinByteLimit(
  text: string, maxBytes: number, nodeType: TCaseNodeType,
): TResult<string, IDagError> {
  let bytes = 0;
  let previousHigh = false;
  for (const scalar of text) {
    // Unicode's only locale-independent contextual lowercase mapping is final sigma. Its
    // contextual and ordinary results both occupy two UTF-8 bytes, so scalar mapping is exact
    // for size; the final whole-string conversion still chooses the correct contextual form.
    const mapped = nodeType === 'text-lower' ? scalar.toLowerCase() : scalar.toUpperCase();
    for (let index = 0; index < mapped.length; index++) {
      const code = mapped.charCodeAt(index);
      const low = code >= 0xdc00 && code <= 0xdfff;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : low && previousHigh ? 1 : 3;
      previousHigh = code >= 0xd800 && code <= 0xdbff;
      if (bytes > maxBytes) {
        return { ok: false, error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED',
          `${nodeType} output exceeds its UTF-8 byte limit`, false,
          { maxBytes, nodeType },
        ) };
      }
    }
  }
  return { ok: true, value: nodeType === 'text-lower' ? text.toLowerCase() : text.toUpperCase() };
}
