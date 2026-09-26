import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { verifyDeviceChain } from '@robota-sdk/agent-remote-pairing';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createFileCredentialStore } from '../../credentials/file-credential-store.js';
import { createDeviceIdentityService } from '../device-identity-service.js';
import {
  LIST_REISSUE_MARGIN_MS,
  reissueDueLists,
  scheduleListReissue,
} from '../device-list-reissue.js';
import {
  readIdentityState,
  writeIdentityState,
  type IDeviceIdentityState,
} from '../identity-state.js';
import { scriptedOperator } from './fake-secret-terminal.js';

import type { ICredentialStore } from '@robota-sdk/agent-core';

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;
const START = Date.UTC(2026, 8, 26, 12);

let home: string;
let root: string;
let directory: string;
let store: ICredentialStore;
let clock: number;

beforeEach(async () => {
  home = mkdtempSync(join(tmpdir(), 'robota-reissue-'));
  root = join(home, '.robota');
  directory = join(root, 'devices');
  store = createFileCredentialStore(join(root, 'credentials'), { withinRoot: root });
  clock = START;
  const outcome = await createDeviceIdentityService({
    directory,
    withinRoot: root,
    store,
    openTerminal: () => scriptedOperator().session,
    now: () => clock,
    defaultDeviceName: () => 'laptop',
  }).init({});
  expect(outcome.ok).toBe(true);
});

afterEach(() => {
  rmSync(home, { recursive: true, force: true });
});

function state(): IDeviceIdentityState {
  const current = readIdentityState(directory);
  if (current === undefined) throw new Error('no identity state');
  return current;
}

function reissue() {
  return reissueDueLists({ directory, withinRoot: root, store, now: () => clock });
}

describe('revocation list and roster reissue', () => {
  it('leaves lists alone while they have time left', async () => {
    const before = state();
    clock = START + DAY - LIST_REISSUE_MARGIN_MS - HOUR;
    await expect(reissue()).resolves.toBe('not-due');
    expect(state().revocation.sig).toBe(before.revocation.sig);
  });

  it('reissues both lists before they expire, same content, higher seq, a new day of validity', async () => {
    const before = state();
    clock = START + DAY - LIST_REISSUE_MARGIN_MS + HOUR;
    await expect(reissue()).resolves.toBe('reissued');
    const after = state();
    expect(after.revocation.seq).toBeGreaterThan(before.revocation.seq);
    expect(after.roster.seq).toBeGreaterThan(before.roster.seq);
    expect(after.revocation.expiresAt).toBe(clock + DAY);
    expect(after.roster.expiresAt).toBe(clock + DAY);
    expect(after.revocation.revokedDeviceIds).toEqual(before.revocation.revokedDeviceIds);
    expect(after.roster.devices.map((d) => d.deviceId)).toEqual(
      before.roster.devices.map((d) => d.deviceId),
    );
    // What a peer would check a day after the original lists expired.
    clock = START + DAY + 12 * HOUR;
    const verdict = await verifyDeviceChain({
      masterPublicKey: after.masterPublicKey,
      signingKeyCert: after.signingKeyCertificate,
      deviceCert: after.deviceCertificate,
      roster: after.roster,
      revocation: after.revocation,
      signingKeyRevocation: after.signingKeyRevocation,
      now: clock,
      lastSeen: before.marks,
      required: { roster: true, revocation: true, signingKeyRevocation: true },
    });
    expect(verdict.ok).toBe(true);
    expect(verdict.ok && verdict.listsExpiredAt).toBeUndefined();
  });

  it('also reissues lists that already expired while the host was not running', async () => {
    clock = START + 3 * DAY;
    await expect(reissue()).resolves.toBe('reissued');
    expect(state().revocation.expiresAt).toBe(clock + DAY);
  });

  it('a device without the signing key does not reissue', async () => {
    writeIdentityState(directory, { ...state(), holdsSigningKey: false }, root);
    clock = START + 2 * DAY;
    await expect(reissue()).resolves.toBe('not-holder');
  });

  it('an expired signing key issues nothing; only recovery issues a new one', async () => {
    const before = state();
    clock = before.signingKeyCertificate.expiresAt + HOUR;
    await expect(reissue()).resolves.toBe('signing-key-expired');
    expect(state().revocation.sig).toBe(before.revocation.sig);
  });

  it('the schedule checks at once and stops cleanly', async () => {
    const before = state();
    clock = START + 2 * DAY;
    const errors: unknown[] = [];
    const stop = scheduleListReissue({
      directory,
      withinRoot: root,
      store,
      now: () => clock,
      onError: (error) => errors.push(error),
    });
    await expect.poll(() => state().revocation.seq).toBeGreaterThan(before.revocation.seq);
    stop();
    expect(errors).toEqual([]);
  });

  it('the schedule says when it reissued, so a running mesh can push the new lists', async () => {
    const reissued: string[] = [];
    clock = START + 2 * DAY;
    const stop = scheduleListReissue({
      directory,
      withinRoot: root,
      store,
      now: () => clock,
      onReissued: () => reissued.push('reissued'),
    });
    await expect.poll(() => reissued).toEqual(['reissued']);
    stop();

    // Nothing due: nothing said.
    const quiet: string[] = [];
    const again = scheduleListReissue({
      directory,
      withinRoot: root,
      store,
      now: () => clock,
      onReissued: () => quiet.push('reissued'),
    });
    await new Promise((resolve) => setTimeout(resolve, 100));
    again();
    expect(quiet).toEqual([]);
  });
});
