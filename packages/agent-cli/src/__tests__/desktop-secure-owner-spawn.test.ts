import { execFileSync } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { PassThrough } from 'node:stream';

import { openOwnerHandover, serializeKeyring } from '@robota-sdk/agent-keyring';
import {
  openNativeSecureOwner,
  requestWorkspaceRootBroker,
  workspaceRootBrokerEndpoint,
  writeProductConversationMode,
} from '@robota-sdk/agent-local-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createTestBinaryEnvironment, createTestProductRuntime } from './helpers/product-runtime.js';
import { startTestBroker } from './helpers/test-workspace-root-broker.js';
import { resolveDesktopSecureLayout } from '../desktop-secure-layout.js';
import { FIXTURE_PASSPHRASE, fixtureKeyring } from '../secure/__tests__/helpers.js';
import { launchCertifiedRuntime } from '../session-inventory/certified-runtime-launch.js';

const SIDECAR = vi.hoisted(() => 'fixture-sidecar');
const hoisted = vi.hoisted(() => ({ spawn: vi.fn() }));

// Only the sidecar's start is stubbed; the broker the fixture runs in another process is real.
vi.mock('node:child_process', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:child_process')>();
  return {
    ...actual,
    spawn: ((...args: Parameters<typeof actual.spawn>) =>
      args[0] === SIDECAR
        ? hoisted.spawn(...args)
        : Reflect.apply(actual.spawn, actual, args)) as typeof actual.spawn,
  };
});

/** What a launch drives of a spawned child; it has no pair descriptor, so the start ends at once. */
class FakeChild extends EventEmitter {
  pid = 4242;
  exitCode: number | null = null;
  signalCode: NodeJS.Signals | null = null;
  connected = true;
  readonly stderr = new PassThrough();
  stdio: unknown[] = [null, null, this.stderr, null, null];
  send = vi.fn();
  disconnect = vi.fn(() => { this.connected = false; });
  unref = vi.fn();
  kill = vi.fn(() => {
    this.signalCode = 'SIGTERM';
    queueMicrotask(() => this.emit('exit'));
    return true;
  });
}

interface ISpawned {
  readonly executable: string;
  /** The arguments with the one random id replaced, so two spawns compare exactly. */
  readonly args: readonly string[];
  readonly options: unknown;
}

function spawned(): ISpawned {
  expect(hoisted.spawn).toHaveBeenCalledTimes(1);
  const [executable, args, options] = hoisted.spawn.mock.calls[0] as [string, string[], unknown];
  const id = args[args.indexOf('--supervised-session-id') + 1];
  return { executable, args: args.map((argument) => (argument === id ? '<id>' : argument)), options };
}

const roots: string[] = [];
const brokers: Array<{ close(): Promise<void> }> = [];

beforeEach(() => { hoisted.spawn.mockReset(); });

afterEach(async () => {
  for (const broker of brokers.splice(0)) await broker.close();
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true, maxRetries: 10 });
});

const SUPPORTED = process.platform === 'darwin' || process.platform === 'linux';

describe.skipIf(!SUPPORTED)('the sidecar a desktop owner opening spawns', () => {
  it.each([{ restricted: false }, { restricted: true }])(
    'is the one the CLI adapter spawns for the same input (%j)',
    async ({ restricted }) => {
      const home = realpathSync(mkdtempSync(join(realpathSync('/tmp'), 'desktop-spawn-')));
      roots.push(home);
      const workspace = join(home, 'workspace');
      mkdirSync(workspace);
      execFileSync('git', ['init', '--quiet', workspace]);
      const environment = createTestBinaryEnvironment(home, { PRODUCT_TELEMETRY_ENABLED: '0' });
      const runtime = createTestProductRuntime('test-product', environment);
      mkdirSync(dirname(runtime.layout.userPaths.keyring), { recursive: true, mode: 0o700 });
      const { keyring } = await fixtureKeyring();
      writeFileSync(runtime.layout.userPaths.keyring, serializeKeyring(keyring), { mode: 0o600 });
      writeProductConversationMode(runtime.layout.userRoot, 'plain', 'secure');
      const endpoint = workspaceRootBrokerEndpoint(runtime.layout.userRoot);
      mkdirSync(dirname(endpoint), { recursive: true, mode: 0o700 });
      brokers.push(await startTestBroker(endpoint, dirname(endpoint), runtime.layout.userPaths.workspaceTrust));
      const prepared = await requestWorkspaceRootBroker(endpoint, { op: 'prepare', root: workspace });
      if (prepared.status !== 'prepared') throw new Error('The test folder could not be prepared.');
      let restrictedHold: string | undefined;
      if (restricted) {
        const retained = await requestWorkspaceRootBroker(endpoint, { op: 'retainRestricted', root: workspace, candidate: prepared.candidate });
        if (retained.status !== 'restricted-held') throw new Error('Restricted test folder hold failed.');
        restrictedHold = retained.hold;
      } else {
        const approved = await requestWorkspaceRootBroker(endpoint, { op: 'approve', root: workspace, candidate: prepared.candidate });
        if (approved.status !== 'trusted') throw new Error('The test folder could not be approved.');
      }

      const layout = resolveDesktopSecureLayout({ config: runtime.config, environment: runtime.environment });
      const loader = ['--import', 'loader.mjs', '--conditions=product-source', 'runtime-entry.ts'];
      const childEnvironment = {
        PATH: '/bin', KEPT: 'yes',
        PRODUCT_WS_TOKEN: 'c'.repeat(64), TEST_PRODUCT_WS_TOKEN: 'd'.repeat(64),
      };
      const failure = 'Supervised session could not receive its spawner pair.';

      // What the CLI spawned for the desktop's request: the adapter the opening used before it moved.
      const handover = await openOwnerHandover(keyring, { type: 'passphrase', passphrase: FIXTURE_PASSPHRASE });
      hoisted.spawn.mockReturnValueOnce(new FakeChild());
      await expect(launchCertifiedRuntime(workspace, {
        productRuntime: runtime,
        root: layout.supervisedDirectory,
        env: childEnvironment,
        handover,
        daemonRole: true,
        launchCommand: { executable: SIDECAR, args: loader },
        ...(restricted ? { restricted: true } : {}),
      })).rejects.toThrow(failure);
      handover.dispose();
      const cliAdapter = spawned();

      hoisted.spawn.mockReset();
      hoisted.spawn.mockReturnValueOnce(new FakeChild());
      await expect(openNativeSecureOwner({
        ...layout,
        workspace,
        restricted,
        ...(restrictedHold === undefined ? {} : { restrictedHold }),
        secret: { type: 'passphrase', value: FIXTURE_PASSPHRASE },
        signal: new AbortController().signal,
        environment: childEnvironment,
        command: { executable: SIDECAR, execArgs: [], entryArgs: loader },
      })).rejects.toThrow(failure);
      const native = spawned();

      expect(native).toEqual(cliAdapter);
      // Not only equal: the exact secure start, so a change on both sides at once is seen too.
      expect(native.executable).toBe(SIDECAR);
      expect(native.args).toEqual([
        ...loader, '--serve', '--supervised-session-id', '<id>', '--supervised-spawner-pair',
        ...(restricted ? ['--restricted-workspace'] : []),
      ]);
      expect(native.options).toEqual({
        cwd: workspace,
        detached: true,
        stdio: ['ignore', 'ignore', 'pipe', 'ipc', 'pipe'],
        env: { PATH: '/bin', KEPT: 'yes' },
      });
    },
    60_000,
  );
});
