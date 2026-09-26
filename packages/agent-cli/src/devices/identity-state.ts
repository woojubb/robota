/**
 * This device's public identity state: the certificates, roster and lists it holds, and the highest
 * list sequence numbers it has accepted. None of it is secret — private keys live only in the
 * credential store — but it is kept owner-only all the same, because a rolled-back or swapped copy
 * would change what this device trusts.
 *
 * Every statement is decoded on read with the same decoders a peer's copy goes through, so a
 * hand-edited file is refused rather than trusted.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  decodeDeviceCertificate,
  decodeDeviceRevocationList,
  decodeDeviceRoster,
  decodeSigningKeyCertificate,
  decodeSigningKeyRevocation,
  type IDeviceCertificate,
  type IDeviceRevocationList,
  type IDeviceRoster,
  type IListHighWaterMarks,
  type ISigningKeyCertificate,
  type ISigningKeyRevocation,
} from '@robota-sdk/agent-remote-pairing';
import {
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
  writeOwnerOnlyFile,
} from '@robota-sdk/agent-core/node';

import { DeviceIdentityError } from './device-identity-error.js';

const STATE_VERSION = 1;
const STATE_FILE = 'identity.json';
/** A signing-key id: base64url of a SHA-256 digest. Anything else (e.g. `__proto__`) is refused. */
const KEY_ID = /^[A-Za-z0-9_-]{43}$/;

export interface IDeviceIdentityState {
  /** The pinned trust anchor: base64url SPKI of the user's master public key. */
  readonly masterPublicKey: string;
  readonly userId: string;
  /** This device's certificate. */
  readonly deviceCertificate: IDeviceCertificate;
  /** The certificate of the signing key that issued `deviceCertificate` and the lists. */
  readonly signingKeyCertificate: ISigningKeyCertificate;
  /** Whether this device keeps that signing key's private key in its credential store. */
  readonly holdsSigningKey: boolean;
  readonly roster: IDeviceRoster;
  readonly revocation: IDeviceRevocationList;
  readonly signingKeyRevocation: ISigningKeyRevocation;
  /** The highest `seq` accepted per list; a list below it is a rollback. */
  readonly marks: IListHighWaterMarks;
}

export function identityStatePath(directory: string): string {
  return join(directory, STATE_FILE);
}

function corrupt(field: string): DeviceIdentityError {
  return new DeviceIdentityError(`device identity state is corrupt (${field})`);
}

function decoded<T>(result: { ok: true; value: T } | { ok: false }, field: string): T {
  if (!result.ok) throw corrupt(field);
  return result.value;
}

function isSeq(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

function decodeMarks(value: unknown): IListHighWaterMarks {
  if (typeof value !== 'object' || value === null) throw corrupt('marks');
  const record = value as Record<string, unknown>;
  const skr = record['signingKeyRevocationSeq'];
  if (skr !== undefined && !isSeq(skr)) throw corrupt('marks');
  const table = record['bySigningKey'];
  const bySigningKey: Record<string, { rosterSeq?: number; revocationSeq?: number }> = {};
  if (table !== undefined) {
    if (typeof table !== 'object' || table === null) throw corrupt('marks');
    for (const [id, raw] of Object.entries(table)) {
      if (!KEY_ID.test(id) || typeof raw !== 'object' || raw === null) throw corrupt('marks');
      const { rosterSeq, revocationSeq } = raw as Record<string, unknown>;
      if (rosterSeq !== undefined && !isSeq(rosterSeq)) throw corrupt('marks');
      if (revocationSeq !== undefined && !isSeq(revocationSeq)) throw corrupt('marks');
      bySigningKey[id] = {
        ...(rosterSeq !== undefined ? { rosterSeq } : {}),
        ...(revocationSeq !== undefined ? { revocationSeq } : {}),
      };
    }
  }
  return { ...(skr !== undefined ? { signingKeyRevocationSeq: skr } : {}), bySigningKey };
}

/** The stored state, `undefined` when this device has no identity, or a throw when it is unreadable. */
export function readIdentityState(directory: string): IDeviceIdentityState | undefined {
  const path = identityStatePath(directory);
  let text: string;
  try {
    tightenExistingFile(path);
    text = readFileSync(path, 'utf8');
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw new DeviceIdentityError(`device identity state ${path} is unreadable`);
  }
  let raw: Record<string, unknown>;
  try {
    raw = JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw corrupt('json');
  }
  if (typeof raw !== 'object' || raw === null || raw['version'] !== STATE_VERSION) {
    throw corrupt('version');
  }
  const { masterPublicKey, userId, holdsSigningKey } = raw;
  if (typeof masterPublicKey !== 'string') throw corrupt('masterPublicKey');
  if (typeof userId !== 'string') throw corrupt('userId');
  if (typeof holdsSigningKey !== 'boolean') throw corrupt('holdsSigningKey');
  return {
    masterPublicKey,
    userId,
    holdsSigningKey,
    deviceCertificate: decoded(
      decodeDeviceCertificate(raw['deviceCertificate']),
      'deviceCertificate',
    ),
    signingKeyCertificate: decoded(
      decodeSigningKeyCertificate(raw['signingKeyCertificate']),
      'signingKeyCertificate',
    ),
    roster: decoded(decodeDeviceRoster(raw['roster']), 'roster'),
    revocation: decoded(decodeDeviceRevocationList(raw['revocation']), 'revocation'),
    signingKeyRevocation: decoded(
      decodeSigningKeyRevocation(raw['signingKeyRevocation']),
      'signingKeyRevocation',
    ),
    marks: decodeMarks(raw['marks']),
  };
}

/** The same identity state, i.e. nothing was issued in between. */
export function sameIdentityState(
  a: IDeviceIdentityState,
  b: IDeviceIdentityState | undefined,
): boolean {
  return (
    b !== undefined &&
    a.masterPublicKey === b.masterPublicKey &&
    a.signingKeyCertificate.sig === b.signingKeyCertificate.sig &&
    a.deviceCertificate.sig === b.deviceCertificate.sig &&
    a.roster.sig === b.roster.sig &&
    a.revocation.sig === b.revocation.sig &&
    a.signingKeyRevocation.sig === b.signingKeyRevocation.sig &&
    a.holdsSigningKey === b.holdsSigningKey
  );
}

/** Replace the stored state in one owner-only write. */
export function writeIdentityState(
  directory: string,
  state: IDeviceIdentityState,
  withinRoot?: string,
): void {
  ensureOwnerOnlyDirectory(directory, withinRoot === undefined ? {} : { withinRoot });
  writeOwnerOnlyFile(
    identityStatePath(directory),
    `${JSON.stringify({ version: STATE_VERSION, ...state }, null, 2)}\n`,
  );
}
