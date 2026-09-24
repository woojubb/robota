import { buildTaskExecutionError, type IDagError, type TResult } from '@robota-sdk/dag-core';

type TVisit = (source: string, start: number, end: number) => boolean;
type TWalk = (visit: TVisit) => boolean;

const WHITESPACE = /\s/u;

/** JavaScript trim semantics over a source range, without copying the range. */
function trimBounds(source: string, start: number, end: number): [number, number] {
  let first = start;
  let last = end;
  while (first < last && WHITESPACE.test(source[first]!)) first++;
  while (last > first && WHITESPACE.test(source[last - 1]!)) last--;
  return [first, last];
}

/** Measure a virtual output across fragment boundaries before constructing the result. */
function renderWithinByteLimit(
  walk: TWalk, maxBytes: number, nodeType: 'text-join' | 'text-split',
): TResult<string, IDagError> {
  let bytes = 0;
  let previousHigh = false;
  const fits = walk((source, start, end) => {
    for (let index = start; index < end; index++) {
      const code = source.charCodeAt(index);
      const low = code >= 0xdc00 && code <= 0xdfff;
      bytes += code < 0x80 ? 1 : code < 0x800 ? 2 : low && previousHigh ? 1 : 3;
      previousHigh = code >= 0xd800 && code <= 0xdbff;
      if (bytes > maxBytes) return false;
    }
    return true;
  });
  if (!fits) return { ok: false, error: buildTaskExecutionError(
    'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED',
    `${nodeType} output exceeds its UTF-8 byte limit`, false,
    { maxBytes, nodeType },
  ) };
  let output = '';
  walk((source, start, end) => { output += source.slice(start, end); return true; });
  return { ok: true, value: output };
}

/** Preserve split/filter/join semantics while visiting only admitted lines. */
export function joinLinesWithinByteLimit(
  items: string, separator: string, maxBytes: number,
): TResult<string, IDagError> {
  const walk: TWalk = (visit) => {
    let start = 0;
    let emitted = false;
    for (;;) {
      const boundary = items.indexOf('\n', start);
      const end = boundary < 0 ? items.length : boundary;
      const [trimmedStart, trimmedEnd] = trimBounds(items, start, end);
      if (trimmedStart < trimmedEnd) {
        if (emitted && !visit(separator, 0, separator.length)) return false;
        if (!visit(items, start, end)) return false;
        emitted = true;
      }
      if (boundary < 0) return true;
      start = boundary + 1;
    }
  };
  return renderWithinByteLimit(walk, maxBytes, 'text-join');
}

/** Preserve JavaScript split semantics, including empty separators and surrogate halves. */
export function splitTextWithinByteLimit(
  text: string, separator: string, trim: boolean, maxBytes: number,
): TResult<string, IDagError> {
  const walk: TWalk = (visit) => {
    let emitted = false;
    const emit = (start: number, end: number): boolean => {
      const [partStart, partEnd] = trim ? trimBounds(text, start, end) : [start, end];
      if (trim && partStart === partEnd) return true;
      if (emitted && !visit('\n', 0, 1)) return false;
      if (!visit(text, partStart, partEnd)) return false;
      emitted = true;
      return true;
    };
    if (separator === '') {
      for (let index = 0; index < text.length; index++) {
        if (!emit(index, index + 1)) return false;
      }
      return true;
    }
    let start = 0;
    for (;;) {
      const boundary = text.indexOf(separator, start);
      if (boundary < 0) return emit(start, text.length);
      if (!emit(start, boundary)) return false;
      start = boundary + separator.length;
    }
  };
  return renderWithinByteLimit(walk, maxBytes, 'text-split');
}
