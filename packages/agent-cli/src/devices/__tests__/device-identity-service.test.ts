import { mkdtempSync, readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  certifyDevice,
  generateDeviceKeyAgreementKeyPair,
  generateDeviceSignKeyPair,
  generateRecoveryPhrase,
  issueDeviceRoster,
  validateRecoveryPhrase,
  verifyDeviceChain,
} from '@robota-sdk/agent-remote-pairing';

import { CredentialStoreError } from '../../credentials/credential-store-error.js';
import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import { loadSigningKey, signingKeyCredentialKey } from '../identity-keys.js';
import { readIdentityState, writeIdentityState, type IDeviceIdentityState } from '../identity-state.js';
import { SecretInputCancelled } from '../secret-terminal.js';
import { scriptedOperator, type IScriptedOperator } from './fake-secret-terminal.js';
import { filesUnder, leakedIn, phraseFragments } from './secret-leak.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';
import type { IDevicesCommandPort } from '@robota-sdk/agent-command';

/** Long enough that finding it anywhere means it leaked, not that random base64 spelled it. */
const PASSPHRASE = 'violet lantern ninety-one';
const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 8, 26, 12);

let home: string;
let root: string;
let directory: string;
let store: ICredentialStore;
let clock: number;

beforeEach(() => {
  home = mkdtempSync(join(tmpdir(), 'robota-devices-'));
  root = join(home, '.robota');
  directory = join(root, 'devices');
  store = createFileCredentialStore(join(root, 'credentials'), { withinRoot: root });
  clock = START;
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function service(operator: IScriptedOperator | undefined): IDevicesCommandPort {
  return createDeviceIdentityService({
    directory,
    withinRoot: root,
    store,
    openTerminal: () => operator?.session,
    now: () => clock,
    defaultDeviceName: () => 'test-host',
    describeKeyStorage: () => 'owner-only file (test)',
  });
}

function state(): IDeviceIdentityState {
  const current = readIdentityState(directory);
  if (current === undefined) throw new Error('no identity state');
  return current;
}

async function verifySelf(s: IDeviceIdentityState, now = clock) {
  return verifyDeviceChain({
    masterPublicKey: s.masterPublicKey,
    signingKeyCert: s.signingKeyCertificate,
    deviceCert: s.deviceCertificate,
    roster: s.roster,
    revocation: s.revocation,
    signingKeyRevocation: s.signingKeyRevocation,
    now,
    required: { roster: true, revocation: true, signingKeyRevocation: true },
  });
}

/** Enrol a second device the way `add` will: certified by the held signing key, added to the roster. */
async function enrolSecondDevice(name = 'desktop') {
  const s = state();
  const signingKey = await loadSigningKey(store, s.signingKeyCertificate);
  if (signingKey === undefined) throw new Error('no signing key');
  const [sign, ka] = await Promise.all([
    generateDeviceSignKeyPair(false),
    generateDeviceKeyAgreementKeyPair(false),
  ]);
  const certificate = await certifyDevice({
    signingKey,
    signPublicKey: sign.publicKey,
    kaPublicKey: ka.publicKey,
    kaEpoch: 0,
    name,
    capabilities: ['message', 'presence'],
    issuedAt: clock,
  });
  const roster = await issueDeviceRoster({
    signingKey,
    seq: s.roster.seq + 1,
    issuedAt: clock,
    devices: [...s.roster.devices, certificate],
  });
  writeIdentityState(directory, { ...s, roster }, root);
  return certificate;
}

async function initialized(passphrase?: string): Promise<{ words: readonly string[] }> {
  const operator = scriptedOperator(passphrase === undefined ? {} : { passphrase });
  const outcome = await service(operator).init({});
  expect(outcome.ok).toBe(true);
  return { words: operator.shownWords() };
}

describe('/devices init', () => {
  it('shows a valid phrase once and creates a verifiable identity kept owner-only', async () => {
    const operator = scriptedOperator({ passphrase: 'correct horse' });
    const outcome = await service(operator).init({ name: 'laptop' });
    expect(outcome).toMatchObject({ ok: true });
    const words = operator.shownWords();
    expect(words).toHaveLength(24);
    expect(validateRecoveryPhrase(words.join(' '))).toEqual({ ok: true });

    const s = state();
    expect(s.deviceCertificate.name).toBe('laptop');
    expect(s.holdsSigningKey).toBe(true);
    expect(await verifySelf(s)).toMatchObject({ ok: true, deviceId: s.deviceCertificate.deviceId });
    if (outcome.ok) {
      expect(outcome.value.deviceId).toBe(s.deviceCertificate.deviceId);
      expect(outcome.value.keyStorage).toBe('owner-only file (test)');
    }
    if (process.platform !== 'win32') {
      expect(statSync(directory).mode & 0o777).toBe(0o700);
      for (const name of readdirSync(directory)) {
        expect(statSync(join(directory, name)).mode & 0o777).toBe(0o600);
      }
    }

    // The phrase and passphrase are nowhere on disk and not in the result.
    const fragments = phraseFragments(words, 'correct horse');
    for (const file of filesUnder(home)) expect(leakedIn(file.text, fragments)).toEqual([]);
    expect(leakedIn(JSON.stringify(outcome), fragments)).toEqual([]);
  });

  it('lists this device as the signing-key holder', async () => {
    await initialized();
    const view = await service(undefined).list();
    expect(view?.devices).toEqual([
      expect.objectContaining({ name: 'test-host', thisDevice: true, holdsSigningKey: true }),
    ]);
    expect(view?.revokedDeviceCount).toBe(0);
    expect(view?.listsExpireAt).toBe(START + DAY);
  });

  it('refuses a second init without opening the terminal', async () => {
    await initialized();
    const operator = scriptedOperator();
    expect(await service(operator).init({})).toEqual({ ok: false, reason: 'already-initialized' });
    expect(operator.runs()).toBe(0);
  });

  it('writes nothing when the re-typed words do not match', async () => {
    const operator = scriptedOperator({ wrongConfirmation: 'zoo' });
    expect(await service(operator).init({})).toEqual({ ok: false, reason: 'confirmation-failed' });
    expect(readIdentityState(directory)).toBeUndefined();
    expect(await service(undefined).list()).toBeUndefined();
  });

  it('writes nothing when the passphrase is not repeated exactly', async () => {
    const operator = scriptedOperator({ passphrase: PASSPHRASE, passphraseTypo: true });
    expect(await service(operator).init({})).toEqual({ ok: false, reason: 'confirmation-failed' });
    expect(readIdentityState(directory)).toBeUndefined();
  });

  it('reports a cancellation at the terminal', async () => {
    const operator = scriptedOperator({ failWith: new SecretInputCancelled() });
    expect(await service(operator).init({})).toEqual({ ok: false, reason: 'cancelled' });
    expect(readIdentityState(directory)).toBeUndefined();
  });

  it('refuses init, recover and revoke without an interactive terminal (fail closed)', async () => {
    expect(await service(undefined).init({})).toEqual({ ok: false, reason: 'no-terminal' });
    await initialized();
    await enrolSecondDevice();
    const other = state().roster.devices.find((d) => d.name === 'desktop')!;
    expect(await service(undefined).recover()).toEqual({ ok: false, reason: 'no-terminal' });
    expect(await service(undefined).revoke(other.deviceId.slice(0, 8))).toEqual({
      ok: false,
      reason: 'no-terminal',
    });
  });
});

describe('/devices init: nothing is shown that cannot be kept', () => {
  it('fits a long non-ASCII name to the certificate limit instead of failing after the phrase', async () => {
    const operator = scriptedOperator();
    const outcome = await service(operator).init({ name: '🔑'.repeat(40) });
    expect(outcome.ok).toBe(true);
    expect(state().deviceCertificate.name.length).toBeLessThanOrEqual(64);
  });

  it('refuses before showing a phrase when the credential store cannot be used', async () => {
    store = {
      get: () => Promise.reject(new CredentialStoreError('keychain locked')),
      set: () => Promise.reject(new CredentialStoreError('keychain locked')),
      delete: () => Promise.reject(new CredentialStoreError('keychain locked')),
    };
    const operator = scriptedOperator();
    await expect(service(operator).init({})).rejects.toThrow('keychain locked');
    expect(operator.runs()).toBe(0);
  });
});

describe('another session changing the identity meanwhile', () => {
  it('init refuses when an identity appeared while the operator was at the terminal', async () => {
    let otherDeviceId = '';
    const operator = scriptedOperator({
      meanwhile: async () => {
        const other = await service(scriptedOperator()).init({ name: 'other session' });
        if (other.ok) otherDeviceId = other.value.deviceId;
      },
    });
    expect(await service(operator).init({})).toEqual({ ok: false, reason: 'changed-concurrently' });
    expect(state().deviceCertificate.deviceId).toBe(otherDeviceId);
  });

  it('revoke refuses and keeps the other change', async () => {
    await initialized();
    const other = await enrolSecondDevice();
    let changed: IDeviceIdentityState | undefined;
    const operator = scriptedOperator({
      meanwhile: async () => {
        await enrolSecondDevice('laptop 2');
        changed = state();
      },
    });
    expect(await service(operator).revoke(other.deviceId.slice(0, 8))).toEqual({
      ok: false,
      reason: 'changed-concurrently',
    });
    expect(state()).toEqual(changed);
  });

  it('recover refuses and keeps the other change', async () => {
    const { words } = await initialized();
    let changed: IDeviceIdentityState | undefined;
    const operator = scriptedOperator({
      phrase: () => words,
      meanwhile: async () => {
        await enrolSecondDevice();
        changed = state();
      },
    });
    expect(await service(operator).recover()).toEqual({ ok: false, reason: 'changed-concurrently' });
    expect(state()).toEqual(changed);
  });
});

describe('/devices revoke', () => {
  it('issues a roster and revocation list that refuse the revoked device', async () => {
    await initialized();
    const other = await enrolSecondDevice();
    const before = state();
    const operator = scriptedOperator();
    const outcome = await service(operator).revoke(other.deviceId.slice(0, 8));
    expect(outcome).toEqual({ ok: true, value: { deviceId: other.deviceId, name: 'desktop' } });

    const after = state();
    expect(after.roster.devices.map((d) => d.deviceId)).toEqual([after.deviceCertificate.deviceId]);
    expect(after.revocation.revokedDeviceIds).toEqual([other.deviceId]);
    expect(after.revocation.seq).toBeGreaterThan(before.revocation.seq);
    expect(after.roster.seq).toBeGreaterThan(before.roster.seq);

    const verdict = await verifyDeviceChain({
      masterPublicKey: after.masterPublicKey,
      signingKeyCert: after.signingKeyCertificate,
      deviceCert: other,
      revocation: after.revocation,
      roster: after.roster,
      signingKeyRevocation: after.signingKeyRevocation,
      now: clock,
    });
    expect(verdict).toMatchObject({ ok: false, reason: 'revoked', subject: 'revocation' });
    expect(await verifySelf(after)).toMatchObject({ ok: true });
    expect((await service(undefined).list())?.revokedDeviceCount).toBe(1);
  });

  it('changes nothing when the operator does not confirm', async () => {
    await initialized();
    const other = await enrolSecondDevice();
    const before = state();
    const operator = scriptedOperator({ revokeAnswer: () => 'no' });
    expect(await service(operator).revoke(other.deviceId.slice(0, 8))).toEqual({
      ok: false,
      reason: 'cancelled',
    });
    expect(state()).toEqual(before);
  });

  it('refuses this device, an unknown id, and a device without the signing key', async () => {
    await initialized();
    await enrolSecondDevice();
    const s = state();
    const operator = scriptedOperator();
    expect(await service(operator).revoke(s.deviceCertificate.deviceId.slice(0, 8))).toEqual({
      ok: false,
      reason: 'self-revocation',
    });
    expect(await service(operator).revoke('zzzzzzzz')).toEqual({ ok: false, reason: 'unknown-device' });
    writeIdentityState(directory, { ...s, holdsSigningKey: false }, root);
    const other = s.roster.devices.find((d) => d.name === 'desktop')!;
    expect(await service(operator).revoke(other.deviceId.slice(0, 8))).toEqual({
      ok: false,
      reason: 'no-signing-key',
    });
    expect(operator.runs()).toBe(0);
  });

  it('refuses with an expired signing key', async () => {
    await initialized();
    const other = await enrolSecondDevice();
    clock = START + 91 * DAY;
    expect(await service(scriptedOperator()).revoke(other.deviceId.slice(0, 8))).toEqual({
      ok: false,
      reason: 'signing-key-expired',
    });
  });
});

describe('/devices recover', () => {
  it('rotates the signing key: the old one verifies as revoked, this device is certified again', async () => {
    const { words } = await initialized(PASSPHRASE);
    await enrolSecondDevice();
    const before = state();
    const oldAccount = signingKeyCredentialKey(before.signingKeyCertificate.signingKeyId);
    clock += DAY;

    const operator = scriptedOperator({ phrase: () => words, passphrase: PASSPHRASE });
    const outcome = await service(operator).recover();
    expect(outcome).toMatchObject({
      ok: true,
      value: { deviceId: before.deviceCertificate.deviceId, revokedSigningKeyCount: 1, droppedDeviceCount: 1 },
    });

    const after = state();
    expect(after.signingKeyCertificate.signingKeyId).not.toBe(before.signingKeyCertificate.signingKeyId);
    expect(after.deviceCertificate.deviceId).toBe(before.deviceCertificate.deviceId);
    expect(after.deviceCertificate.signingKeyId).toBe(after.signingKeyCertificate.signingKeyId);
    expect(after.signingKeyRevocation.revokedSigningKeyIds).toContain(
      before.signingKeyCertificate.signingKeyId,
    );
    expect(after.signingKeyRevocation.seq).toBeGreaterThan(before.signingKeyRevocation.seq);
    expect(await verifySelf(after)).toMatchObject({ ok: true });

    // The old chain, checked against the new signing-key revocation, is refused.
    const old = await verifyDeviceChain({
      masterPublicKey: after.masterPublicKey,
      signingKeyCert: before.signingKeyCertificate,
      deviceCert: before.deviceCertificate,
      signingKeyRevocation: after.signingKeyRevocation,
      now: clock,
    });
    expect(old).toMatchObject({ ok: false, reason: 'signing-key-revoked' });

    // The retired signing key is gone from the store; the new one is there.
    expect(await store.get(oldAccount)).toBeUndefined();
    expect(await loadSigningKey(store, after.signingKeyCertificate)).toBeDefined();

    const fragments = phraseFragments(words, PASSPHRASE);
    for (const file of filesUnder(home)) expect(leakedIn(file.text, fragments)).toEqual([]);
    expect(leakedIn(JSON.stringify(outcome), fragments)).toEqual([]);
  });

  it('refuses a phrase or passphrase of another identity and changes nothing', async () => {
    const { words } = await initialized(PASSPHRASE);
    const before = state();
    const other = generateRecoveryPhrase().split(' ');
    expect(await service(scriptedOperator({ phrase: () => other, passphrase: PASSPHRASE })).recover()).toEqual({
      ok: false,
      reason: 'phrase-mismatch',
    });
    expect(await service(scriptedOperator({ phrase: () => words, passphrase: 'nope' })).recover()).toEqual({
      ok: false,
      reason: 'phrase-mismatch',
    });
    expect(state()).toEqual(before);
  });

  it('refuses words that do not form a phrase', async () => {
    const { words } = await initialized();
    const broken = [...words.slice(0, 23), words[23] === 'zoo' ? 'abandon' : 'zoo'];
    // Whatever the last word, one of these two breaks the checksum or the identity.
    const outcome = await service(scriptedOperator({ phrase: () => broken })).recover();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(['phrase-invalid', 'phrase-mismatch']).toContain(outcome.reason);
  });

  it('needs an identity to recover', async () => {
    expect(await service(scriptedOperator()).recover()).toEqual({ ok: false, reason: 'not-initialized' });
  });
});
