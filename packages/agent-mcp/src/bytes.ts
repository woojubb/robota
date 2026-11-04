/**
 * Base64 from the platform's `btoa` and `atob`, so a platform-neutral entry never reaches for
 * `Buffer` (ARCHITECTURE.md "Runtime platforms").
 */

const ENCODER = new TextEncoder();

/** `text` as standard, padded base64 of its UTF-8 bytes. */
export function utf8ToBase64(text: string): string {
  let binary = '';
  for (const byte of ENCODER.encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The bytes standard base64 `data` decodes to, with `atob`'s tolerance: omitted padding and ASCII
 * whitespace are accepted. Throws for anything `atob` refuses.
 */
export function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index);
  return bytes;
}
