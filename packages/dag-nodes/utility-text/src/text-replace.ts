import { buildTaskExecutionError, type IDagError, type TResult } from '@robota-sdk/dag-core';

/** Visit the virtual split/join output without allocating a split array or output fragments. */
function visitParts(
  text: string, search: string, replacement: string,
  visit: (value: string, start: number, end: number) => boolean,
): boolean {
  if (search === '') {
    for (let index = 0; index < text.length; index++) {
      if (index > 0 && !visit(replacement, 0, replacement.length)) return false;
      if (!visit(text, index, index + 1)) return false;
    }
    return true;
  }
  let start = 0;
  for (;;) {
    const match = text.indexOf(search, start);
    if (match < 0) return visit(text, start, text.length);
    if (!visit(text, start, match) || !visit(replacement, 0, replacement.length)) return false;
    start = match + search.length;
  }
}

/** Literal replacement retains split/join semantics, including empty search and literal dollar signs. */
export function replaceLiteralWithinByteLimit(
  text: string, search: string, replacement: string, maxBytes: number,
): TResult<string, IDagError> {
  let bytes = 0;
  let previousHigh = false;
  const fits = visitParts(text, search, replacement, (value, start, end) => {
    for (let index = start; index < end; index++) {
      const code = value.charCodeAt(index);
      const low = code >= 0xdc00 && code <= 0xdfff;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : low && previousHigh ? 1 : 3;
      previousHigh = code >= 0xd800 && code <= 0xdbff;
      if (bytes > maxBytes) return false;
    }
    return true;
  });
  if (!fits) return { ok: false, error: buildTaskExecutionError(
    'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED',
    'text-replace output exceeds its UTF-8 byte limit', false,
    { maxBytes, nodeType: 'text-replace' },
  ) };
  const parts: string[] = [];
  visitParts(text, search, replacement, (value, start, end) => {
    if (end > start) parts.push(value.slice(start, end));
    return true;
  });
  return { ok: true, value: parts.join('') };
}
