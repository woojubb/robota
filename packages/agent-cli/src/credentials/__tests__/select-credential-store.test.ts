import {
  existsSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createHostCredentialStore, selectCredentialStore } from '../select-credential-store.js';
import { createFakeKeyring } from './fake-keyring.js';

/**
 * Which backend holds the host's secrets is chosen once, said out loud, and then kept: a keychain
 * that stops working later must not quietly send new secrets to a file, because the secrets already
 * in the keychain would silently stop being found.
 */

let root: string;

beforeEach(() => {
  root = join(realpathSync(mkdtempSync(join(tmpdir(), 'credential-select-'))), '.robota');
});

afterEach(() => {
  rmSync(join(root, '..'), { recursive: true, force: true });
});

const markerPath = (): string => join(root, 'credentials', 'backend.json');
const recorded = (): unknown =>
  (JSON.parse(readFileSync(markerPath(), 'utf8')) as { backend: unknown }).backend;
const absent = (): never => {
  throw new Error("Cannot find module '@napi-rs/keyring'");
};

describe('selectCredentialStore', () => {
  it('uses the OS keychain when the binding loads and a probe round-trips, and records it', async () => {
    const { module, controls } = createFakeKeyring();
    const selected = await selectCredentialStore({
      root,
      loadKeyring: () => module,
      platform: 'darwin',
    });

    expect(selected.backend).toBe('os-keychain');
    expect(selected.description).toMatch(/OS keychain \(macOS Keychain\)/);
    expect(recorded()).toBe('os-keychain');
    expect(controls.entries.size).toBe(0); // the probe cleaned up after itself
  });

  it('falls back to the owner-only file when the binding is absent, and says why', async () => {
    const selected = await selectCredentialStore({ root, loadKeyring: absent });

    expect(selected.backend).toBe('owner-only-file');
    expect(selected.description).toContain(join(root, 'credentials'));
    expect(selected.description).toMatch(/OS keychain unavailable: .*@napi-rs\/keyring/);
    expect(recorded()).toBe('owner-only-file');
  });

  it('falls back when the keychain loads but cannot store', async () => {
    const { module, controls } = createFakeKeyring();
    controls.failSet = 'no Secret Service on the session bus';
    const selected = await selectCredentialStore({ root, loadKeyring: () => module });
    expect(selected.backend).toBe('owner-only-file');
    expect(selected.description).toMatch(/no Secret Service/);
  });

  it('falls back when the keychain accepts a write and does not keep it', async () => {
    const { module, controls } = createFakeKeyring();
    controls.dropWrites = true;
    const selected = await selectCredentialStore({ root, loadKeyring: () => module });
    expect(selected.backend).toBe('owner-only-file');
  });

  it('fails closed when the recorded keychain is unavailable now, instead of degrading to a file', async () => {
    const { module } = createFakeKeyring();
    await selectCredentialStore({ root, loadKeyring: () => module });

    await expect(selectCredentialStore({ root, loadKeyring: absent })).rejects.toThrow(
      /OS keychain.*unavailable/,
    );
    expect(recorded()).toBe('os-keychain');
  });

  it('keeps the recorded file backend even once a keychain becomes available', async () => {
    await selectCredentialStore({ root, loadKeyring: absent });
    const { module } = createFakeKeyring();
    const selected = await selectCredentialStore({ root, loadKeyring: () => module });
    expect(selected.backend).toBe('owner-only-file');
    expect(selected.description).toMatch(/recorded/);
  });

  it('two processes choosing at once agree on the keychain instead of one probe spoiling the other', async () => {
    const { module } = createFakeKeyring();
    const [first, second] = await Promise.all([
      selectCredentialStore({ root, loadKeyring: () => module }),
      selectCredentialStore({ root, loadKeyring: () => module }),
    ]);
    expect(first.backend).toBe('os-keychain');
    expect(second.backend).toBe('os-keychain');
    expect(recorded()).toBe('os-keychain');
  });

  it('fails fast on a record it cannot read', async () => {
    mkdirSync(join(root, 'credentials'), { recursive: true });
    writeFileSync(markerPath(), '{ nope');
    await expect(selectCredentialStore({ root, loadKeyring: absent })).rejects.toThrow(
      /backend\.json/,
    );
  });
});

describe('createHostCredentialStore', () => {
  it('chooses nothing until a secret is first needed, then reports the choice', async () => {
    const notices: string[] = [];
    const host = createHostCredentialStore({
      root,
      loadKeyring: absent,
      notify: (message) => notices.push(message),
    });
    expect(host.describe()).toBeUndefined();
    expect(existsSync(markerPath())).toBe(false);

    await host.store.set({ service: 'robota.test', account: 'a' }, 'v');
    expect(host.describe()).toMatch(/owner-only file/);
    expect(notices).toHaveLength(1);
    expect(notices[0]).toMatch(/OS keychain unavailable/);

    await host.store.get({ service: 'robota.test', account: 'a' });
    expect(notices).toHaveLength(1); // told once, not on every use
  });

  it('says nothing extra when the keychain is in use', async () => {
    const notices: string[] = [];
    const { module } = createFakeKeyring();
    const host = createHostCredentialStore({
      root,
      loadKeyring: () => module,
      notify: (message) => notices.push(message),
    });
    await host.store.get({ service: 'robota.test', account: 'a' });
    expect(host.describe()).toMatch(/OS keychain/);
    expect(notices).toEqual([]);
  });

  it('retries a failed selection on the next use rather than remembering the failure', async () => {
    const { module } = createFakeKeyring();
    await selectCredentialStore({ root, loadKeyring: () => module });
    let available = false;
    const host = createHostCredentialStore({
      root,
      loadKeyring: () => (available ? module : absent()),
      notify: () => undefined,
    });
    await expect(host.store.get({ service: 'robota.test', account: 'a' })).rejects.toThrow();
    expect(host.describe()).toMatch(/^unavailable \(.*OS keychain/);
    available = true;
    await expect(host.store.get({ service: 'robota.test', account: 'a' })).resolves.toBeUndefined();
  });
});
