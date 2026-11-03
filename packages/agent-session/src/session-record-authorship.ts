/**
 * Where a sealed session record carries its authorship tag (#3679 step 3e): a byte header in front of
 * the exact envelope bytes, inside the sealed plaintext —
 *
 *     robota-authorship/v1 <canonical unpadded base64url of the 32-byte tag>\n<envelope bytes>
 *
 * The header is authenticated with the record, since it is sealed with it, and the envelope is never
 * re-serialised, so a change to how the codec formats an envelope never invalidates an earlier tag.
 * Plain records never carry it: a plain file that begins with it is just a plain file. A token handed
 * to another process carries the envelope only.
 */

import { Buffer } from 'node:buffer';

/** Versioned: a later framing is a new prefix, which this build reads as no tag at all. */
export const AUTHORSHIP_HEADER_PREFIX = 'robota-authorship/v1 ';

const PREFIX_BYTES = Buffer.from(AUTHORSHIP_HEADER_PREFIX, 'ascii');
const NEWLINE = 0x0a;
const TAG_BYTES = 32;
const BASE64URL_PATTERN = /^[A-Za-z0-9_-]+$/;

/** `envelope` with `tag` in front of it, as a tagged record's sealed plaintext. */
export function withAuthorshipHeader(tag: Uint8Array, envelope: Uint8Array): Buffer {
  const encoded = Buffer.from(tag.buffer, tag.byteOffset, tag.byteLength).toString('base64url');
  return Buffer.concat([Buffer.from(`${AUTHORSHIP_HEADER_PREFIX}${encoded}\n`, 'ascii'), envelope]);
}

/** A record's sealed plaintext split into its envelope and the tag in front of it, if any. */
export interface ISplitRecordPlaintext {
  readonly envelope: Uint8Array;
  /** The tag the header carries; `malformed` for a header that is not one this build writes. */
  readonly tag: Uint8Array | 'malformed' | undefined;
}

/**
 * Splits a sealed record's plaintext. Without the header the whole plaintext is the envelope, an
 * untagged record. A header whose tag is not canonical base64url of 32 bytes is `malformed`, which a
 * reader treats as a tag that does not verify; one with no line end leaves the plaintext whole, which
 * then does not decode as a record.
 */
export function splitAuthorshipHeader(plain: Uint8Array): ISplitRecordPlaintext {
  const bytes = Buffer.from(plain.buffer, plain.byteOffset, plain.byteLength);
  if (
    bytes.length < PREFIX_BYTES.length ||
    !bytes.subarray(0, PREFIX_BYTES.length).equals(PREFIX_BYTES)
  ) {
    return { envelope: plain, tag: undefined };
  }
  const end = bytes.indexOf(NEWLINE, PREFIX_BYTES.length);
  if (end < 0) return { envelope: plain, tag: 'malformed' };
  const encoded = bytes.subarray(PREFIX_BYTES.length, end).toString('latin1');
  const envelope = plain.subarray(end + 1);
  if (!BASE64URL_PATTERN.test(encoded)) return { envelope, tag: 'malformed' };
  const tag = Buffer.from(encoded, 'base64url');
  if (tag.length !== TAG_BYTES || tag.toString('base64url') !== encoded) {
    return { envelope, tag: 'malformed' };
  }
  return { envelope, tag };
}
