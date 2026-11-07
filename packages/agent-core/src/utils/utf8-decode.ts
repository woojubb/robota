/**
 * `TextDecoder` drops a leading byte-order mark unless told to keep it; `Buffer.toString('utf8')`
 * never drops one. `ignoreBOM: true` is the spelling that keeps it, so what a platform-neutral entry
 * decodes is byte-for-byte what `Buffer` decoded (ARCHITECTURE.md "Runtime platforms").
 */
const DECODER = new TextDecoder('utf-8', { ignoreBOM: true });

/**
 * `bytes` as text: UTF-8, a leading BOM kept, and each malformed or truncated sequence replaced by
 * U+FFFD, exactly as `Buffer.from(bytes).toString('utf8')` does.
 */
export function utf8Decode(bytes: Uint8Array): string {
  return DECODER.decode(bytes);
}
