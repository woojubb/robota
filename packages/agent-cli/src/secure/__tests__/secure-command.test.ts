import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  createKeyring,
  fingerprint,
  getSealingPublicKey,
  parseKeyring,
  serializeKeyring,
  unlockWithPassphrase,
  unlockWithRecoveryKey,
  type IKeyring,
} from '@robota-sdk/agent-keyring';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { resolveCliRuntimeContext } from '../../startup/product-bootstrap.js';
import { writeProductConversationMode } from '../conversation-mode-state.js';
import { createKeyringFileStore } from '@robota-sdk/agent-local-host';
import { SECURE_USAGE, runSecureCommand, type ISecureCommandOptions } from '../secure-command.js';
import {
  FIXTURE_PASSPHRASE,
  OTHER_PASSPHRASE,
  fixtureKeyring,
  scriptedSecureTerminal,
  withSwappedSealingKey,
  type IScriptedPerson,
  type IScriptedSecureTerminal,
} from './helpers.js';

const NEW_PASSPHRASE = 'brand new long passphrase';
const isWindows = process.platform === 'win32';
const PERMISSIVE_UMASK = 0o022;

let home: string;
let previousUmask: number;
let stdout: string[];
let stderr: string[];

beforeEach(() => {
  previousUmask = process.umask(PERMISSIVE_UMASK);
  home = realpathSync(mkdtempSync(join(tmpdir(), 'secure-command-')));
  stdout = [];
  stderr = [];
});

afterEach(() => {
  process.umask(previousUmask);
  vi.unstubAllEnvs();
  rmSync(home, { recursive: true, force: true });
});

const runtime = (): ReturnType<typeof createTestProductRuntime> =>
  createTestProductRuntime('test-product', { HOME: home });
const keyringPath = (): string => runtime().layout.userPaths.keyring;
const secureDirectory = (): string => runtime().layout.userPaths.secure;
const mode = (path: string): number => statSync(path).mode & 0o7777;
const out = (): string => stdout.join('');
const err = (): string => stderr.join('');

/** Runs `secure <args>` as a person at a terminal would: stdin and stdout are terminals. */
async function secure(
  args: readonly string[],
  person: IScriptedPerson = {},
  overrides: Partial<ISecureCommandOptions> = {},
): Promise<{ code: number; terminal: IScriptedSecureTerminal }> {
  const terminal = scriptedSecureTerminal(person);
  const code = await runSecureCommand(args, {
    productRuntime: runtime(),
    stdout: (text) => stdout.push(text),
    stderr: (text) => stderr.push(text),
    stdinIsTTY: true,
    stdoutIsTTY: true,
    openTerminal: () => terminal.session,
    ...overrides,
  });
  return { code, terminal };
}

function store(
  durability?: Parameters<typeof createKeyringFileStore>[0]['durability'],
): ReturnType<typeof createKeyringFileStore> {
  return createKeyringFileStore({
    path: keyringPath(),
    root: runtime().layout.userRoot,
    ...(durability === undefined ? {} : { durability }),
  });
}

/** The keyring put on disk directly, as another process (or an attacker with write access) would. */
function writeKeyringFile(keyring: IKeyring): void {
  mkdirSync(secureDirectory(), { recursive: true });
  writeFileSync(keyringPath(), serializeKeyring(keyring), { mode: 0o600 });
}

/** An existing keyring on disk, without paying for another key derivation per test. */
async function installFixtureKeyring(): Promise<{ keyring: IKeyring; recoveryKey: string }> {
  const fixture = await fixtureKeyring();
  writeKeyringFile(fixture.keyring);
  return fixture;
}

const ioError =
  (code: string): (() => never) =>
  () => {
    throw Object.assign(new Error(`${code} at /secret/path`), { code });
  };

async function strangerKeyring(): Promise<IKeyring> {
  const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
  stranger.unlocked.lock();
  return stranger.keyring;
}

function storedKeyring(): IKeyring {
  return parseKeyring(readFileSync(keyringPath(), 'utf8'));
}

function everythingUnder(root: string): string {
  const parts: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) walk(path);
      else if (entry.isFile()) parts.push(readFileSync(path, 'latin1'));
    }
  };
  walk(root);
  return parts.join('\n');
}

function occurrences(text: string, needle: string): number {
  return text.split(needle).length - 1;
}

describe('secure setup', () => {
  it('creates the keyring, shows the recovery key once on the terminal, and says what it did', async () => {
    const { code, terminal } = await secure(['setup'], { newPassphrase: NEW_PASSPHRASE });

    expect(code).toBe(0);
    const keyring = storedKeyring();
    const printed = fingerprint(getSealingPublicKey(keyring));
    expect(out()).toContain(keyringPath());
    expect(out()).toContain(printed);
    expect(out()).toMatch(/secure status/);
    expect(out()).toMatch(/not stored anywhere/);
    expect(out()).toMatch(/Secure mode is not turned on/);
    expect(out()).toMatch(/only copy of your keys/);
    expect(err()).toBe('');

    // Both secrets work against what was written.
    (await unlockWithPassphrase(keyring, NEW_PASSPHRASE)).lock();
    const recoveryKey = terminal.shownRecoveryKey();
    expect(recoveryKey).toBeDefined();
    (await unlockWithRecoveryKey(keyring, recoveryKey!)).lock();
  });

  it.skipIf(isWindows)(
    'writes the directory 0700 and the file 0600 under a permissive umask',
    async () => {
      await secure(['setup'], { newPassphrase: NEW_PASSPHRASE });
      expect(mode(secureDirectory())).toBe(0o700);
      expect(mode(keyringPath())).toBe(0o600);
      expect(mode(runtime().layout.userRoot)).toBe(0o700);
    },
  );

  it('shows the recovery key once, clears it before asking for it back, and never prints it', async () => {
    let screenAtConfirmation = '';
    let terminalRef: IScriptedSecureTerminal | undefined;
    const person: IScriptedPerson = {
      newPassphrase: NEW_PASSPHRASE,
      meanwhile: {
        when: /^To confirm/,
        run: () => void (screenAtConfirmation = terminalRef!.screen()),
      },
    };
    const terminal = scriptedSecureTerminal(person);
    terminalRef = terminal;
    const code = await runSecureCommand(['setup'], {
      productRuntime: runtime(),
      stdout: (text) => stdout.push(text),
      stderr: (text) => stderr.push(text),
      stdinIsTTY: true,
      stdoutIsTTY: true,
      openTerminal: () => terminal.session,
    });

    expect(code).toBe(0);
    const recoveryKey = terminal.shownRecoveryKey()!;
    expect(occurrences(terminal.everything(), recoveryKey)).toBe(1);
    expect(screenAtConfirmation).not.toContain(recoveryKey);
    expect(terminal.screen()).not.toContain(recoveryKey);
    expect(out() + err()).not.toContain(recoveryKey);
    expect(everythingUnder(home)).not.toContain(recoveryKey);
    expect(terminal.everything()).toMatch(/shown once/);
    expect(terminal.everything()).toMatch(/not stored anywhere/);
  });

  it('prints the fingerprint that status prints later', async () => {
    await secure(['setup'], { newPassphrase: NEW_PASSPHRASE });
    const printedAtSetup = /fingerprint: ([0-9A-F-]+)/.exec(out())?.[1];
    stdout.length = 0;
    await secure(['status']);
    expect(printedAtSetup).toBeDefined();
    expect(out()).toContain(`fingerprint: ${printedAtSetup}`);
  });

  it('asks again for a passphrase under 12 characters, and says why', async () => {
    const { code, terminal } = await secure(['setup'], {
      newPassphrase: ['too short', NEW_PASSPHRASE],
    });
    expect(code).toBe(0);
    expect(terminal.everything()).toMatch(/at least 12 characters/);
    expect(terminal.everything()).toMatch(/offline/);
    (await unlockWithPassphrase(storedKeyring(), NEW_PASSPHRASE)).lock();
  });

  it('asks again when the two entries differ, and gives up after three tries', async () => {
    const { code, terminal } = await secure(['setup'], {
      newPassphrase: NEW_PASSPHRASE,
      repeat: 'a passphrase that is different',
    });
    expect(code).toBe(1);
    expect(terminal.everything()).toMatch(/entries differ/);
    expect(err()).toMatch(/No keyring was created/);
    expect(existsSync(keyringPath())).toBe(false);
  });

  it('never replaces an existing keyring', async () => {
    await installFixtureKeyring();
    const before = readFileSync(keyringPath(), 'utf8');
    const { code, terminal } = await secure(['setup'], { newPassphrase: NEW_PASSPHRASE });

    expect(code).toBe(1);
    expect(err()).toMatch(/already exists/);
    expect(err()).toMatch(/change-passphrase/);
    expect(terminal.runs()).toBe(0);
    expect(readFileSync(keyringPath(), 'utf8')).toBe(before);
  });

  it('saves nothing when the recovery key typed back is wrong', async () => {
    const { code, terminal } = await secure(['setup'], {
      newPassphrase: NEW_PASSPHRASE,
      confirmRecoveryKey: ['AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA-AAAA', 'not a key at all'],
    });
    expect(code).toBe(1);
    expect(terminal.everything()).toMatch(/not the recovery key that was shown/);
    expect(existsSync(keyringPath())).toBe(false);
    expect(out()).toBe('');
  });

  it('saves nothing when the person cancels', async () => {
    const { code } = await secure(['setup'], {
      cancelAt: /^Repeat the passphrase/,
      newPassphrase: NEW_PASSPHRASE,
    });
    expect(code).toBe(1);
    expect(err()).toMatch(/Cancelled/);
    expect(existsSync(keyringPath())).toBe(false);
  });

  it('does not write over a keyring another setup finished while this one waited', async () => {
    const { keyring } = await fixtureKeyring();
    const { code } = await secure(['setup'], {
      newPassphrase: NEW_PASSPHRASE,
      meanwhile: { when: /^Press Enter/, run: () => writeKeyringFile(keyring) },
    });
    expect(code).toBe(1);
    expect(err()).toMatch(/appeared/);
    expect(readFileSync(keyringPath(), 'utf8')).toBe(serializeKeyring(keyring));
  });

  it('refuses when its output is not a terminal, before opening one', async () => {
    const openTerminal = vi.fn();
    const { code } = await secure(['setup'], {}, { stdoutIsTTY: false, openTerminal });
    expect(code).toBe(1);
    expect(err()).toMatch(/recovery key once/);
    expect(err()).toMatch(/terminal/);
    expect(openTerminal).not.toHaveBeenCalled();
    expect(existsSync(secureDirectory())).toBe(false);
  });

  it.skipIf(isWindows)('refuses a symbolic link where the keyring should be', async () => {
    mkdirSync(secureDirectory(), { recursive: true });
    const elsewhere = join(home, 'elsewhere.json');
    writeFileSync(elsewhere, '{}');
    symlinkSync(elsewhere, keyringPath());

    const { code } = await secure(['setup'], { newPassphrase: NEW_PASSPHRASE });
    expect(code).toBe(1);
    expect(err()).toMatch(/symbolic link/);
    expect(readFileSync(elsewhere, 'utf8')).toBe('{}');
  });
});

describe('secure status', () => {
  const noTerminal = (): never => {
    throw new Error('status must not open a terminal');
  };

  it('says there is no keyring, and exits 0', async () => {
    const { code } = await secure(['status'], {}, { openTerminal: noTerminal, stdinIsTTY: false });
    expect(code).toBe(0);
    expect(out()).toContain(`No keyring exists at ${keyringPath()}`);
    expect(out()).toMatch(/secure setup/);
    expect(existsSync(secureDirectory())).toBe(false);
  });

  it('reports the persisted conversation choice even when the keyring is absent', async () => {
    const plain = runtime();
    const root = plain.layout.userRoot;
    for (const [expected, next, label] of [
      ['plain', 'preparing', 'preparing'],
      ['preparing', 'secure', 'secure'],
      ['secure', 'plain', 'plain'],
    ] as const) {
      writeProductConversationMode(root, expected, next);
      stdout = [];
      const selected = resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment });
      const { code } = await secure(['status'], {}, { productRuntime: selected, openTerminal: noTerminal });
      expect(code).toBe(0);
      expect(out()).toContain(`Conversation mode: ${label}`);
    }
  });

  it('reports the path, the slots with their scrypt cost, the fingerprint and the file mode, without unlocking', async () => {
    const { keyring } = await installFixtureKeyring();
    const { code } = await secure(['status'], {}, { openTerminal: noTerminal, stdinIsTTY: false });

    expect(code).toBe(0);
    expect(out()).toContain(`Keyring: ${keyringPath()}`);
    expect(out()).toContain('passphrase (scrypt N=131072, r=8, p=1)');
    expect(out()).toContain('recovery key');
    expect(out()).toContain(fingerprint(getSealingPublicKey(keyring)));
    expect(out()).toMatch(/secure verify/);
    expect(out()).toMatch(/unlocking/);
    if (!isWindows) expect(out()).toContain('mode 0600');
    expect(err()).toBe('');
  });

  it.skipIf(isWindows)('tightens a group-readable file and says so', async () => {
    await installFixtureKeyring();
    chmodSync(keyringPath(), 0o644);

    const { code } = await secure(['status']);
    expect(code).toBe(0);
    expect(out()).toMatch(/was 0644/);
    expect(out()).toMatch(/tightened/);
    expect(mode(keyringPath())).toBe(0o600);
  });

  it.skipIf(isWindows)('refuses a file owned by another account', async () => {
    await installFixtureKeyring();
    const foreign = createKeyringFileStore({
      path: keyringPath(),
      root: runtime().layout.userRoot,
      currentUserId: (process.getuid?.() ?? 0) + 1,
    });
    const { code } = await secure(['status'], {}, { store: foreign });
    expect(code).toBe(1);
    expect(err()).toMatch(/another account/);
  });

  it.skipIf(isWindows)('refuses a symbolic link', async () => {
    mkdirSync(secureDirectory(), { recursive: true });
    symlinkSync(join(home, 'elsewhere.json'), keyringPath());
    const { code } = await secure(['status']);
    expect(code).toBe(1);
    expect(err()).toMatch(/symbolic link/);
  });

  it('names a keyring file it cannot read without quoting it', async () => {
    mkdirSync(secureDirectory(), { recursive: true });
    const marker = 'MARKER-not-a-keyring-at-all';
    writeFileSync(keyringPath(), marker, { mode: 0o600 });
    const { code } = await secure(['status']);
    expect(code).toBe(1);
    expect(err()).toMatch(/not a valid keyring/);
    expect(out() + err()).not.toContain(marker);
  });
});

describe('secure disable', () => {
  it('requires an explicit terminal choice and retains the sealed archive', async () => {
    const plain = runtime();
    const root = plain.layout.userRoot;
    writeProductConversationMode(root, 'plain', 'preparing');
    writeProductConversationMode(root, 'preparing', 'secure');
    const archive = join(root, 'secure-v1', 'sessions');
    mkdirSync(archive, { recursive: true, mode: 0o700 });
    writeFileSync(join(archive, 'sealed-record'), 'sealed bytes', { mode: 0o600 });
    const selected = resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment });

    const cancelled = await secure(['disable'], {}, { productRuntime: selected, confirm: async () => 'no' });
    expect(cancelled.code).toBe(1);
    expect(resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }).conversationMode).toBe('secure');

    const accepted = await secure(['disable'], {}, { productRuntime: selected, confirm: async () => 'yes' });
    expect(accepted.code).toBe(0);
    expect(resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }).conversationMode).toBe('plain');
    expect(readFileSync(join(archive, 'sealed-record'), 'utf8')).toBe('sealed bytes');
    expect(out()).toContain('New conversations will be saved in plaintext');
  });

  it('refuses to turn an unfinished preparation into ordinary mode', async () => {
    const plain = runtime();
    writeProductConversationMode(plain.layout.userRoot, 'plain', 'preparing');
    const selected = resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment });
    const { code } = await secure(['disable'], {}, { productRuntime: selected, confirm: async () => 'yes' });
    expect(code).toBe(1);
    expect(resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }).conversationMode).toBe('preparing');
  });
});

describe('secure enable', () => {
  it('turns on secure conversations only after the owner confirms an empty-state plan', async () => {
    await installFixtureKeyring();
    const plain = runtime();
    const selected = resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment });

    const cancelled = await secure(['enable'], { passphrase: FIXTURE_PASSPHRASE }, {
      productRuntime: selected,
      confirm: async () => 'no',
      migrationSteps: [],
    });
    expect(cancelled.code).toBe(1);
    expect(resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }).conversationMode).toBe('plain');

    const accepted = await secure(['enable'], { passphrase: FIXTURE_PASSPHRASE }, {
      productRuntime: selected,
      confirm: async () => 'yes',
      migrationSteps: [],
    });
    expect(accepted.code).toBe(0);
    expect(resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }).conversationMode).toBe('secure');
  });

  it('keeps incomplete preparation blocked and resumes it on another invocation', async () => {
    await installFixtureKeyring();
    const plain = runtime();
    const selected = resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment });
    const incomplete = await secure(['enable'], { passphrase: FIXTURE_PASSPHRASE }, {
      productRuntime: selected,
      confirm: async () => 'yes',
      migrationSteps: [{
        title: 'a held legacy record',
        plan: () => ({ lines: ['One record remains.'], complete: false }),
        run: async () => ({ lines: ['One record remains.'], complete: false }),
      }],
    });
    expect(incomplete.code).toBe(5);
    const preparing = resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment });
    expect(preparing.conversationMode).toBe('preparing');

    const resumed = await secure(['enable'], { passphrase: FIXTURE_PASSPHRASE }, {
      productRuntime: preparing,
      confirm: async () => 'yes',
      migrationSteps: [],
    });
    expect(resumed.code).toBe(0);
    expect(resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }).conversationMode).toBe('secure');
  });

  it('refuses an uncertain process before changing the mode choice', async () => {
    await installFixtureKeyring();
    const plain = runtime();
    mkdirSync(join(plain.layout.userPaths.presence, 'process-4242-Unknow'), {
      recursive: true,
      mode: 0o700,
    });
    const selected = resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment });
    const result = await secure(['enable'], { passphrase: FIXTURE_PASSPHRASE }, {
      productRuntime: selected,
      confirm: async () => 'yes',
      migrationSteps: [],
    });
    expect(result.code).toBe(1);
    expect(resolveCliRuntimeContext({ productConfig: plain.config, environment: plain.environment }).conversationMode).toBe('plain');
    expect(err()).toContain('active or uncertain');
  });
});

describe('secure verify', () => {
  it('unlocks with the passphrase and reports the sealing key verified', async () => {
    const { keyring } = await installFixtureKeyring();
    const { code, terminal } = await secure(['verify'], { passphrase: FIXTURE_PASSPHRASE });

    expect(code).toBe(0);
    expect(out()).toMatch(/Verified/);
    expect(out()).toContain(fingerprint(getSealingPublicKey(keyring)));
    expect(err()).toBe('');
    expect(terminal.runs()).toBe(1);
  });

  it('unlocks with the recovery key under --recovery', async () => {
    const { recoveryKey } = await installFixtureKeyring();
    const { code, terminal } = await secure(['verify', '--recovery'], { recoveryKey });
    expect(code).toBe(0);
    expect(out()).toMatch(/Verified/);
    expect(terminal.prompts()[0]).toMatch(/^Recovery key/);
  });

  it('asks again after a wrong passphrase, then gives up without saying what part failed', async () => {
    await installFixtureKeyring();
    const before = readFileSync(keyringPath(), 'utf8');
    const { code, terminal } = await secure(['verify'], { passphrase: OTHER_PASSPHRASE });

    expect(code).toBe(1);
    expect(terminal.prompts().filter((prompt) => /^Passphrase/.test(prompt))).toHaveLength(3);
    expect(terminal.everything()).toMatch(/did not unlock/);
    expect(err()).toMatch(/not unlocked/);
    expect(out() + err() + terminal.everything()).not.toContain(OTHER_PASSPHRASE);
    expect(readFileSync(keyringPath(), 'utf8')).toBe(before);
  });

  it('refuses a mistyped recovery key as not having the form of one', async () => {
    await installFixtureKeyring();
    const { code, terminal } = await secure(['verify', '--recovery'], { recoveryKey: 'nonsense' });
    expect(code).toBe(1);
    expect(terminal.everything()).toMatch(/form of a recovery key/);
  });

  it('exits 2, warns loudly and repairs the file when the stored sealing key was swapped', async () => {
    const { keyring } = await installFixtureKeyring();
    const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    stranger.unlocked.lock();
    writeKeyringFile(withSwappedSealingKey(keyring, stranger.keyring));
    const planted = fingerprint(getSealingPublicKey(stranger.keyring));
    const real = fingerprint(getSealingPublicKey(keyring));

    const { code } = await secure(['verify'], { passphrase: FIXTURE_PASSPHRASE });

    expect(code).toBe(2);
    expect(err()).toMatch(/WARNING/);
    expect(err()).toContain(planted);
    expect(err()).toContain(real);
    expect(err()).toMatch(/sealed while the keyring\s+was locked/);
    expect(err()).toMatch(/repaired/);
    expect(out()).not.toMatch(/Verified/);
    expect(storedKeyring().sealingPublicKey).toBe(keyring.sealingPublicKey);

    stdout.length = 0;
    stderr.length = 0;
    expect((await secure(['verify'], { passphrase: FIXTURE_PASSPHRASE })).code).toBe(0);
    expect(out()).toMatch(/Verified/);
  });

  it('says there is no keyring and asks nothing', async () => {
    const { code, terminal } = await secure(['verify'], { passphrase: FIXTURE_PASSPHRASE });
    expect(code).toBe(1);
    expect(err()).toMatch(/no keyring/i);
    expect(terminal.runs()).toBe(0);
  });
});

describe('secure change-passphrase', () => {
  it('sets a new passphrase, keeps the recovery key and the sealing key, and leaves no copy of the old keyring', async () => {
    const { keyring, recoveryKey } = await installFixtureKeyring();
    const oldSlot = keyring.slots.find((slot) => slot.type === 'passphrase')!;

    const { code } = await secure(['change-passphrase'], {
      passphrase: FIXTURE_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
    });

    expect(code).toBe(0);
    expect(out()).toMatch(/passphrase was changed/);
    expect(out()).toMatch(
      /copy of the keyring file taken earlier still opens with the old passphrase/,
    );
    expect(out()).toContain(fingerprint(getSealingPublicKey(keyring)));
    const updated = storedKeyring();
    await expect(unlockWithPassphrase(updated, FIXTURE_PASSPHRASE)).rejects.toMatchObject({
      code: 'wrong-credential',
    });
    const viaNew = await unlockWithPassphrase(updated, NEW_PASSPHRASE);
    expect(fingerprint(viaNew.sealing.publicKey)).toBe(fingerprint(getSealingPublicKey(keyring)));
    viaNew.lock();
    (await unlockWithRecoveryKey(updated, recoveryKey)).lock();
    expect(everythingUnder(home)).not.toContain(oldSlot.wrappedKey);
  });

  it('resets a forgotten passphrase with the recovery key under --recovery', async () => {
    const { recoveryKey } = await installFixtureKeyring();
    const { code } = await secure(['change-passphrase', '--recovery'], {
      recoveryKey,
      newPassphrase: NEW_PASSPHRASE,
    });
    expect(code).toBe(0);
    (await unlockWithPassphrase(storedKeyring(), NEW_PASSPHRASE)).lock();
  });

  it('applies the same 12-character rule, and the two entries must match', async () => {
    await installFixtureKeyring();
    const { code, terminal } = await secure(['change-passphrase'], {
      passphrase: FIXTURE_PASSPHRASE,
      newPassphrase: ['short', NEW_PASSPHRASE, NEW_PASSPHRASE],
      repeat: ['not the same entry', NEW_PASSPHRASE],
    });
    expect(code).toBe(0);
    expect(terminal.everything()).toMatch(/at least 12 characters/);
    expect(terminal.everything()).toMatch(/entries differ/);
    (await unlockWithPassphrase(storedKeyring(), NEW_PASSPHRASE)).lock();
  });

  it('changes nothing when the current passphrase is wrong', async () => {
    await installFixtureKeyring();
    const before = readFileSync(keyringPath(), 'utf8');
    const { code, terminal } = await secure(['change-passphrase'], {
      passphrase: OTHER_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
    });
    expect(code).toBe(1);
    expect(err()).toMatch(/not changed/);
    expect(terminal.prompts().some((prompt) => /^New passphrase/.test(prompt))).toBe(false);
    expect(readFileSync(keyringPath(), 'utf8')).toBe(before);
  });

  it('changes nothing when the person cancels at the new passphrase', async () => {
    await installFixtureKeyring();
    const before = readFileSync(keyringPath(), 'utf8');
    const { code } = await secure(['change-passphrase'], {
      passphrase: FIXTURE_PASSPHRASE,
      cancelAt: /^New passphrase/,
    });
    expect(code).toBe(1);
    expect(err()).toMatch(/Cancelled/);
    expect(readFileSync(keyringPath(), 'utf8')).toBe(before);
  });

  it('keeps the repaired sealing key, warns, and exits 2 when the stored one had been swapped', async () => {
    const { keyring } = await installFixtureKeyring();
    const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    stranger.unlocked.lock();
    writeKeyringFile(withSwappedSealingKey(keyring, stranger.keyring));

    const { code } = await secure(['change-passphrase'], {
      passphrase: FIXTURE_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
    });

    expect(code).toBe(2);
    expect(err()).toMatch(/WARNING/);
    expect(out()).toMatch(/passphrase was changed/);
    const updated = storedKeyring();
    expect(updated.sealingPublicKey).toBe(keyring.sealingPublicKey);
    (await unlockWithPassphrase(updated, NEW_PASSPHRASE)).lock();
  });

  it('still warns, and exits 4, when a swapped sealing key was repaired and the person then cancels', async () => {
    const { keyring } = await installFixtureKeyring();
    const stranger = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    stranger.unlocked.lock();
    writeKeyringFile(withSwappedSealingKey(keyring, stranger.keyring));

    const { code } = await secure(['change-passphrase'], {
      passphrase: FIXTURE_PASSPHRASE,
      cancelAt: /^New passphrase/,
    });

    expect(code).toBe(4);
    expect(err()).toMatch(/WARNING/);
    expect(err()).toMatch(/Cancelled/);
    // The repair happened at unlock; the passphrase did not change.
    expect(storedKeyring().sealingPublicKey).toBe(keyring.sealingPublicKey);
    (await unlockWithPassphrase(storedKeyring(), FIXTURE_PASSPHRASE)).lock();
  });

  it('saves nothing when the keyring changed while the person was typing', async () => {
    const { keyring } = await installFixtureKeyring();
    const interloper = withSwappedSealingKey(
      keyring,
      (await createKeyring({ passphrase: OTHER_PASSPHRASE }).then((c) => (c.unlocked.lock(), c)))
        .keyring,
    );
    const { code } = await secure(['change-passphrase'], {
      passphrase: FIXTURE_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
      meanwhile: { when: /^Repeat the passphrase/, run: () => writeKeyringFile(interloper) },
    });
    expect(code).toBe(1);
    expect(err()).toMatch(/changed while you were working/);
    expect(readFileSync(keyringPath(), 'utf8')).toBe(serializeKeyring(interloper));
  });

  it('says there is no keyring and asks nothing', async () => {
    const { code, terminal } = await secure(['change-passphrase'], {
      passphrase: FIXTURE_PASSPHRASE,
      newPassphrase: NEW_PASSPHRASE,
    });
    expect(code).toBe(1);
    expect(terminal.runs()).toBe(0);
  });
});

describe('secure — a write that reached the file but was not confirmed', () => {
  it('setup says the keyring is most likely in place and to verify it', async () => {
    // The directory exists already, so the flush that fails is the one after the rename.
    mkdirSync(secureDirectory(), { recursive: true });
    const { code } = await secure(
      ['setup'],
      { newPassphrase: NEW_PASSPHRASE },
      { store: store({ syncDirectory: ioError('EIO') }) },
    );
    expect(code).toBe(1);
    expect(err()).toMatch(/most likely in place/);
    expect(err()).toMatch(/secure verify/);
    expect(err()).not.toMatch(/No keyring was created/);
    expect(err()).not.toContain('/secret/path');
    (await unlockWithPassphrase(storedKeyring(), NEW_PASSPHRASE)).lock();
  });

  it('change-passphrase says the new passphrase is most likely the one that works now', async () => {
    await installFixtureKeyring();
    const { code } = await secure(
      ['change-passphrase'],
      { passphrase: FIXTURE_PASSPHRASE, newPassphrase: NEW_PASSPHRASE },
      { store: store({ syncDirectory: ioError('EIO') }) },
    );
    expect(code).toBe(1);
    expect(err()).toMatch(/new passphrase is most likely the one that works now/);
    expect(err()).toMatch(/secure verify/);
    expect(err()).not.toMatch(/not changed/);
    (await unlockWithPassphrase(storedKeyring(), NEW_PASSPHRASE)).lock();
  });
});

describe('secure — a swapped sealing key whose repair is not written', () => {
  it('verify warns with both fingerprints, says the file still holds the other key, and exits 4', async () => {
    const { keyring } = await fixtureKeyring();
    const stranger = await strangerKeyring();
    const swapped = withSwappedSealingKey(keyring, stranger);
    writeKeyringFile(swapped);

    const { code } = await secure(
      ['verify'],
      { passphrase: FIXTURE_PASSPHRASE },
      { store: store({ syncFile: ioError('ENOSPC') }) },
    );

    expect(code).toBe(4);
    expect(err()).toMatch(/WARNING/);
    expect(err()).toContain(fingerprint(getSealingPublicKey(stranger)));
    expect(err()).toContain(fingerprint(getSealingPublicKey(keyring)));
    expect(err()).toMatch(/still holds/);
    expect(out()).not.toMatch(/Verified/);
    expect(readFileSync(keyringPath(), 'utf8')).toBe(serializeKeyring(swapped));
  });
});

describe('secure change-passphrase — built on the verified key', () => {
  it('writes and prints the key the unlock verified, even when the file was swapped right after it', async () => {
    const { keyring } = await installFixtureKeyring();
    const stranger = await strangerKeyring();
    const fileStore = store();
    let reads = 0;
    // The third read is the one the change is built on: after the command's own check and the
    // holder's unlock, which verified the key.
    const swappedAfterUnlock = {
      ...fileStore,
      load: () => {
        reads += 1;
        if (reads === 3) writeKeyringFile(withSwappedSealingKey(keyring, stranger));
        return fileStore.load();
      },
    };

    const { code } = await secure(
      ['change-passphrase'],
      { passphrase: FIXTURE_PASSPHRASE, newPassphrase: NEW_PASSPHRASE },
      { store: swappedAfterUnlock },
    );

    const real = fingerprint(getSealingPublicKey(keyring));
    const planted = fingerprint(getSealingPublicKey(stranger));
    expect(storedKeyring().sealingPublicKey).toBe(keyring.sealingPublicKey);
    expect(out()).toContain(`fingerprint: ${real}`);
    expect(out()).not.toContain(planted);
    expect(err()).toMatch(/WARNING/);
    expect(err()).toContain(planted);
    expect(code).toBe(2);
    (await unlockWithPassphrase(storedKeyring(), NEW_PASSPHRASE)).lock();
  });
});

describe('secrets reach the terminal and nowhere else', () => {
  it('keeps every typed passphrase and the recovery key out of output, errors and files', async () => {
    const setup = await secure(['setup'], { newPassphrase: NEW_PASSPHRASE });
    const recoveryKey = setup.terminal.shownRecoveryKey()!;
    const ledger = [setup.terminal.everything()];

    const wrong = await secure(['verify'], { passphrase: OTHER_PASSPHRASE });
    ledger.push(wrong.terminal.everything());
    const right = await secure(['verify'], { passphrase: NEW_PASSPHRASE });
    ledger.push(right.terminal.everything());
    const changed = await secure(['change-passphrase', '--recovery'], {
      recoveryKey,
      newPassphrase: FIXTURE_PASSPHRASE,
    });
    ledger.push(changed.terminal.everything());
    const bad = await secure(['verify', '--recovery'], {
      recoveryKey: 'ZZZZ-secret-recovery-typo',
    });
    ledger.push(bad.terminal.everything());

    const capturedOutput = out() + err();
    for (const secret of [
      NEW_PASSPHRASE,
      OTHER_PASSPHRASE,
      FIXTURE_PASSPHRASE,
      recoveryKey,
      'ZZZZ-secret-recovery-typo',
    ]) {
      expect(capturedOutput, secret).not.toContain(secret);
      expect(everythingUnder(home), secret).not.toContain(secret);
      // The terminal echoes prompts, never what was typed.
      for (const shown of ledger) {
        if (secret === recoveryKey) continue;
        expect(shown, secret).not.toContain(secret);
      }
    }
    // The one place the recovery key is ever written.
    expect(occurrences(ledger.join('\n'), recoveryKey)).toBe(1);
  });
});

describe('the passphrase comes from a person at a terminal and nowhere else', () => {
  const SMUGGLED = 'smuggled-passphrase-long-enough';

  it.each([['setup'], ['verify'], ['change-passphrase'], ['verify', '--recovery']])(
    'secure %s refuses when stdin is not a terminal, even with a passphrase in the environment',
    async (...args: string[]) => {
      for (const name of [
        'PASSPHRASE',
        'ROBOTA_PASSPHRASE',
        'ROBOTA_SECURE_PASSPHRASE',
        'TEST_PRODUCT_PASSPHRASE',
        'SECURE_PASSPHRASE',
      ]) {
        vi.stubEnv(name, SMUGGLED);
      }
      const openTerminal = vi.fn();
      await installFixtureKeyring();
      const { code } = await secure(args, {}, { stdinIsTTY: false, openTerminal });

      expect(code).toBe(1);
      expect(err()).toMatch(/needs an interactive terminal/);
      expect(err()).toMatch(/run it in a terminal/);
      expect(err()).not.toMatch(/environment|argument|pipe|stdin/i);
      expect(openTerminal).not.toHaveBeenCalled();
      expect(out() + err()).not.toContain(SMUGGLED);
    },
  );

  it('refuses when there is no terminal to open, even though stdin claims to be one', async () => {
    await installFixtureKeyring();
    const { code } = await secure(['verify'], {}, { openTerminal: () => undefined });
    expect(code).toBe(1);
    expect(err()).toMatch(/needs an interactive terminal/);
  });

  it('never unlocks from the environment: with the right passphrase exported, a cancelled prompt still fails', async () => {
    vi.stubEnv('ROBOTA_SECURE_PASSPHRASE', FIXTURE_PASSPHRASE);
    vi.stubEnv('PASSPHRASE', FIXTURE_PASSPHRASE);
    await installFixtureKeyring();
    const { code } = await secure(['verify'], { cancelAt: /^Passphrase/ });
    expect(code).toBe(1);
    expect(out()).not.toMatch(/Verified/);
  });

  it.each([
    [['verify', 'hunter2hunter2hunter2']],
    [['verify', '--passphrase=hunter2hunter2hunter2']],
    [['verify', '--passphrase', 'hunter2hunter2hunter2']],
    [['setup', 'hunter2hunter2hunter2']],
    [['change-passphrase', 'hunter2hunter2hunter2']],
    [['verify', '--recovery', '--recovery']],
    [['status', '--json']],
    [['unlock']],
    [[]],
  ])(
    'secure %j prints the usage without echoing the arguments and without asking',
    async (args) => {
      const openTerminal = vi.fn();
      await installFixtureKeyring();
      const { code } = await secure(args, {}, { openTerminal });

      expect(code).toBe(1);
      expect(err()).toBe(SECURE_USAGE('test-product'));
      expect(err()).not.toContain('hunter2');
      expect(openTerminal).not.toHaveBeenCalled();
    },
  );

  it('offers lock but no unlock subcommand: unlocked keys live in the process that uses them', () => {
    expect(SECURE_USAGE('test-product')).not.toMatch(/\bunlock\b/);
    expect(SECURE_USAGE('test-product')).toContain('secure lock');
  });
});

describe('the secure sources', () => {
  it('read neither the environment nor the argument list', () => {
    const directory = join(__dirname, '..');
    const sources = readdirSync(directory).filter((name) => name.endsWith('.ts'));
    expect(sources.length).toBeGreaterThan(4);
    for (const name of sources) {
      const text = readFileSync(join(directory, name), 'utf8');
      expect(text, name).not.toMatch(/process\.env|process\.argv/);
    }
  });
});
