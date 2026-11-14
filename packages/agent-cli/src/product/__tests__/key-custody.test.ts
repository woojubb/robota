/**
 * The local unlock gate. A locked process asks for the passphrase only for a read the
 * person started, only on the secret terminal while the live session has handed the terminal over,
 * and never where nobody can answer. One question is open at a time, and a sealing key the file was
 * given by someone else is told to the person, as `secure verify` tells it.
 */
import { createKeyring, fingerprint, getSealingPublicKey } from '@robota-sdk/agent-keyring';
import { isUserReadRequest, renderAttachedApp } from '@robota-sdk/agent-ui-terminal';
import { PassThrough } from 'node:stream';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
import { KeyHolder } from '@robota-sdk/agent-local-host';
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
import type { IAttachedSessionConnection, ITuiCliAdapter, TUserReadRequest } from '@robota-sdk/agent-ui-terminal';

let userRead: TUserReadRequest | undefined;
const USER_READ = (): TUserReadRequest => {
  if (!userRead) throw new Error('The installed terminal did not issue a read request.');
  return userRead;
};

beforeAll(async () => {
  const originalStdin = Object.getOwnPropertyDescriptor(process, 'stdin');
  if (!originalStdin) throw new Error('Cannot replace stdin for the terminal fixture.');
  const input = Object.assign(new PassThrough(), { isTTY: true, setRawMode() { return this; } });
  Object.defineProperty(process, 'stdin', { configurable: true, value: input });
  const output = vi.spyOn(process.stdout, 'write').mockImplementation((_chunk, encoding, callback) => {
    const done = typeof encoding === 'function' ? encoding : callback;
    done?.();
    return true;
  });
  let receive: Parameters<IAttachedSessionConnection['subscribe']>[0] | undefined;
  let close: (() => void) | undefined;
  const messages: string[] = [];
  const connection: IAttachedSessionConnection = {
    subscribe: (listener) => { receive = listener; return () => {}; },
    onClose: (listener) => { close = listener; return () => {}; },
    send: (message) => {
      messages.push(message.type);
      if (message.type === 'read-execution-detail') queueMicrotask(() => receive?.({
        type: 'execution_detail', requestId: message.requestId,
        page: { entryId: 'task:fork', records: [], unreadable: { locked: 1, noKeys: 0, doesNotOpen: 0 } },
      }));
    },
  };
  const cliAdapter: ITuiCliAdapter = {
    getUserSettingsPath: () => '', readSettings: () => ({}), reloadPluginCommandSource: () => {},
    applyActiveModelChange: () => ({ applied: true }), getGitBranch: () => undefined,
    getProviderDisplayName: (type) => type,
    keyCustody: { ensureReadable: async (request) => { userRead = request; return 'declined'; } },
  };
  const rendered = renderAttachedApp({ cwd: '/tmp', productDisplayName: 'Test', version: '1',
    sessionLabel: 'parent', driverId: 'owner', cliAdapter, connection, announce: false, focusReporting: false });
  try {
    await vi.waitFor(() => expect(receive).toBeDefined());
    receive?.({ type: 'execution_workspace_event', snapshot: { sessionId: 'parent', selectedEntryId: 'task:fork',
      updatedAt: '2026-11-05T00:00:00.000Z', entries: [{ id: 'task:fork', sourceId: 'fork',
        kind: 'background_task', taskKind: 'agent', origin: { kind: 'slash_command', sessionId: 'parent' },
        status: 'running', state: 'working', title: 'fork', unread: false, attention: 'none',
        visibility: 'default', updatedAt: '2026-11-05T00:00:00.000Z', controls: ['select', 'send', 'attach'],
        resumeSessionId: 'session-aaaaaaaa' }] } });
    await vi.waitFor(() => expect(messages).toContain('read-execution-detail'));
    input.write('\x0f');
    await vi.waitFor(() => expect(userRead).toBeDefined());
    expect(isUserReadRequest(userRead)).toBe(true);
  } finally {
    try {
      close?.();
      await rendered;
    } finally {
      output.mockRestore();
      Object.defineProperty(process, 'stdin', originalStdin);
      input.destroy();
    }
  }
});

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

    await expect(h.custody.port.ensureReadable(USER_READ())).resolves.toBe('readable');

    expect(h.holder.isUnlocked).toBe(true);
    expect(h.host.handovers()).toBe(1);
    expect(h.terminal.runs()).toBe(1);
    expect(h.terminal.everything()).toContain(READ_PURPOSES['follow-history']);
    expect(h.terminal.prompts()).toEqual(['Passphrase: ']);
    expect(h.terminal.everything()).not.toContain(FIXTURE_PASSPHRASE);
    expect(h.notices).toEqual([]);
  });

  it('is declined when the person cancels, and when three passphrases are wrong', async () => {
    const cancelled = await harness({ person: { cancelAt: /^Passphrase/ } });
    await expect(cancelled.custody.port.ensureReadable(USER_READ())).resolves.toBe('declined');
    expect(cancelled.holder.isUnlocked).toBe(false);

    const wrong = await harness({ person: { passphrase: 'not the passphrase at all' } });
    await expect(wrong.custody.port.ensureReadable(USER_READ())).resolves.toBe('declined');
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
        h.custody.port.ensureReadable(USER_READ()),
        JSON.stringify(setup),
      ).resolves.toBe('unavailable');
      expect(h.terminal.runs(), JSON.stringify(setup)).toBe(0);
      expect(h.holder.isUnlocked).toBe(false);
    }
  });

  it('opens one question for reads started together', async () => {
    const h = await harness();

    const answers = await Promise.all([
      h.custody.port.ensureReadable(USER_READ()),
      h.custody.port.ensureReadable(USER_READ()),
    ]);

    expect(answers).toEqual(['readable', 'readable']);
    expect(h.terminal.runs()).toBe(1);
    expect(h.host.handovers()).toBe(1);
  });

  it('asks nothing while the keys are already open', async () => {
    const h = await harness();
    await h.holder.unlock({ type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });

    await expect(h.custody.port.ensureReadable(USER_READ())).resolves.toBe('readable');
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

    await expect(h.custody.port.ensureReadable(USER_READ())).resolves.toBe('readable');

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

    await expect(h.custody.port.ensureReadable(USER_READ())).resolves.toBe('declined');

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
