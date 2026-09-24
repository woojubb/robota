import { buildTaskExecutionError, type IDagError, type TResult } from '@robota-sdk/dag-core';

/** Uppercase mapping is per Unicode code point; count its virtual output before materializing it. */
export function uppercaseWithinByteLimit(text: string, maxBytes: number): TResult<string, IDagError> {
  let bytes = 0;
  let previousHigh = false;
  for (const scalar of text) {
    const upper = scalar.toUpperCase();
    for (let index = 0; index < upper.length; index++) {
      const code = upper.charCodeAt(index);
      const low = code >= 0xdc00 && code <= 0xdfff;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : low && previousHigh ? 1 : 3;
      previousHigh = code >= 0xd800 && code <= 0xdbff;
      if (bytes > maxBytes) {
        return { ok: false, error: buildTaskExecutionError(
          'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED',
          'text-upper output exceeds its UTF-8 byte limit', false,
          { maxBytes, nodeType: 'text-upper' },
        ) };
      }
    }
  }
  return { ok: true, value: text.toUpperCase() };
}
