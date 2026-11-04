/**
 * #3679 3f — the local unlock gate. A locked process asks for the passphrase only for a read the
 * person started, only on the secret terminal while the live session has handed the terminal over,
 * and never where nobody can answer. One question is open at a time, and a sealing key the file was
 * given by someone else is told to the person, as `secure verify` tells it.
 */
import { createKeyring, fingerprint, getSealingPublicKey } from '@robota-sdk/agent-keyring';
import { describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { KeyHolder } from '../../secure/key-holder.js';
import {
  FIXTURE_PASSPHRASE,
  createMemoryKeyringStore,
  fixtureKeyring,
  scriptedSecureTerminal,
  withSwappedSealingKey,
} from '../../secure/__tests__/helpers.js';
import {
  READ_PURPOSES,
  UNLOCK_COMMAND_LINE,
  createProcessKeyCustody,
  productKeyCustody,
} from '../key-custody.js';
import { overrideProductSecureMode, useProductKeyHolder } from '../session-sealing.js';

import type { IScriptedPerson } from '../../secure/__tests__/helpers.js';
import type { IMemoryKeyringStore } from '../../secure/__tests__/helpers.js';
import type { ITerminalHandoffHost } from '../../remote-control/operator-approval.js';
import type { IKeyring } from '@robota-sdk/agent-keyring';
import type { TUserReadRequest } from '@robota-sdk/agent-ui-terminal';

/**
 * The terminal UI's own mint and guard, from source: the package exports neither the mint nor its
 * record, so this file runs the package's guard from the same source the mint records into, as the
 * built bundle does in the product.
 */
const source = vi.hoisted(() => ({
  mint: '../../../../agent-ui-terminal/src/key-custody/user-read-request-mint.js',
  port: '../../../../agent-ui-terminal/src/key-custody/key-custody-port.js',
}));
vi.mock('@robota-sdk/agent-ui-terminal', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  ...((await import(source.port)) as object),
}));
const { mintUserReadRequest } = (await import(source.mint)) as {
  mintUserReadRequest: (purpose: 'continue-fork') => TUserReadRequest;
};

/** What the terminal UI's attach action mints. */
const CONTINUE_FORK = (): TUserReadRequest => mintUserReadRequest('continue-fork');

interface IHarness {
  readonly holder: KeyHolder;
  readonly store: IMemoryKeyringStore;
  readonly terminal: ReturnType<typeof scriptedSecureTerminal>;
  readonly openTerminal: ReturnType<typeof vi.fn>;
  readonly host: ITerminalHandoffHost & { readonly handovers: () => number };
  readonly notices: string[];
  readonly custody: ReturnType<typeof createProcessKeyCustody>;
}

async function harness(
  options: {
    readonly person?: IScriptedPerson;
    readonly keyring?: IKeyring;
    readonly host?: 'none' | 'no-terminal' | 'ready';
    readonly terminal?: 'none' | 'ready';
  } = {},
): Promise<IHarness> {
  const keyring = options.keyring ?? (await fixtureKeyring()).keyring;
  const store = createMemoryKeyringStore(keyring);
  const holder = new KeyHolder({ store, policy: { idleMs: 0 } });
  const terminal = scriptedSecureTerminal(options.person ?? { passphrase: FIXTURE_PASSPHRASE });
  const openTerminal = vi.fn(() => (options.terminal === 'none' ? undefined : terminal.session));
  let handovers = 0;
  const host = {
    canHandoffTerminal: () => options.host !== 'no-terminal',
    runWithTerminal: async <T>(fn: () => Promise<T>): Promise<T> => {
      handovers += 1;
      return fn();
    },
    handovers: () => handovers,
  };
  const notices: string[] = [];
  const custody = createProcessKeyCustody({
    holder,
    keyringStore: store,
    productRuntime: createTestProductRuntime(),
    openTerminal,
  });
  custody.setChannel(
    options.host === 'none'
      ? undefined
      : { host: () => host, report: (message) => notices.push(message) },
  );
  return { holder, store, terminal, openTerminal, host, notices, custody };
}

describe('a read the person started, while the keys are locked', () => {
  it('asks on the handed-over secret terminal under its purpose, and unlocks', async () => {
    const h = await harness();

    await expect(h.custody.port.ensureReadable(CONTINUE_FORK())).resolves.toBe('readable');

    expect(h.holder.isUnlocked).toBe(true);
    expect(h.host.handovers()).toBe(1);
    expect(h.terminal.runs()).toBe(1);
    expect(h.terminal.everything()).toContain(READ_PURPOSES['continue-fork']);
    expect(h.terminal.prompts()).toEqual(['Passphrase: ']);
    expect(h.terminal.everything()).not.toContain(FIXTURE_PASSPHRASE);
    expect(h.notices).toEqual([]);
  });

  it('is declined when the person cancels, and when three passphrases are wrong', async () => {
    const cancelled = await harness({ person: { cancelAt: /^Passphrase/ } });
    await expect(cancelled.custody.port.ensureReadable(CONTINUE_FORK())).resolves.toBe('declined');
    expect(cancelled.holder.isUnlocked).toBe(false);

    const wrong = await harness({ person: { passphrase: 'not the passphrase at all' } });
    await expect(wrong.custody.port.ensureReadable(CONTINUE_FORK())).resolves.toBe('declined');
    expect(wrong.holder.isUnlocked).toBe(false);
    expect(wrong.terminal.prompts()).toHaveLength(3);
  });

  it('never asks where nobody can answer', async () => {
    for (const setup of [
      { host: 'none' },
      { host: 'no-terminal' },
      { terminal: 'none' },
    ] as const) {
      const h = await harness(setup);
      await expect(
        h.custody.port.ensureReadable(CONTINUE_FORK()),
        JSON.stringify(setup),
      ).resolves.toBe('unavailable');
      expect(h.terminal.runs(), JSON.stringify(setup)).toBe(0);
      expect(h.holder.isUnlocked).toBe(false);
    }
  });

  it('opens one question for reads started together', async () => {
    const h = await harness();

    const answers = await Promise.all([
      h.custody.port.ensureReadable(CONTINUE_FORK()),
      h.custody.port.ensureReadable(CONTINUE_FORK()),
    ]);

    expect(answers).toEqual(['readable', 'readable']);
    expect(h.terminal.runs()).toBe(1);
    expect(h.host.handovers()).toBe(1);
  });

  it('asks nothing while the keys are already open', async () => {
    const h = await harness();
    await h.holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });

    await expect(h.custody.port.ensureReadable(CONTINUE_FORK())).resolves.toBe('readable');
    expect(h.openTerminal).not.toHaveBeenCalled();
    expect(h.host.handovers()).toBe(0);
  });
});

describe('a request the terminal UI did not mint', () => {
  it('opens no prompt and changes nothing, even shaped exactly like one', async () => {
    const h = await harness();
    // What any module could write: the brand is a type, so a cast gets past the compiler.
    const forged = Object.freeze({ purpose: 'continue-fork' }) as unknown as TUserReadRequest;

    await expect(h.custody.port.ensureReadable(forged)).resolves.toBe('unavailable');

    expect(h.openTerminal).not.toHaveBeenCalled();
    expect(h.host.handovers()).toBe(0);
    expect(h.holder.isUnlocked).toBe(false);
    expect(h.notices).toEqual([]);
  });
});

describe('a sealing key the keyring file was given by something else', () => {
  it('is repaired and told to the person, with both fingerprints', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await createKeyring({ passphrase: 'another keyring passphrase here' });
    other.unlocked.lock();
    const h = await harness({ keyring: withSwappedSealingKey(keyring, other.keyring) });

    await expect(h.custody.port.ensureReadable(CONTINUE_FORK())).resolves.toBe('readable');

    const said = h.notices.join('\n');
    expect(said).toContain(fingerprint(getSealingPublicKey(other.keyring)));
    expect(said).toContain(fingerprint(getSealingPublicKey(keyring)));
    expect(said).toContain('has been repaired');
  });

  it('keeps the keys locked when the repair cannot be written, and says why', async () => {
    const { keyring } = await fixtureKeyring();
    const other = await createKeyring({ passphrase: 'another keyring passphrase here' });
    other.unlocked.lock();
    const h = await harness({ keyring: withSwappedSealingKey(keyring, other.keyring) });
    h.store.failSaves(new Error('disk full'));

    await expect(h.custody.port.ensureReadable(CONTINUE_FORK())).resolves.toBe('declined');

    expect(h.holder.isUnlocked).toBe(false);
    expect(h.notices.join('\n')).toContain('WARNING: the sealing public key');
  });
});

describe('/unlock and /lock', () => {
  it('/unlock asks on the terminal the command already handed over, under its own line', async () => {
    const h = await harness();

    await expect(h.custody.commands.unlock()).resolves.toEqual({
      outcome: 'unlocked',
      notices: [],
    });
    expect(h.host.handovers()).toBe(0);
    expect(h.terminal.everything()).toContain(UNLOCK_COMMAND_LINE);
  });

  it('/unlock reports a cancel as declined, and asks nothing while unlocked', async () => {
    const h = await harness({ person: { cancelAt: /^Passphrase/ } });
    await expect(h.custody.commands.unlock()).resolves.toEqual({
      outcome: 'declined',
      notices: [],
    });

    await h.holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    await expect(h.custody.commands.unlock()).resolves.toMatchObject({ outcome: 'unlocked' });
    expect(h.terminal.runs()).toBe(1);
  });

  it('/lock drops the keys, saying it was explicit', async () => {
    const h = await harness();
    await h.holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
    const reasons: string[] = [];
    h.holder.onLock((reason) => reasons.push(reason));

    h.custody.commands.lock();

    expect(h.custody.commands.isUnlocked()).toBe(false);
    expect(reasons).toEqual(['explicit']);
  });
});

describe('which process has a custody', () => {
  it('none while secure mode is off, or while it holds no keys', async () => {
    const plain = createTestProductRuntime();
    expect(productKeyCustody(plain)).toBeUndefined();

    const secure = createTestProductRuntime();
    overrideProductSecureMode(secure, true);
    expect(productKeyCustody(secure)).toBeUndefined();

    const { keyring } = await fixtureKeyring();
    useProductKeyHolder(
      secure,
      new KeyHolder({ store: createMemoryKeyringStore(keyring), policy: { idleMs: 0 } }),
    );
    expect(productKeyCustody(secure)).toBeDefined();
  });
});
