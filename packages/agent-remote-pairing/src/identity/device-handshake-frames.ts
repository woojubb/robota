import type { IIdentityContext } from './crypto-context.js';
/**
 * The device handshake's wire frames, their total decoder, and the bytes each proof covers.
 *
 * Decoding is pre-authentication: a frame is checked for shape, exact key set, encoding and length
 * before any crypto runs, and a failure names the field, never its value.
 */

import { encoder } from '../crypto-primitives.js';
import type { TPairingRole } from '../pairing.js';
import {
  decodeDeviceCertificate,
  decodeSigningKeyCertificate,
  type IDeviceCertificate,
  type ISigningKeyCertificate,
} from './certificates.js';
import { canonicalBase64Url, isCount, isSignature, type TCanonical } from './encoding.js';
import {
  decodeDeviceRevocationList,
  decodeDeviceRoster,
  decodeSessionDescriptor,
  decodeSigningKeyRevocation,
  type IDeviceRevocationList,
  type IDeviceRoster,
  type ISessionDescriptor,
  type ISigningKeyRevocation,
} from './statements.js';

/** The protocol version. It is inside every MAC and signature, so a peer cannot negotiate it down. */
export const DEVICE_HANDSHAKE_PROTOCOL = 1;

/** The label of the pairwise pre-proof MAC. */

export const HANDSHAKE_NONCE_BYTES = 16;
const MAC_BYTES = 32;

export interface IDeviceNonceFrame {
  readonly t: 'dh-nonce';
  readonly nonce: string;
}

export interface IDevicePreFrame {
  readonly t: 'dh-pre';
  readonly mac: string;
}

export interface IDeviceHelloFrame {
  readonly t: 'dh-hello';
  readonly ctx: string;
  readonly proto: number;
  readonly rosterSeq: number;
  readonly revocationSeq: number;
  readonly signingKeyRevocationSeq: number;
}

/** A list travels here only when its sender's hello declared a higher `seq` than the receiver's. */
export interface IDeviceProveFrame {
  readonly t: 'dh-prove';
  readonly signingKeyCert: ISigningKeyCertificate;
  readonly deviceCert: IDeviceCertificate;
  readonly sessionDescriptor: ISessionDescriptor;
  readonly sig: string;
  readonly roster?: IDeviceRoster;
  readonly revocation?: IDeviceRevocationList;
  readonly signingKeyRevocation?: ISigningKeyRevocation;
}

export type TDeviceHandshakeFrame =
  IDeviceNonceFrame | IDevicePreFrame | IDeviceHelloFrame | IDeviceProveFrame;

export type TDeviceFrameDecodeResult =
  | { readonly ok: true; readonly frame: TDeviceHandshakeFrame }
  | { readonly ok: false; readonly field: string };

function malformed(field: string): TDeviceFrameDecodeResult {
  return { ok: false, field };
}

/** A plain object whose own keys are exactly `t`, `required` and any of `optional`. */
function openFrame(
  value: Readonly<Record<string, unknown>>,
  required: readonly string[],
  optional: readonly string[] = [],
): string | undefined {
  const allowed = new Set(['t', ...required, ...optional]);
  for (const key of Object.keys(value)) if (!allowed.has(key)) return 'frame';
  for (const key of required) {
    if (!Object.prototype.hasOwnProperty.call(value, key)) return key;
  }
  return undefined;
}

type TDecoder<T> = (
  value: unknown,
) => { readonly ok: true; readonly value: T } | { readonly ok: false };

function optionalList<T>(
  r: Readonly<Record<string, unknown>>,
  key: string,
  decode: TDecoder<T>,
): { readonly ok: true; readonly value?: T } | { readonly ok: false } {
  if (!Object.prototype.hasOwnProperty.call(r, key)) return { ok: true };
  const decoded = decode(r[key]);
  return decoded.ok ? { ok: true, value: decoded.value } : { ok: false };
}

/** Decode one inbound frame. Total: never throws, and a failure names a field, never a value. */
export function decodeDeviceHandshakeFrame(
  cryptoContext: IIdentityContext,
  value: unknown,
): TDeviceFrameDecodeResult {
  try {
    if (typeof value !== 'object' || value === null || Array.isArray(value))
      return malformed('frame');
    const proto: unknown = Object.getPrototypeOf(value);
    if (proto !== Object.prototype && proto !== null) return malformed('frame');
    const r = value as Readonly<Record<string, unknown>>;
    const t = Object.prototype.hasOwnProperty.call(r, 't') ? r['t'] : undefined;
    if (t === 'dh-nonce') {
      const missing = openFrame(r, ['nonce']);
      if (missing !== undefined) return malformed(missing);
      if (canonicalBase64Url(r['nonce'], HANDSHAKE_NONCE_BYTES) === undefined)
        return malformed('nonce');
      return { ok: true, frame: { t, nonce: r['nonce'] as string } };
    }
    if (t === 'dh-pre') {
      const missing = openFrame(r, ['mac']);
      if (missing !== undefined) return malformed(missing);
      if (canonicalBase64Url(r['mac'], MAC_BYTES) === undefined) return malformed('mac');
      return { ok: true, frame: { t, mac: r['mac'] as string } };
    }
    if (t === 'dh-hello') {
      const fields = [
        'ctx',
        'proto',
        'rosterSeq',
        'revocationSeq',
        'signingKeyRevocationSeq',
      ] as const;
      const missing = openFrame(r, fields);
      if (missing !== undefined) return malformed(missing);
      if (r['ctx'] !== cryptoContext.purposes.handshake) return malformed('ctx');
      for (const field of fields.slice(1)) if (!isCount(r[field])) return malformed(field);
      return {
        ok: true,
        frame: {
          t,
          ctx: cryptoContext.purposes.handshake,
          proto: r['proto'] as number,
          rosterSeq: r['rosterSeq'] as number,
          revocationSeq: r['revocationSeq'] as number,
          signingKeyRevocationSeq: r['signingKeyRevocationSeq'] as number,
        },
      };
    }
    if (t === 'dh-prove') {
      const missing = openFrame(
        r,
        ['signingKeyCert', 'deviceCert', 'sessionDescriptor', 'sig'],
        ['roster', 'revocation', 'signingKeyRevocation'],
      );
      if (missing !== undefined) return malformed(missing);
      const signingKeyCert = decodeSigningKeyCertificate(cryptoContext, r['signingKeyCert']);
      if (!signingKeyCert.ok) return malformed('signingKeyCert');
      const deviceCert = decodeDeviceCertificate(cryptoContext, r['deviceCert']);
      if (!deviceCert.ok) return malformed('deviceCert');
      const sessionDescriptor = decodeSessionDescriptor(cryptoContext, r['sessionDescriptor']);
      if (!sessionDescriptor.ok) return malformed('sessionDescriptor');
      if (!isSignature(r['sig'])) return malformed('sig');
      const roster = optionalList(r, 'roster', (value) => decodeDeviceRoster(cryptoContext, value));
      if (!roster.ok) return malformed('roster');
      const revocation = optionalList(r, 'revocation', (value) =>
        decodeDeviceRevocationList(cryptoContext, value),
      );
      if (!revocation.ok) return malformed('revocation');
      const skr = optionalList(r, 'signingKeyRevocation', (value) =>
        decodeSigningKeyRevocation(cryptoContext, value),
      );
      if (!skr.ok) return malformed('signingKeyRevocation');
      return {
        ok: true,
        frame: {
          t,
          signingKeyCert: signingKeyCert.value,
          deviceCert: deviceCert.value,
          sessionDescriptor: sessionDescriptor.value,
          sig: r['sig'] as string,
          ...(roster.value !== undefined ? { roster: roster.value } : {}),
          ...(revocation.value !== undefined ? { revocation: revocation.value } : {}),
          ...(skr.value !== undefined ? { signingKeyRevocation: skr.value } : {}),
        },
      };
    }
    return malformed('t');
  } catch {
    // allow-fallback: a decoder that throws on hostile input (a throwing getter) is a malformed frame
    return malformed('frame');
  }
}

/**
 * The bytes a pre-proof MAC covers. Fingerprints and nonces are in role order, and the sender's
 * role is named, so each side's proof differs from the one it expects: a reflected frame fails.
 */
export function preProofBytes(
  cryptoContext: IIdentityContext,
  input: {
    readonly senderRole: TPairingRole;
    readonly fingerprintInitiator: string;
    readonly fingerprintResponder: string;
    readonly nonceInitiator: string;
    readonly nonceResponder: string;
  },
): Uint8Array {
  return encoder.encode(
    JSON.stringify([
      `${cryptoContext.namespace}/pre/v1`,
      DEVICE_HANDSHAKE_PROTOCOL,
      input.senderRole,
      input.fingerprintInitiator,
      input.fingerprintResponder,
      input.nonceInitiator,
      input.nonceResponder,
    ]),
  );
}

export interface IHandshakeTranscriptInput {
  readonly signerRole: TPairingRole;
  readonly fingerprintInitiator: string;
  readonly fingerprintResponder: string;
  readonly nonceInitiator: string;
  readonly nonceResponder: string;
  readonly helloInitiator: IDeviceHelloFrame;
  readonly helloResponder: IDeviceHelloFrame;
  readonly signerDeviceId: string;
  readonly peerDeviceId: string;
  /** Binds the exact session descriptor the signer presented. */
  readonly sessionDescriptorSig: string;
}

function helloFields(hello: IDeviceHelloFrame): TCanonical {
  return [
    hello.ctx,
    hello.proto,
    hello.rosterSeq,
    hello.revocationSeq,
    hello.signingKeyRevocationSeq,
  ];
}

/** The fields a `prove` signature covers, under the configured handshake purpose. */
export function handshakeTranscriptFields(input: IHandshakeTranscriptInput): TCanonical[] {
  return [
    DEVICE_HANDSHAKE_PROTOCOL,
    input.signerRole,
    input.fingerprintInitiator,
    input.fingerprintResponder,
    input.nonceInitiator,
    input.nonceResponder,
    helloFields(input.helloInitiator),
    helloFields(input.helloResponder),
    input.signerDeviceId,
    input.peerDeviceId,
    input.sessionDescriptorSig,
  ];
}
