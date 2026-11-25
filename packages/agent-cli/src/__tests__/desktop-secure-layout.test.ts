import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import {
  SUPERVISED_SPAWNER_PAIR_FLAG,
  SUPERVISED_TRANSPORT_TOKEN_FLAG,
} from '@robota-sdk/agent-local-host';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { resolveDesktopSecureLayout } from '../desktop-host.js';
import { createCliRuntimeContext } from '../product/runtime-context.js';
import { resolveSupervisedDirectory } from '../session-inventory/supervised-session-control.js';
import { launchCliBroker } from '../startup/workspace-root-broker-composition.js';
import { RESTRICTED_WORKSPACE_FLAG } from '../startup/workspace-project-composition.js';
import { createTestProductRuntime } from './helpers/product-runtime.js';

import type { IRuntimeStartLayout, IRuntimeStartRequest } from '@robota-sdk/agent-local-host';

/** What a launch states about one start, as the layout's argument function takes it. */
type TLaunchFacts = Parameters<IRuntimeStartLayout['arguments']>[0];

const hoisted = vi.hoisted(() => ({ requests: [] as unknown[] }));

// The launch adapter's request is what the layout must equal; the launcher itself starts nothing here.
vi.mock('@robota-sdk/agent-local-host', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@robota-sdk/agent-local-host')>()),
  startPlainRuntime: async (_cwd: string, request: IRuntimeStartRequest) => {
    hoisted.requests.push(request);
    return 'plain-id';
  },
  startSpawnerRuntime: async (_cwd: string, request: IRuntimeStartRequest) => {
    hoisted.requests.push(request);
    return { id: 'spawner-id' };
  },
}));

const { launchRuntimeProcess, launchSupervisedSession } =
  await import('../session-inventory/supervised-session-launch.js');

const originalRuntimeDirectory = process.env['XDG_RUNTIME_DIR'];
const temporaryRoots: string[] = [];

beforeEach(() => {
  hoisted.requests.length = 0;
});

afterEach(() => {
  if (originalRuntimeDirectory === undefined) delete process.env['XDG_RUNTIME_DIR'];
  else process.env['XDG_RUNTIME_DIR'] = originalRuntimeDirectory;
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function temporaryDirectory(label: string): string {
  const directory = mkdtempSync(join(tmpdir(), `desktop-layout-${label}-`));
  temporaryRoots.push(directory);
  return directory;
}

/** A product runtime in an isolated home, with the runtime directory variable set or absent. */
function fixture(runtimeDirectory: string | undefined) {
  const home = temporaryDirectory('home');
  const product = createTestProductRuntime('test-product', {
    HOME: home,
    ...(runtimeDirectory === undefined ? {} : { XDG_RUNTIME_DIR: runtimeDirectory }),
  });
  // The process's own variable is a decoy: the layout follows the environment it is given.
  process.env['XDG_RUNTIME_DIR'] = temporaryDirectory('decoy');
  const { config, environment } = product;
  return {
    config,
    environment,
    layout: resolveDesktopSecureLayout({ config, environment }),
    // The context the desktop's secure owner flow reads today.
    runtime: createCliRuntimeContext(config, environment, undefined, 'secure'),
  };
}

/** Every combination of the facts a launch states, for one id and name. */
function everyLaunchFacts(): TLaunchFacts[] {
  const flags = [false, true];
  const facts: TLaunchFacts[] = [];
  for (const daemon of flags)
    for (const restricted of flags)
      for (const transportToken of flags)
        for (const spawnerPair of flags)
          for (const forwardedEnvironment of flags)
            for (const handoff of flags)
              for (const name of [undefined, 'named'])
                facts.push({
                  id: 'runtime-id',
                  ...(name === undefined ? {} : { name }),
                  daemon,
                  restricted,
                  transportToken,
                  spawnerPair,
                  forwardedEnvironment,
                  handoff,
                });
  return facts;
}

/** The runtime directory variable the caller's environment carries, or none. */
const RUNTIME_DIRECTORY_CASES = [
  { variable: 'set', runtimeDirectory: (): string | undefined => temporaryDirectory('runtime') },
  { variable: 'unset', runtimeDirectory: (): string | undefined => undefined },
];

describe.each(RUNTIME_DIRECTORY_CASES)(
  'the desktop secure layout with the runtime directory variable $variable',
  ({ runtimeDirectory }) => {
    it('equals what the secure runtime context lays out for the owner flow', () => {
      const { layout, runtime } = fixture(runtimeDirectory());
      expect(layout.userRoot).toBe(runtime.layout.userRoot);
      expect(layout.keyringPath).toBe(runtime.layout.userPaths.keyring);
      expect(layout.broker.historyFile).toBe(runtime.layout.userPaths.workspaceTrust);
      expect(layout.supervisedDirectory).toBe(resolveSupervisedDirectory(runtime));
      expect(layout.startLock.removalHint).toBe(
        `${runtime.vocabulary.cliName} daemon clear-start-lock`,
      );
    });

    it('names where the product keeps its state and what it tells a person', () => {
      const directory = runtimeDirectory();
      const { layout } = fixture(directory);
      expect(layout.userRoot).toMatch(/\.test-product$/u);
      expect(layout.keyringPath).toBe(join(layout.userRoot, 'secure', 'keyring.json'));
      expect(layout.broker.historyFile).toBe(join(layout.userRoot, 'workspace-trust.json'));
      expect(layout.startLock.removalHint).toBe('test-product daemon clear-start-lock');
      // A runtime directory the system removes with the login session is preferred; otherwise the state root.
      expect(layout.supervisedDirectory).toBe(
        directory === undefined
          ? join(layout.userRoot, 'supervised')
          : join(directory, 'test-product.daemon', 'supervised'),
      );
    });

    it('creates nothing and holds only strings, arrays, plain objects and functions', () => {
      const directory = runtimeDirectory();
      const { layout } = fixture(directory);
      expect(Object.keys(layout).sort()).toEqual([
        'broker',
        'keyringPath',
        'runtimeLayout',
        'startLock',
        'supervisedDirectory',
        'userRoot',
      ]);
      const leaves: string[] = [];
      const visit = (value: unknown, path: string): void => {
        if (typeof value === 'string' || typeof value === 'function') {
          leaves.push(typeof value);
          return;
        }
        const plain =
          Array.isArray(value) ||
          (typeof value === 'object' &&
            value !== null &&
            Object.getPrototypeOf(value) === Object.prototype);
        expect(plain, `${path} is neither a plain object nor an array`).toBe(true);
        for (const [key, child] of Object.entries(value as object)) visit(child, `${path}.${key}`);
      };
      visit(layout, 'layout');
      expect(leaves.length).toBeGreaterThan(0);
      // Resolving the layout reads nothing and writes nothing: neither the state root nor the runtime directory.
      expect(existsSync(layout.userRoot)).toBe(false);
      if (directory !== undefined) expect(readdirSync(directory)).toEqual([]);
    });
  },
);

describe('the broker launch recipe of the desktop secure layout', () => {
  it("is the CLI's own: its binary, re-entered with the broker's endpoint, lock directory and history file", () => {
    const { layout } = fixture(undefined);
    const sample = {
      endpoint: join(temporaryDirectory('broker'), 'broker.sock'),
      lockDirectory: temporaryDirectory('lock'),
      historyFile: layout.broker.historyFile,
    };
    const launch = layout.broker.launcher(sample);
    expect(launch).toEqual(launchCliBroker(sample));
    expect(launch.executable).toBe(process.execPath);
    expect(launch.args.slice(-4)).toEqual([
      '--internal-root-broker',
      sample.endpoint,
      sample.lockDirectory,
      sample.historyFile,
    ]);
    expect(launch.startMs).toBeGreaterThan(0);
  });
});

describe('the runtime layout of the desktop secure layout', () => {
  /** The layout each launch adapter hands the generic launcher, for the desktop's secure runtime. */
  function adapterLayouts(runtime: ReturnType<typeof fixture>['runtime']) {
    hoisted.requests.length = 0;
    return Promise.all([
      launchSupervisedSession('/workspace', { productRuntime: runtime, env: {}, daemon: true }),
      launchRuntimeProcess('/workspace', {
        productRuntime: runtime,
        env: {},
        daemon: true,
        mode: 'spawner',
      }),
    ]).then(() => (hoisted.requests as IRuntimeStartRequest[]).map((request) => request.layout));
  }

  it.each(RUNTIME_DIRECTORY_CASES)(
    'takes the arguments, token names and refusal copy of a daemon launch, as the launch adapter does (runtime directory variable $variable)',
    async ({ runtimeDirectory }) => {
      const { layout, runtime } = fixture(runtimeDirectory());
      const adapters = await adapterLayouts(runtime);
      expect(adapters).toHaveLength(2);
      expect(layout.runtimeLayout.transportTokenNames).toEqual([
        'PRODUCT_WS_TOKEN',
        `${runtime.config.identity.envPrefix}WS_TOKEN`,
      ]);
      for (const adapter of adapters) {
        expect(layout.runtimeLayout.transportTokenNames).toEqual(adapter.transportTokenNames);
        for (const facts of everyLaunchFacts()) {
          expect(layout.runtimeLayout.arguments(facts)).toEqual(adapter.arguments(facts));
        }
        for (const [code, detail] of [
          ['grant-refused', { grant: 'grant-1' }],
          ['events-endpoint-failed', {}],
          ['daemon-no-endpoint', {}],
          ['something-else', {}],
        ] as const) {
          expect(layout.runtimeLayout.refusalText?.(code, detail)).toBe(
            adapter.refusalText?.(code, detail),
          );
        }
      }
    },
  );

  it('starts the supervised runtime entry with the flags of a Restricted daemon whose token and spawner pair travel apart', () => {
    const { layout } = fixture(undefined);
    expect(
      layout.runtimeLayout.arguments({
        id: 'runtime-id',
        daemon: true,
        restricted: true,
        transportToken: true,
        spawnerPair: true,
        forwardedEnvironment: false,
        handoff: false,
      }),
    ).toEqual([
      '--serve',
      '--supervised-session-id',
      'runtime-id',
      SUPERVISED_TRANSPORT_TOKEN_FLAG,
      SUPERVISED_SPAWNER_PAIR_FLAG,
      '--daemon',
      RESTRICTED_WORKSPACE_FLAG,
    ]);
    expect(layout.runtimeLayout.refusalText?.('grant-refused', { grant: 'grant-1' })).toBe(
      'grant grant-1: refused by the session.',
    );
    expect(layout.runtimeLayout.refusalText?.('something-else', {})).toBeUndefined();
  });
});
