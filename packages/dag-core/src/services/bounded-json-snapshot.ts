/** Encode JSON data while bounding the final UTF-8 snapshot before it is materialized. */
export function encodeBoundedJsonSnapshot(value: unknown, maxBytes: number): string | undefined {
  const chunks: string[] = [];
  let pending = '';
  let bytes = 0;
  const append = (part: string, size: number): void => {
    if (size > maxBytes - bytes) throw LIMIT;
    bytes += size;
    pending += part;
    if (pending.length >= 8192) {
      chunks.push(pending);
      pending = '';
    }
  };
  const string = (value: string): void => {
    append('"', 1);
    for (let index = 0; index < value.length; index++) {
      const code = value.charCodeAt(index);
      if (code === 0x22 || code === 0x5c) append(`\\${value[index]}`, 2);
      else if (code < 0x20) {
        const escaped = SHORT_ESCAPES[code] ?? `\\u${code.toString(16).padStart(4, '0')}`;
        append(escaped, escaped.length);
      } else if (code < 0x80) append(value[index]!, 1);
      else if (code < 0x800) append(value[index]!, 2);
      else if (code >= 0xd800 && code <= 0xdbff && index + 1 < value.length &&
        value.charCodeAt(index + 1) >= 0xdc00 && value.charCodeAt(index + 1) <= 0xdfff) {
        append(value.slice(index, index + 2), 4);
        index++;
      } else if (code >= 0xd800 && code <= 0xdfff) {
        append(`\\u${code.toString(16)}`, 6);
      } else append(value[index]!, 3);
    }
    append('"', 1);
  };
  const active = new Set<object>();
  const write = (item: unknown, depth: number): void => {
    if (depth > 256) throw INVALID;
    if (item === null) return append('null', 4);
    if (typeof item === 'string') return string(item);
    if (typeof item === 'boolean') return append(item ? 'true' : 'false', item ? 4 : 5);
    if (typeof item === 'number') {
      const number = JSON.stringify(item);
      return append(number, number.length);
    }
    if (typeof item !== 'object' || active.has(item)) throw INVALID;
    if (!Array.isArray(item) && Object.getPrototypeOf(item) !== Object.prototype && Object.getPrototypeOf(item) !== null) throw INVALID;
    active.add(item);
    if (Array.isArray(item)) {
      append('[', 1);
      for (let index = 0; index < item.length; index++) {
        if (index) append(',', 1);
        const descriptor = Object.getOwnPropertyDescriptor(item, String(index));
        if (descriptor && !('value' in descriptor)) throw INVALID;
        const entry: unknown = descriptor?.value;
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') append('null', 4);
        else write(entry, depth + 1);
      }
      append(']', 1);
    } else {
      append('{', 1);
      let first = true;
      for (const key of Object.keys(item)) {
        const descriptor = Object.getOwnPropertyDescriptor(item, key);
        if (!descriptor || !('value' in descriptor)) throw INVALID;
        const entry: unknown = descriptor.value;
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue;
        if (!first) append(',', 1);
        first = false;
        string(key);
        append(':', 1);
        write(entry, depth + 1);
      }
      append('}', 1);
    }
    active.delete(item);
  };
  try {
    write(value, 0);
    if (pending) chunks.push(pending);
    return chunks.join('');
  } catch (error) {
    if (error === LIMIT) return undefined;
    if (error === INVALID) throw new TypeError('Snapshot must contain plain JSON data without accessors or cycles');
    throw error;
  }
}

const LIMIT = Symbol('snapshot limit');
const INVALID = Symbol('invalid snapshot');
const SHORT_ESCAPES: Record<number, string> = { 8: '\\b', 9: '\\t', 10: '\\n', 12: '\\f', 13: '\\r' };
