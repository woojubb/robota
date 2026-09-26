/**
 * This device's identity among the user's devices — the host side of `/devices`.
 *
 * The recovery phrase exists only inside `openTerminal().run(...)`: it is generated or read there,
 * turned into the master key there, and dropped when that call returns. What leaves is the master
 * key object, which is non-extractable and is itself dropped once it has certified a signing key or
 * issued a signing-key revocation. Nothing the phrase touches is written, returned, or put in an
 * error: results are ids and closed refusal reasons. An enrollment code is held the same way: shown
 * or typed inside the terminal run, and gone when it returns.
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
  deriveEnrollmentMaterial,
  normalizeEnrollmentCode,
  type IMasterKey,
  type ISigningKey,
} from '@robota-sdk/agent-remote-pairing';

import { CredentialStoreError } from '../credentials/credential-store-error.js';
import { withExclusiveFileLock } from '../credentials/exclusive-file-lock.js';
import { DeviceIdentityError } from './device-identity-error.js';
import {
  joinEnrollment,
  offerEnrollment,
  type IEnrollmentEnvironment,
} from './device-enrollment.js';
import { addDialog, joinDialog } from './enrollment-dialog.js';
import {
  DEVICE_KA_KEY,
  DEVICE_SIGN_KEY,
  holdsDeviceKeys,
  importPublicKey,
  loadSigningKey,
  signingKeyCredentialKey,
  storeKeyPair,
} from './identity-keys.js';
import { checked, nextSeq } from './identity-lists.js';
import {
  readIdentityState,
  sameIdentityState,
  writeIdentityState,
  type IDeviceIdentityState,
} from './identity-state.js';
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
import type { IIceServer, IMeshRelay } from '@robota-sdk/agent-transport-webrtc';
import type {
  IDevicesAddResult,
  IDevicesCommandPort,
  IDevicesJoinResult,
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
  /**
   * Opens the signaling relay two devices meet through to enrol one of them, or `undefined` when none
   * is configured; `onError` ends the enrollment. Absent: enrollment is refused.
   */
  readonly openEnrollmentRelay?: (onError: (error: Error) => void) => IMeshRelay | undefined;
  readonly iceServers?: () => readonly IIceServer[] | undefined;
  /** Test seams: the code's lifetime, failed attempts it survives, and the connection timeout. */
  readonly enrollment?: {
    readonly ttlMs?: number;
    readonly maxFailedAttempts?: number;
    readonly connectTimeoutMs?: number;
  };
}

function refuse<T>(reason: TDevicesRefusal): TDevicesOutcome<T> {
  return { ok: false, reason };
}

/**
 * A signed device name: NFC, no control characters, and within the certificate's limit as the
 * certificate counts it (UTF-16 units), cut at a whole character — so certifying it cannot fail
 * after the operator has already written the phrase down.
 */
function deviceName(raw: string): string {
  let name = '';
  for (const ch of raw
    .normalize('NFC')
    .replace(/\p{Cc}/gu, ' ')
    .trim()) {
    if (name.length + ch.length > DEVICE_NAME_MAX_CHARS) break;
    name += ch;
  }
  // A prefix of an NFC string can compose further; composing never lengthens it.
  name = name.trim().normalize('NFC');
  return name.length > 0 ? name : 'device';
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

type TMasterOutcome =
  | { readonly ok: true; readonly master: IMasterKey }
  | { readonly ok: false; readonly reason: TDevicesRefusal };

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

export function createDeviceIdentityService(
  options: IDeviceIdentityServiceOptions,
): IDevicesCommandPort {
  const now = options.now ?? Date.now;
  const random = options.randomInt ?? ((max: number) => randomInt(max));
  const lockPath = join(options.directory, 'identity.lock');
  const read = (): IDeviceIdentityState | undefined => readIdentityState(options.directory);
  const write = (state: IDeviceIdentityState): void =>
    writeIdentityState(options.directory, state, options.withinRoot);
  const locked = <T>(critical: () => Promise<T>): Promise<T> =>
    withExclusiveFileLock(lockPath, critical);

  async function init(request: {
    readonly name?: string;
  }): Promise<TDevicesOutcome<IDevicesInitResult>> {
    if (read() !== undefined) return refuse('already-initialized');
    const name = deviceName(request.name ?? options.defaultDeviceName?.() ?? hostname());
    // Touch the credential store before the phrase is shown: a store that cannot keep the keys
    // (a locked keychain, a recorded backend gone missing) must fail now, not after the ceremony.
    await options.store.get(DEVICE_SIGN_KEY);
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
    const signingKey: ISigningKey = {
      certificate: signingCertificate,
      privateKey: signingPair.privateKey,
    };
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
      await storeKeyPair(
        options.store,
        signingKeyCredentialKey(signingCertificate.signingKeyId),
        signingPair,
      );
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
      if (current === undefined || !sameIdentityState(before, current)) {
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
      const signingKey: ISigningKey = {
        certificate: signingCertificate,
        privateKey: signingPair.privateKey,
      };
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
      await storeKeyPair(
        options.store,
        signingKeyCredentialKey(signingCertificate.signingKeyId),
        signingPair,
      );
      write(state);
      // The retired key's private half goes only once nothing names it any more.
      if (current.holdsSigningKey) {
        await options.store.delete(
          signingKeyCredentialKey(current.signingKeyCertificate.signingKeyId),
        );
      }
      return {
        ok: true,
        value: {
          deviceId: deviceCertificate.deviceId,
          signingKeyId: signingCertificate.signingKeyId,
          revokedSigningKeyCount:
            new Set(signingKeyRevocation.revokedSigningKeyIds).size -
            new Set(current.signingKeyRevocation.revokedSigningKeyIds).size,
          droppedDeviceCount: current.roster.devices.filter((d) => d.deviceId !== self.deviceId)
            .length,
        },
      };
    });
  }

  async function revoke(prefix: string): Promise<TDevicesOutcome<IDevicesRevokeResult>> {
    const before = read();
    if (before === undefined) return refuse('not-initialized');
    const matches =
      prefix.length < MIN_ID_PREFIX
        ? []
        : before.roster.devices.filter((d) => d.deviceId.startsWith(prefix));
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
        terminal.readLine(`Revoke "${target.name}" (${shortId})? Type ${shortId} to confirm: `, {
          echo: true,
        }),
      );
    } catch (error) {
      if (error instanceof SecretInputCancelled) return refuse('cancelled');
      throw error;
    }
    if (confirmation.trim() !== shortId) return refuse('cancelled');

    return locked(async () => {
      const current = read();
      if (current === undefined || !sameIdentityState(before, current)) {
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

  function enrollmentEnvironment(
    relay: IMeshRelay,
    relayFailed: AbortSignal,
  ): IEnrollmentEnvironment {
    const iceServers = options.iceServers?.();
    const connectTimeoutMs = options.enrollment?.connectTimeoutMs;
    return {
      directory: options.directory,
      ...(options.withinRoot !== undefined ? { withinRoot: options.withinRoot } : {}),
      store: options.store,
      relay,
      relayFailed,
      now,
      ...(iceServers !== undefined ? { iceServers } : {}),
      ...(connectTimeoutMs !== undefined ? { connectTimeoutMs } : {}),
    };
  }

  /** Run an enrollment on the terminal with a relay of its own, closed however it ends. */
  async function enrolling<T>(
    work: (
      environment: IEnrollmentEnvironment,
      terminal: ISecretTerminal,
    ) => Promise<TDevicesOutcome<T>>,
  ): Promise<TDevicesOutcome<T>> {
    const openRelay = options.openEnrollmentRelay;
    if (openRelay === undefined) return refuse('no-relay');
    const session = options.openTerminal();
    if (session === undefined) return refuse('no-terminal');
    const relayFailed = new AbortController();
    const relay = openRelay(() => relayFailed.abort());
    if (relay === undefined) return refuse('no-relay');
    try {
      return await session.run((terminal) =>
        work(enrollmentEnvironment(relay, relayFailed.signal), terminal),
      );
    } catch (error) {
      if (error instanceof SecretInputCancelled) return refuse('cancelled');
      throw error;
    } finally {
      relay.close();
    }
  }

  async function addDevice(): Promise<TDevicesOutcome<IDevicesAddResult>> {
    const before = read();
    if (before === undefined) return refuse('not-initialized');
    if (!before.holdsSigningKey) return refuse('no-signing-key');
    const signingKey = await loadSigningKey(options.store, before.signingKeyCertificate);
    if (signingKey === undefined) return refuse('no-signing-key');
    if (now() >= signingKey.certificate.expiresAt) return refuse('signing-key-expired');
    return enrolling(async (environment, terminal) => {
      const dialog = addDialog(terminal);
      try {
        return await offerEnrollment({
          ...environment,
          before,
          signingKey,
          ...(options.enrollment?.ttlMs !== undefined ? { ttlMs: options.enrollment.ttlMs } : {}),
          ...(options.enrollment?.maxFailedAttempts !== undefined
            ? { maxFailedAttempts: options.enrollment.maxFailedAttempts }
            : {}),
          showCode: dialog.showCode,
          operator: dialog,
          cancelled: dialog.cancelled,
        });
      } finally {
        dialog.end();
      }
    });
  }

  async function joinDevices(request: {
    readonly name?: string;
  }): Promise<TDevicesOutcome<IDevicesJoinResult>> {
    if (read() !== undefined) return refuse('already-initialized');
    // A code typed as the name is now in the session's history; it must not be used.
    if (request.name !== undefined && normalizeEnrollmentCode(request.name) !== undefined) {
      return refuse('code-on-command-line');
    }
    // The name is shown to the operator deciding on the other device: nothing invisible in it.
    const name = deviceName(
      (request.name ?? options.defaultDeviceName?.() ?? hostname()).replace(/\p{Cf}/gu, ''),
    );
    // A store that cannot keep the keys must fail now, not after the other operator said yes.
    await options.store.get(DEVICE_SIGN_KEY);
    return enrolling(async (environment, terminal) => {
      const dialog = await joinDialog(terminal);
      try {
        if (dialog.code === undefined) return refuse<IDevicesJoinResult>('code-invalid');
        return await joinEnrollment({
          ...environment,
          material: await deriveEnrollmentMaterial(dialog.code),
          name,
          operator: dialog,
          cancelled: dialog.cancelled,
          ...(options.describeKeyStorage !== undefined
            ? { describeKeyStorage: options.describeKeyStorage }
            : {}),
        });
      } finally {
        dialog.end();
      }
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
    add: () => guarded('enrolling a device', addDevice),
    join: (request) => guarded('joining the devices', () => joinDevices(request)),
  };
}
