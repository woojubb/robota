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
  type Frame =
    | { kind: 'array'; value: unknown[]; index: number }
    | { kind: 'object'; value: object; keys: string[]; index: number; first: boolean };
  const stack: Frame[] = [];
  const active = new Set<object>();
  const writeValue = (item: unknown): void => {
    if (item === null) return append('null', 4);
    if (typeof item === 'string') return string(item);
    if (typeof item === 'boolean') return append(item ? 'true' : 'false', item ? 4 : 5);
    if (typeof item === 'number') {
      const number = JSON.stringify(item);
      return append(number, number.length);
    }
    if (typeof item !== 'object' || active.has(item)) throw INVALID;
    if (Array.isArray(item)) {
      active.add(item);
      append('[', 1);
      stack.push({ kind: 'array', value: item, index: 0 });
    } else {
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw INVALID;
      active.add(item);
      append('{', 1);
      stack.push({ kind: 'object', value: item, keys: Object.keys(item), index: 0, first: true });
    }
  };
  try {
    writeValue(value);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1]!;
      if (frame.kind === 'array') {
        if (frame.index === frame.value.length) {
          append(']', 1);
          active.delete(frame.value);
          stack.pop();
          continue;
        }
        if (frame.index) append(',', 1);
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, String(frame.index++));
        if (descriptor && !('value' in descriptor)) throw INVALID;
        const entry: unknown = descriptor?.value;
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') append('null', 4);
        else writeValue(entry);
      } else {
        if (frame.index === frame.keys.length) {
          append('}', 1);
          active.delete(frame.value);
          stack.pop();
          continue;
        }
        const key = frame.keys[frame.index++]!;
        const descriptor = Object.getOwnPropertyDescriptor(frame.value, key);
        if (!descriptor || !('value' in descriptor)) throw INVALID;
        const entry: unknown = descriptor.value;
        if (entry === undefined || typeof entry === 'function' || typeof entry === 'symbol') continue;
        if (!frame.first) append(',', 1);
        frame.first = false;
        string(key);
        append(':', 1);
        writeValue(entry);
      }
    }
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
