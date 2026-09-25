/**
 * This device's identity among the user's devices — the host side of `/devices`.
 *
 * The recovery phrase exists only inside `openTerminal().run(...)`: it is generated or read there,
 * turned into the master key there, and dropped when that call returns. What leaves is the master
 * key object, which is non-extractable and is itself dropped once it has certified a signing key or
 * issued a signing-key revocation. Nothing the phrase touches is written, returned, or put in an
 * error: results are ids and closed refusal reasons.
 *
 * The slow part — the operator at the terminal — runs outside the identity lock; the state is read
 * again under the lock and the operation refuses if another process changed it meanwhile, so a
 * second session never waits minutes on the first one's operator and never has its change lost.
 */
import { hostname } from 'node:os';
import { randomInt } from 'node:crypto';
import { join } from 'node:path';

import {
  DEVICE_CAPABILITIES,
  DEVICE_NAME_MAX_CHARS,
  certifyDevice,
  certifySigningKey,
  deriveMasterKey,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateRecoveryPhrase,
  generateSigningKeyPair,
  issueDeviceRevocationList,
  issueDeviceRoster,
  issueSigningKeyRevocation,
  verifyDeviceChain,
  type IMasterKey,
  type IListHighWaterMarks,
  type ISigningKey,
} from '@robota-sdk/agent-remote-pairing';

import { CredentialStoreError } from '../credentials/credential-store-error.js';
import { withExclusiveFileLock } from '../credentials/exclusive-file-lock.js';
import { DeviceIdentityError } from './device-identity-error.js';
import {
  DEVICE_KA_KEY,
  DEVICE_SIGN_KEY,
  holdsDeviceKeys,
  importPublicKey,
  loadSigningKey,
  signingKeyCredentialKey,
  storeKeyPair,
} from './identity-keys.js';
import { readIdentityState, writeIdentityState, type IDeviceIdentityState } from './identity-state.js';
import {
  presentNewPhrase,
  readExistingPhrase,
  readNewPassphrase,
  readPassphrase,
  type TRandomInt,
} from './recovery-phrase-dialog.js';
import {
  SecretInputCancelled,
  type ISecretTerminal,
  type ISecretTerminalSession,
} from './secret-terminal.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type {
  IDevicesCommandPort,
  IDevicesInitResult,
  IDevicesRecoverResult,
  IDevicesRevokeResult,
  IDevicesView,
  TDevicesOutcome,
  TDevicesRefusal,
} from '@robota-sdk/agent-command';

/** Fewer characters than this could name several devices by accident; the id is asked for in full-ish. */
const MIN_ID_PREFIX = 6;
const SHORT_ID_CHARS = 10;

export interface IDeviceIdentityServiceOptions {
  /** Where the identity state is kept, e.g. `~/.robota/devices`. */
  readonly directory: string;
  /** An owned ancestor tightened with it, e.g. `~/.robota`. */
  readonly withinRoot?: string;
  /** Where private keys are kept. */
  readonly store: ICredentialStore;
  /** The secret terminal, or `undefined` when there is no interactive one. */
  readonly openTerminal: () => ISecretTerminalSession | undefined;
  /** Where the store keeps keys, for the operator. */
  readonly describeKeyStorage?: () => string | undefined;
  readonly now?: () => number;
  readonly defaultDeviceName?: () => string;
  readonly randomInt?: TRandomInt;
}

function refuse<T>(reason: TDevicesRefusal): TDevicesOutcome<T> {
  return { ok: false, reason };
}

/**
 * The next `seq` for a list. Wall-clock based, never below the last one plus one: two issuers that
 * share no state (a recovery on another device) still number forward, and a clock that steps back
 * cannot make a list look older than its predecessor.
 */
function nextSeq(previous: number | undefined, now: number): number {
  return Math.max((previous ?? 0) + 1, now);
}

/** A signed device name: NFC, no control characters, bounded. */
function deviceName(raw: string): string {
  const cleaned = Array.from(raw.normalize('NFC').replace(/\p{Cc}/gu, ' ').trim())
    .slice(0, DEVICE_NAME_MAX_CHARS)
    .join('')
    .trim();
  return cleaned.length > 0 ? cleaned : 'device';
}

/** The same identity state, i.e. nothing was issued in between. */
function unchanged(a: IDeviceIdentityState, b: IDeviceIdentityState | undefined): boolean {
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

/** Verify the state for this device before it is saved, and fold the accepted `seq`s into its marks. */
async function checked(state: IDeviceIdentityState, now: number): Promise<IDeviceIdentityState> {
  const verdict = await verifyDeviceChain({
    masterPublicKey: state.masterPublicKey,
    signingKeyCert: state.signingKeyCertificate,
    deviceCert: state.deviceCertificate,
    roster: state.roster,
    revocation: state.revocation,
    signingKeyRevocation: state.signingKeyRevocation,
    now,
    lastSeen: state.marks,
    required: { roster: true, revocation: true, signingKeyRevocation: true },
  });
  if (!verdict.ok) {
    throw new DeviceIdentityError(
      `the new identity state did not verify (${verdict.subject}: ${verdict.reason}); nothing was saved`,
    );
  }
  const marks: IListHighWaterMarks = {
    ...(verdict.accepted.signingKeyRevocationSeq !== undefined
      ? { signingKeyRevocationSeq: verdict.accepted.signingKeyRevocationSeq }
      : {}),
    bySigningKey: {
      ...state.marks.bySigningKey,
      [verdict.signingKeyId]: {
        ...(verdict.accepted.rosterSeq !== undefined ? { rosterSeq: verdict.accepted.rosterSeq } : {}),
        ...(verdict.accepted.revocationSeq !== undefined
          ? { revocationSeq: verdict.accepted.revocationSeq }
          : {}),
      },
    },
  };
  return { ...state, marks };
}

/**
 * Run `operation`; a failure that is not already known to be safe to show is replaced by a generic
 * one, so no message from a library that saw the phrase can reach the command result.
 */
async function guarded<T>(what: string, operation: () => Promise<T>): Promise<T> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof DeviceIdentityError || error instanceof CredentialStoreError) throw error;
    throw new DeviceIdentityError(`${what} failed unexpectedly`);
  }
}

type TMasterOutcome = { readonly ok: true; readonly master: IMasterKey } | { readonly ok: false; readonly reason: TDevicesRefusal };

/** Run a terminal dialog; ctrl-C at the terminal is a cancellation, not a failure. */
async function atTerminal(
  session: ISecretTerminalSession,
  dialog: (terminal: ISecretTerminal) => Promise<TMasterOutcome>,
): Promise<TMasterOutcome> {
  try {
    return await session.run(dialog);
  } catch (error) {
    if (error instanceof SecretInputCancelled) return { ok: false, reason: 'cancelled' };
    throw error;
  }
}

export function createDeviceIdentityService(options: IDeviceIdentityServiceOptions): IDevicesCommandPort {
  const now = options.now ?? Date.now;
  const random = options.randomInt ?? ((max: number) => randomInt(max));
  const lockPath = join(options.directory, 'identity.lock');
  const read = (): IDeviceIdentityState | undefined => readIdentityState(options.directory);
  const write = (state: IDeviceIdentityState): void =>
    writeIdentityState(options.directory, state, options.withinRoot);
  const locked = <T>(critical: () => Promise<T>): Promise<T> =>
    withExclusiveFileLock(lockPath, critical);

  async function init(request: { readonly name?: string }): Promise<TDevicesOutcome<IDevicesInitResult>> {
    if (read() !== undefined) return refuse('already-initialized');
    const name = deviceName(request.name ?? options.defaultDeviceName?.() ?? hostname());
    const session = options.openTerminal();
    if (session === undefined) return refuse('no-terminal');

    const derived = await atTerminal(session, async (terminal) => {
      const phrase = generateRecoveryPhrase();
      if (!(await presentNewPhrase(terminal, phrase, random))) {
        return { ok: false, reason: 'confirmation-failed' };
      }
      const passphrase = await readNewPassphrase(terminal);
      if (passphrase === undefined) return { ok: false, reason: 'confirmation-failed' };
      terminal.write('Deriving your keys…\r\n');
      return { ok: true, master: await deriveMasterKey(phrase, passphrase) };
    });
    if (!derived.ok) return refuse(derived.reason);
    const { master } = derived;

    const issuedAt = now();
    const signingPair = await generateSigningKeyPair({ extractable: true });
    const signingCertificate = await certifySigningKey({
      masterPrivateKey: master.keyPair.privateKey,
      userId: master.userId,
      signingPublicKey: signingPair.publicKey,
      issuedAt,
    });
    const signingKeyRevocation = await issueSigningKeyRevocation({
      masterPrivateKey: master.keyPair.privateKey,
      userId: master.userId,
      seq: nextSeq(undefined, issuedAt),
      issuedAt,
      revokedSigningKeyIds: [],
    });
    const signingKey: ISigningKey = { certificate: signingCertificate, privateKey: signingPair.privateKey };
    const [signPair, kaPair] = await Promise.all([
      generateDeviceSignKeyPair(true),
      generateDeviceKeyAgreementKeyPair(true),
    ]);
    const deviceCertificate = await certifyDevice({
      signingKey,
      signPublicKey: signPair.publicKey,
      kaPublicKey: kaPair.publicKey,
      kaEpoch: 0,
      name,
      capabilities: DEVICE_CAPABILITIES,
      issuedAt,
    });
    const state = await checked(
      {
        masterPublicKey: master.publicKey,
        userId: master.userId,
        deviceCertificate,
        signingKeyCertificate: signingCertificate,
        holdsSigningKey: true,
        roster: await issueDeviceRoster({
          signingKey,
          seq: nextSeq(undefined, issuedAt),
          issuedAt,
          devices: [deviceCertificate],
        }),
        revocation: await issueDeviceRevocationList({
          signingKey,
          seq: nextSeq(undefined, issuedAt),
          issuedAt,
          revokedDeviceIds: [],
        }),
        signingKeyRevocation,
        marks: {},
      },
      issuedAt,
    );

    return locked(async () => {
      // Another session may have created an identity while this operator was at the terminal.
      if (read() !== undefined) return refuse<IDevicesInitResult>('changed-concurrently');
      await storeKeyPair(options.store, signingKeyCredentialKey(signingCertificate.signingKeyId), signingPair);
      await storeKeyPair(options.store, DEVICE_SIGN_KEY, signPair);
      await storeKeyPair(options.store, DEVICE_KA_KEY, kaPair);
      write(state);
      const keyStorage = options.describeKeyStorage?.();
      return {
        ok: true,
        value: {
          userId: master.userId,
          deviceId: deviceCertificate.deviceId,
          signingKeyId: signingCertificate.signingKeyId,
          ...(keyStorage !== undefined ? { keyStorage } : {}),
        },
      };
    });
  }

  async function recover(): Promise<TDevicesOutcome<IDevicesRecoverResult>> {
    const before = read();
    if (before === undefined) return refuse('not-initialized');
    const session = options.openTerminal();
    if (session === undefined) return refuse('no-terminal');

    const derived = await atTerminal(session, async (terminal) => {
      terminal.write(
        'Recovery rotates the signing key: every signing key this device knows of is revoked and a new one is issued.\r\n',
      );
      const phrase = await readExistingPhrase(terminal);
      if (phrase === undefined) return { ok: false, reason: 'phrase-invalid' };
      const passphrase = await readPassphrase(terminal);
      terminal.write('Deriving your keys…\r\n');
      return { ok: true, master: await deriveMasterKey(phrase, passphrase) };
    });
    if (!derived.ok) return refuse(derived.reason);
    const { master } = derived;
    // A wrong passphrase derives a valid but different master key; it is refused as another identity.
    if (master.publicKey !== before.masterPublicKey) return refuse('phrase-mismatch');

    return locked(async () => {
      const current = read();
      if (current === undefined || !unchanged(before, current)) {
        return refuse<IDevicesRecoverResult>('changed-concurrently');
      }
      if (!(await holdsDeviceKeys(options.store, current.deviceCertificate))) {
        throw new DeviceIdentityError(
          "this device's own private keys are missing from the credential store; it cannot be certified again",
        );
      }
      const issuedAt = now();
      const retired = [
        ...current.signingKeyRevocation.revokedSigningKeyIds,
        current.signingKeyCertificate.signingKeyId,
        current.deviceCertificate.signingKeyId,
        current.roster.signingKeyId,
        current.revocation.signingKeyId,
      ];
      const signingKeyRevocation = await issueSigningKeyRevocation({
        masterPrivateKey: master.keyPair.privateKey,
        userId: master.userId,
        seq: nextSeq(
          Math.max(current.signingKeyRevocation.seq, current.marks.signingKeyRevocationSeq ?? 0),
          issuedAt,
        ),
        issuedAt,
        revokedSigningKeyIds: retired,
      });
      const signingPair = await generateSigningKeyPair({ extractable: true });
      const signingCertificate = await certifySigningKey({
        masterPrivateKey: master.keyPair.privateKey,
        userId: master.userId,
        signingPublicKey: signingPair.publicKey,
        issuedAt,
      });
      const signingKey: ISigningKey = { certificate: signingCertificate, privateKey: signingPair.privateKey };
      const self = current.deviceCertificate;
      const deviceCertificate = await certifyDevice({
        signingKey,
        signPublicKey: await importPublicKey('ES256', self.signKey),
        kaPublicKey: await importPublicKey('X25519', self.kaKey),
        kaEpoch: self.kaEpoch,
        name: self.name,
        capabilities: self.capabilities,
        issuedAt,
      });
      // Only this device is carried over. The others were certified by a retired key — possibly the
      // compromised one that is the reason for recovering — so each enrols again under the new key.
      const state = await checked(
        {
          ...current,
          deviceCertificate,
          signingKeyCertificate: signingCertificate,
          holdsSigningKey: true,
          roster: await issueDeviceRoster({
            signingKey,
            seq: nextSeq(undefined, issuedAt),
            issuedAt,
            devices: [deviceCertificate],
          }),
          revocation: await issueDeviceRevocationList({
            signingKey,
            seq: nextSeq(undefined, issuedAt),
            issuedAt,
            revokedDeviceIds: current.revocation.revokedDeviceIds,
          }),
          signingKeyRevocation,
        },
        issuedAt,
      );
      await storeKeyPair(options.store, signingKeyCredentialKey(signingCertificate.signingKeyId), signingPair);
      write(state);
      // The retired key's private half goes only once nothing names it any more.
      if (current.holdsSigningKey) {
        await options.store.delete(signingKeyCredentialKey(current.signingKeyCertificate.signingKeyId));
      }
      return {
        ok: true,
        value: {
          deviceId: deviceCertificate.deviceId,
          signingKeyId: signingCertificate.signingKeyId,
          revokedSigningKeyCount:
            new Set(signingKeyRevocation.revokedSigningKeyIds).size -
            new Set(current.signingKeyRevocation.revokedSigningKeyIds).size,
          droppedDeviceCount: current.roster.devices.filter((d) => d.deviceId !== self.deviceId).length,
        },
      };
    });
  }

  async function revoke(prefix: string): Promise<TDevicesOutcome<IDevicesRevokeResult>> {
    const before = read();
    if (before === undefined) return refuse('not-initialized');
    const matches =
      prefix.length < MIN_ID_PREFIX ? [] : before.roster.devices.filter((d) => d.deviceId.startsWith(prefix));
    if (matches.length === 0) return refuse('unknown-device');
    if (matches.length > 1) return refuse('ambiguous-device');
    const target = matches[0]!;
    if (target.deviceId === before.deviceCertificate.deviceId) return refuse('self-revocation');
    if (!before.holdsSigningKey) return refuse('no-signing-key');
    const signingKey = await loadSigningKey(options.store, before.signingKeyCertificate);
    if (signingKey === undefined) return refuse('no-signing-key');
    if (now() >= signingKey.certificate.expiresAt) return refuse('signing-key-expired');
    const session = options.openTerminal();
    if (session === undefined) return refuse('no-terminal');

    const shortId = target.deviceId.slice(0, SHORT_ID_CHARS);
    let confirmation: string;
    try {
      confirmation = await session.run((terminal) =>
        terminal.readLine(`Revoke "${target.name}" (${shortId})? Type ${shortId} to confirm: `, { echo: true }),
      );
    } catch (error) {
      if (error instanceof SecretInputCancelled) return refuse('cancelled');
      throw error;
    }
    if (confirmation.trim() !== shortId) return refuse('cancelled');

    return locked(async () => {
      const current = read();
      if (current === undefined || !unchanged(before, current)) {
        return refuse<IDevicesRevokeResult>('changed-concurrently');
      }
      const issuedAt = now();
      const marks = current.marks.bySigningKey?.[current.signingKeyCertificate.signingKeyId];
      const state = await checked(
        {
          ...current,
          revocation: await issueDeviceRevocationList({
            signingKey,
            seq: nextSeq(Math.max(current.revocation.seq, marks?.revocationSeq ?? 0), issuedAt),
            issuedAt,
            revokedDeviceIds: [...current.revocation.revokedDeviceIds, target.deviceId],
          }),
          roster: await issueDeviceRoster({
            signingKey,
            seq: nextSeq(Math.max(current.roster.seq, marks?.rosterSeq ?? 0), issuedAt),
            issuedAt,
            devices: current.roster.devices.filter((d) => d.deviceId !== target.deviceId),
          }),
        },
        issuedAt,
      );
      write(state);
      return { ok: true, value: { deviceId: target.deviceId, name: target.name } };
    });
  }

  async function list(): Promise<IDevicesView | undefined> {
    const state = read();
    if (state === undefined) return undefined;
    const self = state.deviceCertificate.deviceId;
    return {
      userId: state.userId,
      devices: state.roster.devices.map((device) => ({
        deviceId: device.deviceId,
        name: device.name,
        thisDevice: device.deviceId === self,
        holdsSigningKey: device.deviceId === self && state.holdsSigningKey,
        certificateExpiresAt: device.expiresAt,
      })),
      revokedDeviceCount: state.revocation.revokedDeviceIds.length,
      listsExpireAt: Math.min(state.roster.expiresAt, state.revocation.expiresAt),
    };
  }

  return {
    list: () => guarded('reading the device identity', list),
    init: (request) => guarded('creating the device identity', () => init(request)),
    recover: () => guarded('recovering the device identity', recover),
    revoke: (prefix) => guarded('revoking the device', () => revoke(prefix)),
  };
}
