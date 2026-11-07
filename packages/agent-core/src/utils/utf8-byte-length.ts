const ENCODER = new TextEncoder();

/**
 * How many bytes `text` takes as UTF-8, counted without `Buffer` so a platform-neutral entry can
 * measure what it writes or budgets (ARCHITECTURE.md "Runtime platforms").
 */
export function utf8ByteLength(text: string): number {
  return ENCODER.encode(text).byteLength;
}
