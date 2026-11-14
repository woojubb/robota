import { createTestProductRuntime } from '../../__tests__/helpers/product-runtime.js';
/**
 * A served runtime that answered its spawner's pair: it refuses what would admit whoever holds a
 * token before its host starts, registers no WebSocket, hands its control socket to its custody, and
 * ends itself when nothing certifies it. Only the wiring is covered here; each rule has its own suite.
 */
import { createRuntimeIdentity } from '@robota-sdk/agent-keyring';
import { createTestFrameworkHost } from '@robota-sdk/agent-framework/testing';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { KeyHolder } from '@robota-sdk/agent-local-host';
import { createMemoryKeyringStore } from '../../secure/__tests__/helpers.js';
import { SECURE_SURFACES } from '../../secure/secure-surfaces.js';

import type { IServeModeOptions } from '../serve-mode.js';

const testHost = createTestFrameworkHost();
const ID = '8bf9bc27-d773-4e88-b88f-f7a43e9eb1f4';

const hosts: Array<{ shutdown: ReturnType<typeof vi.fn> }> = [];
const controls: Array<Record<string, unknown>> = [];
const startedHosts = vi.fn();

vi.mock('@robota-sdk/agent-framework', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@robota-sdk/agent-framework')>();
  return {
    ...actual,
    startRuntimeHost: async (options: { bindTransports?: (slot: unknown) => void }) => {
      startedHosts();
      const current = {
        getLocalActivityStatus: () => 'idle',
        listSelfPacedLoops: () => [],
        getName: () => undefined,
        on: () => undefined,
        off: () => undefined,
        shutdown: async () => undefined,
      };
      const slot = { current };
      options.bindTransports?.(slot);
      const host = {
        session: slot,
        shutdown: vi.fn(async () => undefined),
        waitForCompletion: async () => [],
        waitForFailure: () => new Promise(() => undefined),
      };
      hosts.push(host);
      return host;
    },
  };
});

vi.mock('../../session-inventory/supervised-session-control.js', () => ({
  ensureSupervisedAuditDirectory: () => '/audit',
  resolveSupervisedDirectory: () => '/supervised',
  takeSupervisedGrantHandoff: () => [],
  startSupervisedControl: async (options: Record<string, unknown>) => {
    controls.push(options);
    return { close: async () => undefined };
  },
}));

// This suite checks serve-mode wiring; the broker and physical-root contract have dedicated suites.
vi.mock('../../startup/workspace-root-broker-process.js', () => ({
  ensureWorkspaceRootBroker: async () => '/test-broker',
}));
vi.mock('../../secure/workspace-root-fence.js', () => ({
  SecureWorkspaceRootFence: class {
    assertCurrent() {}
    proof() { return { tag: 'test-root', generation: 1, trustTag: 'untrusted' }; }
    close() {}
  },
}));

const { runServeMode } = await import('../serve-mode.js');

const realSend = process.send;
let sent: Array<{ kind: string }> = [];
/** What the readiness exchange registered on `process`, kept apart from the test runner's own listeners. */
const messageListeners = new Set<(message: unknown) => void>();

beforeEach(() => {
  sent = [];
  messageListeners.clear();
  const originalOn = process.on.bind(process);
  const originalOff = process.off.bind(process);
  vi.spyOn(process, 'on').mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'message') {
      messageListeners.add(listener);
      return process;
    }
    return originalOn(event, listener);
  }) as typeof process.on);
  vi.spyOn(process, 'off').mockImplementation(((event: string, listener: (...args: unknown[]) => void) => {
    if (event === 'message') {
      messageListeners.delete(listener);
      return process;
    }
    return originalOff(event, listener);
  }) as typeof process.off);
  // The launcher's end of the readiness exchange: it hears `ready` and acknowledges it.
  process.send = ((message: { kind: string; id: string }, done?: (error?: Error | null) => void) => {
    sent.push(message);
    done?.(null);
    if (message.kind === 'ready') {
      queueMicrotask(() => {
        for (const listener of [...messageListeners]) listener({ kind: 'ack', id: message.id });
      });
    }
    return true;
  }) as unknown as typeof process.send;
});

afterEach(() => {
  process.send = realSend;
  vi.restoreAllMocks();
  hosts.length = 0;
  controls.length = 0;
  startedHosts.mockClear();
  vi.useRealTimers();
});

function secureOptions(
  args: Record<string, unknown> = {},
  overrides: Partial<IServeModeOptions> = {},
): IServeModeOptions {
  return {
    host: testHost,
    productRuntime: createTestProductRuntime(),
    cwd: process.cwd(),
    args: {
      supervisedSessionId: ID,
      supervisedSpawnerPair: true,
      ...args,
    } as unknown as IServeModeOptions['args'],
    provider: {} as IServeModeOptions['provider'],
    sessionStore: {} as IServeModeOptions['sessionStore'],
    backgroundTaskRunners: [],
    subagentRunnerFactory: (() => undefined) as unknown as IServeModeOptions['subagentRunnerFactory'],
    commandModules: [],
    commandHostAdapters: {},
    transportRegistry: {} as IServeModeOptions['transportRegistry'],
    preset: {},
    secureRuntime: {
      identity: createRuntimeIdentity(),
      holder: new KeyHolder({ store: createMemoryKeyringStore() }),
    },
    ...overrides,
  };
}

function reasonOf(row: 'serve-http' | 'serve-monitor' | 'external-events'): string {
  const { secure } = SECURE_SURFACES[row];
  if (secure.admit !== 'none') throw new Error('expected a refused row');
  return secure.reason;
}

describe('a secure runtime at start', () => {
  it.each([
    ['--http', { http: { port: 8080, token: 't' } }, {}, reasonOf('serve-http')],
    ['--open', {}, { open: true }, reasonOf('serve-monitor')],
    ['event grants', {}, { supervisedExternalEventGrants: true }, reasonOf('external-events')],
    ['--daemon', {}, { daemon: true }, 'A secure runtime does not start as a daemon: it becomes its workspace daemon when its owner asks, over an owner link.'],
  ])('refuses %s before its host starts, with the reason it states', async (_name, overrides, args, reason) => {
    await expect(runServeMode(secureOptions(args, overrides as Partial<IServeModeOptions>))).rejects.toThrow(reason);

    expect(startedHosts).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('is secure exactly when it answered its spawner pair', async () => {
    await expect(runServeMode(secureOptions({ supervisedSpawnerPair: undefined }))).rejects.toThrow(/spawner pair/u);
    const { secureRuntime: _secure, ...plain } = secureOptions();
    await expect(runServeMode(plain)).rejects.toThrow(/spawner pair/u);

    expect(startedHosts).not.toHaveBeenCalled();
  });

  it('does not send a supervised startup failure into an unrelated parent channel', async () => {
    const { secureRuntime: _secure, ...plain } = secureOptions({
      supervisedSpawnerPair: undefined,
      daemon: true,
    });
    await expect(runServeMode(plain)).rejects.toThrow('The daemon has no WebSocket endpoint.');
    expect(sent).toEqual([]);
  });

  it('registers no WebSocket and gives its control socket to its custody', async () => {
    const bindTransports = vi.fn();
    const run = runServeMode(secureOptions({}, { bindTransports }));
    await vi.waitFor(() => expect(controls).toHaveLength(1));
    await vi.waitFor(() => expect(sent.map((message) => message.kind)).toContain('acknowledged'));

    expect(bindTransports).not.toHaveBeenCalled();
    expect(controls[0]!['admission']).toBeTypeOf('function');
    expect(controls[0]!['daemon']).toBeUndefined();
    expect(controls[0]!['attachTarget']).toBeDefined();

    (controls[0]!['onStop'] as () => void)();
    await run;
  });

  it('serves a plain runtime as it always did, with no custody and its WebSocket bound', async () => {
    const bindTransports = vi.fn();
    const { secureRuntime: _secure, ...plain } = secureOptions({ supervisedSpawnerPair: undefined }, { bindTransports });
    const run = runServeMode(plain);
    await vi.waitFor(() => expect(controls).toHaveLength(1));

    expect(bindTransports).toHaveBeenCalledTimes(1);
    expect(controls[0]!['admission']).toBeUndefined();

    (controls[0]!['onStop'] as () => void)();
    await run;
  });
});

describe('a secure runtime nothing certifies', () => {
  it('ends itself when no spawner links to it in time', async () => {
    vi.useFakeTimers();
    const run = runServeMode(secureOptions());
    await vi.advanceTimersByTimeAsync(0);
    expect(sent.map((message) => message.kind)).toContain('acknowledged');

    await vi.advanceTimersByTimeAsync(29_999);
    expect(hosts[0]!.shutdown).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);

    await run;
    expect(hosts[0]!.shutdown).toHaveBeenCalledTimes(1);
    expect(hosts[0]!.shutdown.mock.calls[0]![0]).toMatch(/no spawner linked/u);
  });
});
