/**
 * Tool arguments rendered for opt-in telemetry content. The walk is iterative and stops as soon as
 * the bound is reached, so a 10 MB file body costs a bounded slice, not a full copy. A value under a
 * sensitive key is masked whole, whatever its type; binary and base64 payloads are replaced by their
 * size. This is a pre-export shaping step, not redaction: the host still redacts the text.
 */

/** The longest prefix of `text` that fits `maxBytes` of UTF-8 without splitting a character. */
export function utf8Prefix(text: string, maxBytes: number): string {
  const bytes = Buffer.from(text, 'utf8');
  if (bytes.byteLength <= maxBytes) return text;
  let end = Math.max(0, maxBytes);
  // Back off continuation bytes (10xxxxxx) so the cut lands on a character boundary.
  while (end > 0 && ((bytes[end] ?? 0) & 0xc0) === 0x80) end -= 1;
  return bytes.subarray(0, end).toString('utf8');
}

const REDACTED = '"[redacted]"';
const CIRCULAR = '"[circular]"';
const DEPTH_LIMIT = '"[depth limit]"';
const MAX_DEPTH = 32;
const BASE64_MIN_CHARS = 1024;
const BINARY_KEY_WORDS: ReadonlySet<string> = new Set(['data', 'image', 'base64', 'bytes']);
const DATA_URI = /^data:[\w.+-]+\/[\w.+-]+(?:;[\w.+-]+=[\w.+-]+)*;base64,/iu;
const BASE64_ONLY = /^[A-Za-z0-9+/_-]+={0,2}$/u;

const SENSITIVE_WORDS: ReadonlySet<string> = new Set([
  'secret', 'secrets', 'password', 'passwords', 'passwd', 'passphrase', 'token', 'tokens',
  'auth', 'authorization', 'cookie', 'cookies', 'credential', 'credentials', 'signature',
  'bearer', 'jwt', 'apikey', 'privatekey',
]);
/** Words that make a following `key` sensitive (`apiKey`, `private_key`, `accessKey`, `signingKey`). */
const KEY_QUALIFIERS: ReadonlySet<string> = new Set(['api', 'private', 'access', 'signing', 'encryption']);

/** `maxTokens` → `max tokens`, `OPENAI_API_KEY` → `openai api key`, `x-api-key` → `x api key`. */
function keyWords(key: string): string[] {
  return key
    .replace(/([a-z0-9])([A-Z])/gu, '$1 $2')
    .replace(/([A-Z]+)([A-Z][a-z])/gu, '$1 $2')
    .toLowerCase()
    .split(/[^a-z0-9]+/u)
    .filter((word) => word.length > 0);
}

/**
 * Whether telemetry masks the value under `key`. Matching is by whole word, so `author` and
 * `oauthScope` are kept while `authToken` and `functionSignature` are not. A count-like key keeps a
 * number (`maxTokens`, `min_tokens`, `tokenCount`, `rateLimit`); any other value under it is masked.
 */
export function isTelemetrySensitiveKey(key: string, value: unknown): boolean {
  const words = keyWords(key);
  const sensitive = words.some((word, index) =>
    SENSITIVE_WORDS.has(word) || (word === 'key' && index > 0 && KEY_QUALIFIERS.has(words[index - 1]!)));
  if (!sensitive) return false;
  const first = words[0];
  const last = words[words.length - 1];
  const countLike = last === 'tokens' || first === 'max' || first === 'min' ||
    last === 'count' || last === 'limit';
  return !(countLike && typeof value === 'number');
}

export interface IBoundedText {
  readonly text: string;
  /** UTF-8 bytes of `text`. */
  readonly bytes: number;
  /** The walk stopped at the bound; `text` is a prefix. */
  readonly truncated: boolean;
}

class BoundedWriter {
  private readonly parts: string[] = [];
  bytes = 0;
  full = false;

  constructor(private readonly maxBytes: number) {}

  get remaining(): number {
    return this.maxBytes - this.bytes;
  }

  emit(text: string): void {
    if (this.full) return;
    const size = Buffer.byteLength(text, 'utf8');
    if (size <= this.remaining) {
      this.parts.push(text);
      this.bytes += size;
      return;
    }
    const kept = utf8Prefix(text, this.remaining);
    this.parts.push(kept);
    this.bytes += Buffer.byteLength(kept, 'utf8');
    this.full = true;
  }

  /** A JSON string, escaped from a slice only a little longer than what can still fit. */
  emitString(value: string): void {
    // Every character is at least one byte, so this slice always overflows when the whole would.
    const slice = value.length > this.remaining + 1 ? value.slice(0, this.remaining + 1) : value;
    this.emit(JSON.stringify(slice));
    if (slice.length !== value.length) this.full = true;
  }

  finish(): IBoundedText {
    return { text: this.parts.join(''), bytes: this.bytes, truncated: this.full };
  }
}

interface IFrame {
  readonly value: object;
  readonly array: boolean;
  readonly keys: readonly string[] | undefined;
  readonly depth: number;
  index: number;
  emitted: number;
}

function binaryBytes(value: object): number | undefined {
  if (value instanceof ArrayBuffer) return value.byteLength;
  if (typeof SharedArrayBuffer !== 'undefined' && value instanceof SharedArrayBuffer) return value.byteLength;
  if (ArrayBuffer.isView(value)) return value.byteLength;
  return undefined;
}

function base64Bytes(value: string, key: string | undefined): number | undefined {
  if (value.length < BASE64_MIN_CHARS) return undefined;
  const uri = DATA_URI.exec(value.slice(0, 256));
  if (uri) return Math.floor(((value.length - uri[0].length) * 3) / 4);
  if (key === undefined || !keyWords(key).some((word) => BINARY_KEY_WORDS.has(word))) return undefined;
  if (!BASE64_ONLY.test(value)) return undefined;
  return Math.floor((value.length * 3) / 4);
}

/** A value JSON leaves out of an object (and renders as `null` in an array). */
function isSkipped(value: unknown): boolean {
  return value === undefined || typeof value === 'function' || typeof value === 'symbol';
}

/**
 * JSON for `value`, at most `maxBytes` of UTF-8, with sensitive keys masked, cycles and excess
 * depth marked, and binary payloads omitted. Iterative: a deep or huge value cannot overflow the
 * stack, and nothing past the bound is visited.
 */
export function stringifyBounded(value: unknown, maxBytes: number): IBoundedText {
  const out = new BoundedWriter(maxBytes);
  const stack: IFrame[] = [];
  const active = new Set<object>();

  const render = (current: unknown, key: string | undefined, depth: number): void => {
    if (current === null || isSkipped(current)) {
      out.emit('null');
      return;
    }
    switch (typeof current) {
      case 'string': {
        const omitted = base64Bytes(current, key);
        if (omitted !== undefined) out.emit(`"[binary omitted, ${omitted} bytes]"`);
        else out.emitString(current);
        return;
      }
      case 'number':
        out.emit(Number.isFinite(current) ? String(current) : 'null');
        return;
      case 'boolean':
        out.emit(current ? 'true' : 'false');
        return;
      case 'bigint':
        out.emit(`"${current.toString()}"`);
        return;
      default:
        break;
    }
    const object = current as object;
    if (object instanceof Date) {
      out.emit(Number.isNaN(object.getTime()) ? 'null' : `"${object.toISOString()}"`);
      return;
    }
    const binary = binaryBytes(object);
    if (binary !== undefined) {
      out.emit(`"[binary omitted, ${binary} bytes]"`);
      return;
    }
    if (active.has(object)) {
      out.emit(CIRCULAR);
      return;
    }
    if (depth >= MAX_DEPTH) {
      out.emit(DEPTH_LIMIT);
      return;
    }
    const array = Array.isArray(object);
    out.emit(array ? '[' : '{');
    active.add(object);
    stack.push({
      value: object,
      array,
      keys: array ? undefined : Object.keys(object),
      depth,
      index: 0,
      emitted: 0,
    });
  };

  if (isSkipped(value)) return out.finish();
  render(value, undefined, 0);
  while (stack.length > 0 && !out.full) {
    const frame = stack[stack.length - 1]!;
    if (frame.array) {
      const items = frame.value as readonly unknown[];
      if (frame.index >= items.length) {
        out.emit(']');
        active.delete(frame.value);
        stack.pop();
        continue;
      }
      const item = items[frame.index];
      frame.index += 1;
      if (frame.emitted > 0) out.emit(',');
      frame.emitted += 1;
      render(item, undefined, frame.depth + 1);
      continue;
    }
    const keys = frame.keys!;
    if (frame.index >= keys.length) {
      out.emit('}');
      active.delete(frame.value);
      stack.pop();
      continue;
    }
    const key = keys[frame.index]!;
    frame.index += 1;
    const child = (frame.value as Record<string, unknown>)[key];
    if (isSkipped(child)) continue;
    if (frame.emitted > 0) out.emit(',');
    frame.emitted += 1;
    out.emitString(key);
    out.emit(':');
    if (isTelemetrySensitiveKey(key, child)) out.emit(REDACTED);
    else render(child, key, frame.depth + 1);
  }
  return out.finish();
}
