import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { createKeyring, serializeKeyring } from '@robota-sdk/agent-keyring';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FakeRuntimeChild } from './helpers/fake-runtime-child.js';
import { neverLaunch, startFixtureBroker, testProductState } from './helpers/fixture-broker.js';
import { writeProductConversationMode } from '../conversation-mode-state.js';
import { daemonCandidates, openNativeSecureOwner } from '../native-secure-owner.js';
import { FIXTURE_PASSPHRASE, OTHER_PASSPHRASE, fixtureKeyring } from '../testing.js';
import { requestWorkspaceRootBroker } from '../workspace-root-broker.js';
import { workspaceRootBrokerEndpoint } from '../workspace-root-broker-process.js';

import type { INativeSecureOwnerOptions } from '../native-secure-owner.js';
import type { IRuntimeStartLayout } from '../runtime-process-launch.js';
import type { ISupervisedRuntime } from '../supervised-control-client.js';
import type { ITestBrokerProcess } from '../testing.js';

const RUNTIME_EXECUTABLE = vi.hoisted(() => 'fixture-runtime');
const hoisted = vi.hoisted(() => ({
  spawn: vi.fn(),
  fences: [] as Array<{ close: ReturnType<typeof vi.fn> }>,
  handovers: [] as Array<{ dispose: ReturnType<typeof vi.fn> }>,
}));

// Only the runtime's own start is stubbed; the broker the fixtures run in another process is real.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: ((...args: Parameters<typeof actual.spawn>) =>
      args[0] === RUNTIME_EXECUTABLE
        ? hoisted.spawn(...args)
        : Reflect.apply(actual.spawn, actual, args)) as typeof actual.spawn,
  };
});

vi.mock('../workspace-root-fence.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../workspace-root-fence.js')>();
  class RecordingFence extends actual.SecureWorkspaceRootFence {
    constructor(...args: ConstructorParameters<typeof actual.SecureWorkspaceRootFence>) {
      super(...args);
      vi.spyOn(this as { close(): void }, 'close');
      hoisted.fences.push(this as unknown as (typeof hoisted.fences)[number]);
    }
  }
  return { ...actual, SecureWorkspaceRootFence: RecordingFence };
});

vi.mock('@robota-sdk/agent-keyring', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-keyring')>();
  return {
    ...actual,
    openOwnerHandover: async (...args: Parameters<typeof actual.openOwnerHandover>) => {
      const handover = await actual.openOwnerHandover(...args);
      vi.spyOn(handover, 'dispose');
      hoisted.handovers.push(handover as unknown as (typeof hoisted.handovers)[number]);
      return handover;
    },
  };
});

// The workspace fence, which every opening ends in or passes, exists on macOS and Linux only.
const SUPPORTED = process.platform === 'darwin' || process.platform === 'linux';
const ABORTED = 'The desktop window is no longer available.';
const CHANGED = 'The secure conversation choice or keyring changed during unlock.';

/** A product-neutral runtime layout: every fact the launcher knows becomes one flag, in a fixed order. */
const layout: IRuntimeStartLayout = {
  arguments: (facts) => [
    '--run', facts.id,
    ...(facts.name === undefined ? [] : [`--name=${facts.name}`]),
    ...(facts.transportToken ? ['--token'] : []),
    ...(facts.spawnerPair ? ['--pair'] : []),
    ...(facts.forwardedEnvironment ? ['--forwarded'] : []),
    ...(facts.daemon ? ['--daemon'] : []),
    ...(facts.restricted ? ['--limited'] : []),
    ...(facts.handoff ? ['--grants'] : []),
  ],
  transportTokenNames: ['TEST_WS_TOKEN'],
};

interface IScenario {
  readonly home: string;
  readonly userRoot: string;
  readonly historyFile: string;
  readonly keyringPath: string;
  readonly supervisedDirectory: string;
  readonly workspace: string;
  readonly endpoint: string;
}

const homes: string[] = [];
const brokers: ITestBrokerProcess[] = [];

/** A product state with the secure mode on and the fixture keyring on disk. */
async function scenario(options: { mode?: 'secure' | 'plain'; keyring?: boolean } = {}): Promise<IScenario> {
  const home = realpathSync(mkdtempSync(join(realpathSync(tmpdir()), 'native-owner-')));
  homes.push(home);
  const state = testProductState(home);
  const keyringPath = join(state.userRoot, 'secure', 'keyring.json');
  mkdirSync(dirname(keyringPath), { recursive: true, mode: 0o700 });
  if (options.keyring !== false) {
    writeFileSync(keyringPath, serializeKeyring((await fixtureKeyring()).keyring), { mode: 0o600 });
  }
  if (options.mode !== 'plain') writeProductConversationMode(state.userRoot, 'plain', 'secure');
  // The broker names a folder it approves by the repository around it.
  const workspace = join(home, 'workspace');
  mkdirSync(workspace);
  execFileSync('git', ['init', '--quiet', workspace]);
  return {
    home, userRoot: state.userRoot, historyFile: state.historyFile, keyringPath,
    supervisedDirectory: join(home, 'supervised'), workspace,
    endpoint: workspaceRootBrokerEndpoint(state.userRoot),
  };
}

/** A live broker that has approved the scenario's folder, so a start finds it and launches nothing. */
async function startBroker(s: IScenario): Promise<void> {
  mkdirSync(dirname(s.endpoint), { recursive: true, mode: 0o700 });
  brokers.push(await startFixtureBroker(s.endpoint, dirname(s.endpoint), s.historyFile));
  const prepared = await requestWorkspaceRootBroker(s.endpoint, { op: 'prepare', root: s.workspace });
  if (prepared.status !== 'prepared') throw new Error('The test folder could not be prepared.');
  const approved = await requestWorkspaceRootBroker(s.endpoint, { op: 'approve', root: s.workspace, candidate: prepared.candidate });
  if (approved.status !== 'trusted') throw new Error(`The test folder could not be approved: ${JSON.stringify(approved)}`);
}

function options(s: IScenario, overrides: Partial<INativeSecureOwnerOptions> = {}): INativeSecureOwnerOptions {
  return {
    userRoot: s.userRoot,
    keyringPath: s.keyringPath,
    supervisedDirectory: s.supervisedDirectory,
    broker: { historyFile: s.historyFile, launcher: neverLaunch },
    startLock: { removalHint: 'test-product daemon clear-start-lock' },
    runtimeLayout: layout,
    command: { executable: RUNTIME_EXECUTABLE, execArgs: ['--exec-flag'], entryArgs: ['entry.js'] },
    environment: { PATH: '/bin', KEPT: 'yes', TEST_WS_TOKEN: 'a'.repeat(64) },
    workspace: s.workspace,
    restricted: false,
    secret: { type: 'passphrase', value: FIXTURE_PASSPHRASE },
    signal: new AbortController().signal,
    ...overrides,
  };
}

beforeEach(() => {
  hoisted.spawn.mockReset();
  hoisted.fences.length = 0;
  hoisted.handovers.length = 0;
});

afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.close();
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true, maxRetries: 10 });
});

describe.skipIf(!SUPPORTED)('opening a native owner: what is refused before anything is unlocked', () => {
  it('refuses a state whose conversations are not secure, before it reads the keyring', async () => {
    const s = await scenario({ mode: 'plain' });
    await expect(openNativeSecureOwner(options(s))).rejects.toThrow('Secure conversations are not active for this product state.');
    expect(hoisted.handovers).toHaveLength(0);
    expect(hoisted.fences).toHaveLength(0);
  });

  it('refuses a window that is already gone, before it reads the keyring', async () => {
    const s = await scenario();
    const aborted = new AbortController();
    aborted.abort();
    await expect(openNativeSecureOwner(options(s, { signal: aborted.signal }))).rejects.toThrow(ABORTED);
    expect(hoisted.handovers).toHaveLength(0);
  });

  it('checks the mode before the window, so a plain state is refused as plain even when the window is gone', async () => {
    const s = await scenario({ mode: 'plain' });
    const aborted = new AbortController();
    aborted.abort();
    await expect(openNativeSecureOwner(options(s, { signal: aborted.signal }))).rejects.toThrow('Secure conversations are not active for this product state.');
  });

  it.each([{ hold: undefined }, { hold: '' }])('refuses a Restricted choice that holds nothing (%j)', async ({ hold }) => {
    const s = await scenario();
    await expect(openNativeSecureOwner(options(s, {
      restricted: true, ...(hold === undefined ? {} : { restrictedHold: hold }),
    }))).rejects.toThrow('A live native Restricted folder choice is required.');
    expect(hoisted.handovers).toHaveLength(0);
  });

  it('refuses a missing keyring, before it asks for a credential', async () => {
    const s = await scenario({ keyring: false });
    await expect(openNativeSecureOwner(options(s))).rejects.toThrow('The secure conversation keyring is missing.');
    expect(hoisted.handovers).toHaveLength(0);
  });

  it('refuses a folder that cannot be resolved, before it reads the keyring', async () => {
    const s = await scenario();
    await expect(openNativeSecureOwner(options(s, { workspace: join(s.home, 'missing') }))).rejects.toThrow();
    expect(hoisted.handovers).toHaveLength(0);
  });

  it('refuses a wrong credential without opening a fence', async () => {
    const s = await scenario();
    await expect(openNativeSecureOwner(options(s, {
      secret: { type: 'passphrase', value: OTHER_PASSPHRASE },
    }))).rejects.toThrow();
    expect(hoisted.fences).toHaveLength(0);
    expect(existsSync(s.supervisedDirectory)).toBe(false);
  });
});

describe.skipIf(!SUPPORTED)('opening a native owner: what is refused during the unlock', () => {
  /**
   * The unlock costs one key derivation, and everything the call does before it runs synchronously,
   * so a change made right after the call starts lands inside the unlock, before the choice is rechecked.
   */
  async function refusedDuringUnlock(s: IScenario, change: () => void | Promise<void>): Promise<void> {
    const opening = openNativeSecureOwner(options(s));
    const refused = expect(opening).rejects.toThrow(CHANGED);
    await change();
    await refused;
  }

  async function expectCleanRefusal(s: IScenario): Promise<void> {
    // The fence was opened, so ending the opening closes it and disposes the handover.
    expect(hoisted.fences).toHaveLength(1);
    expect(hoisted.fences[0]?.close).toHaveBeenCalledTimes(1);
    expect(hoisted.handovers).toHaveLength(1);
    expect(hoisted.handovers[0]?.dispose).toHaveBeenCalledTimes(1);
    // Nothing after the recheck ran: no start lock, no supervised directory, no runtime.
    expect(existsSync(s.supervisedDirectory)).toBe(false);
    expect(hoisted.spawn).not.toHaveBeenCalled();
  }

  it('refuses a keyring that was replaced while it unlocked', async () => {
    const s = await scenario();
    await startBroker(s);
    const other = await createKeyring({ passphrase: OTHER_PASSPHRASE });
    other.unlocked.lock();
    await refusedDuringUnlock(s, () => writeFileSync(s.keyringPath, serializeKeyring(other.keyring), { mode: 0o600 }));
    await expectCleanRefusal(s);
  });

  it('refuses a conversation mode that was changed while it unlocked', async () => {
    const s = await scenario();
    await startBroker(s);
    await refusedDuringUnlock(s, () => writeProductConversationMode(s.userRoot, 'secure', 'plain'));
    await expectCleanRefusal(s);
  });

  it('refuses a window that was closed while it unlocked', async () => {
    const s = await scenario();
    await startBroker(s);
    const closing = new AbortController();
    const opening = openNativeSecureOwner(options(s, { signal: closing.signal }));
    const refused = expect(opening).rejects.toThrow(CHANGED);
    closing.abort();
    await refused;
    await expectCleanRefusal(s);
  });
});

describe.skipIf(!SUPPORTED)('opening a native owner: a start that fails after the fence opened', () => {
  let child: FakeRuntimeChild;

  beforeEach(() => {
    child = new FakeRuntimeChild();
    // The runtime's descriptor 4 is no pair: the start fails at once, after the runtime was spawned.
    child.stdio = [null, null, child.stderr, null, null];
    hoisted.spawn.mockReturnValue(child);
  });

  function spawnCall(): { executable: string; args: string[]; options: { cwd: string; stdio: unknown[]; env: NodeJS.ProcessEnv; detached: boolean } } {
    expect(hoisted.spawn).toHaveBeenCalledTimes(1);
    const [executable, args, spawnOptions] = hoisted.spawn.mock.calls[0] as [string, string[], never];
    return { executable, args, options: spawnOptions };
  }

  it('starts the sidecar command with the layout the product gave, and ends clean when the start fails', async () => {
    const s = await scenario();
    await startBroker(s);
    await expect(openNativeSecureOwner(options(s))).rejects.toThrow('Supervised session could not receive its spawner pair.');
    const { executable, args, options: spawned } = spawnCall();
    const id = args[args.indexOf('--run') + 1] as string;
    expect(executable).toBe(RUNTIME_EXECUTABLE);
    // The command's own arguments lead, then the layout's, in its order. The start is a secure one, so
    // it carries the pair and no token; it asks for the daemon role only after it is certified.
    expect(args).toEqual(['--exec-flag', 'entry.js', '--run', id, '--pair']);
    expect(spawned.cwd).toBe(s.workspace);
    expect(spawned.detached).toBe(true);
    expect(spawned.stdio).toEqual(['ignore', 'ignore', 'pipe', 'ipc', 'pipe']);
    expect(spawned.env).toEqual({ PATH: '/bin', KEPT: 'yes' });
    // The fence and the handover are released and the workspace's start lock is left to nobody.
    expect(hoisted.fences).toHaveLength(1);
    expect(hoisted.fences[0]?.close).toHaveBeenCalledTimes(1);
    expect(hoisted.handovers).toHaveLength(1);
    expect(hoisted.handovers[0]?.dispose).toHaveBeenCalledTimes(1);
    expect(readdirSync(s.supervisedDirectory).filter((name) => name.endsWith('.lock'))).toEqual([]);
    expect(child.kill).toHaveBeenCalledWith('SIGTERM');
  }, 30_000);

  it('starts a Restricted runtime when the person chose it', async () => {
    const s = await scenario();
    await startBroker(s);
    const prepared = await requestWorkspaceRootBroker(s.endpoint, { op: 'prepare', root: s.workspace });
    if (prepared.status !== 'prepared') throw new Error('The test folder could not be prepared.');
    const retained = await requestWorkspaceRootBroker(s.endpoint, { op: 'retainRestricted', root: s.workspace, candidate: prepared.candidate });
    if (retained.status !== 'restricted-held') throw new Error('The Restricted hold failed.');
    await expect(openNativeSecureOwner(options(s, { restricted: true, restrictedHold: retained.hold }))).rejects.toThrow(
      'Supervised session could not receive its spawner pair.',
    );
    const { args } = spawnCall();
    const id = args[args.indexOf('--run') + 1] as string;
    expect(args).toEqual(['--exec-flag', 'entry.js', '--run', id, '--pair', '--limited']);
    expect(hoisted.fences[0]?.close).toHaveBeenCalledTimes(1);
    expect(hoisted.handovers[0]?.dispose).toHaveBeenCalledTimes(1);
  }, 30_000);
});

describe('the rows the daemon proof takes from the registry', () => {
  const status = { activity: 'working' as const, reply: {} };

  it('lists a runtime whose control did not answer as unavailable, with an unknown activity, instead of leaving it out', () => {
    const runtimes: readonly ISupervisedRuntime[] = [
      { id: 'a', liveness: 'alive', generation: 'g1', control: 'available', status },
      { id: 'b', liveness: 'alive', control: 'unavailable' },
      { id: 'c', liveness: 'dead', control: 'unavailable' },
      { id: 'd', liveness: 'unknown', control: 'unavailable', problem: 'invalid-registration' },
      { id: 'e', liveness: 'alive', generation: 'g5', control: 'available', status: { activity: 'unknown', daemon: true, cwd: '/w', reply: {} } },
    ];
    expect(daemonCandidates(runtimes)).toEqual([
      { id: 'a', liveness: 'alive', control: 'available', activity: 'working', generation: 'g1' },
      { id: 'b', liveness: 'alive', control: 'unavailable', activity: 'unknown' },
      { id: 'c', liveness: 'dead', control: 'unavailable', activity: 'unknown' },
      { id: 'd', liveness: 'unknown', control: 'unavailable', activity: 'unknown', problem: 'invalid-registration' },
      { id: 'e', liveness: 'alive', control: 'available', activity: 'unknown', generation: 'g5' },
    ]);
    // Keys that carry no value are absent, not undefined, so a row compares equal field for field.
    expect(Object.keys(daemonCandidates(runtimes)[1] ?? {}).sort()).toEqual(['activity', 'control', 'id', 'liveness']);
  });

  it('keeps the registry order it was given', () => {
    expect(daemonCandidates([
      { id: 'b', liveness: 'dead', control: 'unavailable' },
      { id: 'a', liveness: 'dead', control: 'unavailable' },
    ]).map((row) => row.id)).toEqual(['b', 'a']);
  });
});
