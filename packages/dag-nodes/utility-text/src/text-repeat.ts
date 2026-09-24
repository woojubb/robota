import { buildTaskExecutionError, type IDagError, type TResult } from '@robota-sdk/dag-core';

interface ITextSize {
  bytes: bigint;
  first: number;
  last: number;
}

function high(code: number): boolean { return code >= 0xd800 && code <= 0xdbff; }
function low(code: number): boolean { return code >= 0xdc00 && code <= 0xdfff; }

/** UTF-8 replacement semantics for unpaired surrogates, without encoding an allocated copy. */
function size(text: string): ITextSize {
  let bytes = 0;
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (high(code) && low(text.charCodeAt(i + 1))) { bytes += 4; i++; }
    else bytes += 3;
  }
  return { bytes: BigInt(bytes), first: text.charCodeAt(0), last: text.charCodeAt(text.length - 1) };
}

function boundarySavings(left: ITextSize, right: ITextSize): bigint {
  return high(left.last) && low(right.first) ? 2n : 0n;
}

function joinedSize(left: ITextSize, right: ITextSize): ITextSize {
  if (left.bytes === 0n) return right;
  if (right.bytes === 0n) return left;
  return { bytes: left.bytes + right.bytes - boundarySavings(left, right), first: left.first, last: right.last };
}

/** Preflight the virtual concatenation before creating a repeated string or intermediate array. */
export function repeatWithinByteLimit(
  text: string, separator: string, times: number, maxBytes: number,
): TResult<string, IDagError> {
  if (times === 0) return { ok: true, value: '' };
  const prefix = size(text);
  const segment = times === 1 ? size('') : joinedSize(size(separator), prefix);
  const copies = BigInt(times - 1);
  const bytes = prefix.bytes + segment.bytes * copies
    - (copies > 0n ? boundarySavings(prefix, segment) : 0n)
    - (copies > 1n ? boundarySavings(segment, segment) * (copies - 1n) : 0n);
  if (bytes > BigInt(maxBytes)) {
    return { ok: false, error: buildTaskExecutionError(
      'DAG_TASK_EXECUTION_BYTE_LIMIT_EXCEEDED',
      'text-repeat output exceeds its UTF-8 byte limit', false,
      { maxBytes, outputBytes: bytes.toString(), nodeType: 'text-repeat' },
    ) };
  }
  if (bytes === 0n) return { ok: true, value: '' };
  if (times === 1) return { ok: true, value: text };
  return { ok: true, value: text + (separator + text).repeat(times - 1) };
}
