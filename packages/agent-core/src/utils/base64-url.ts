const PAD = 0xfe;
const SKIP = 0xff;
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

/**
 * Each byte's meaning in base64 or base64url: its value, `-` and `+` sharing 62 and `_` and `/`
 * sharing 63, `=` as padding, anything else skipped.
 */
const MEANING = new Uint8Array(256).fill(SKIP);
for (let value = 0; value < ALPHABET.length; value += 1) {
  MEANING[ALPHABET.charCodeAt(value)] = value;
}
MEANING['-'.charCodeAt(0)] = MEANING['+'.charCodeAt(0)] = 62;
MEANING['_'.charCodeAt(0)] = MEANING['/'.charCodeAt(0)] = 63;
MEANING['='.charCodeAt(0)] = PAD;

/**
 * The bytes `text` names, read as `Buffer.from(text, 'base64url')` reads it: both alphabets are
 * accepted, padding is optional, the first `=` ends the data, any other character is skipped and a
 * trailing sextet too short to make a byte is dropped. Like Buffer it looks only at the low byte
 * of each UTF-16 unit, so `中` reads as `-`. It never throws, so a caller that must refuse
 * malformed input checks the text before decoding. Meant for a token whose signature was verified
 * first, where the text is canonical base64url anyway.
 */
export function base64UrlDecode(text: string): Uint8Array {
  const bytes: number[] = [];
  let accumulator = 0;
  let bits = 0;
  for (let index = 0; index < text.length; index += 1) {
    const meaning = MEANING[text.charCodeAt(index) & 0xff]!;
    if (meaning === PAD) break;
    if (meaning === SKIP) continue;
    accumulator = ((accumulator << 6) | meaning) & 0xffffff;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((accumulator >> bits) & 0xff);
    }
  }
  return Uint8Array.from(bytes);
}
