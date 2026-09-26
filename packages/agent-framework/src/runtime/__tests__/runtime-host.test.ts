/**
 * RUNTIME-001 TC-01 — the shared runtime host builds the session, owns the transport lifecycle
 * (startAll on start, stopAll on shutdown), and shuts down idempotently. Presentation-free: this test
 * imports no `agent-ui-terminal`/ink.
 */

import { createHook } from 'node:async_hooks';
import { mkdirSync, mkdtempSync, rmSync, realpathSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { InteractiveSession } from '../../interactive/interactive-session.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { buildRuntimeSession, startRuntimeHost } from '../runtime-host.js';
import { SessionSlot } from '../session-slot.js';
import {
  createNodeHostSessionStore,
  listResumableSessionSummaries,
} from '../../interactive/session-persistence.js';
import { createTransportFailedOutcome } from '@robota-sdk/agent-interface-transport';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ITransportLifecycleRegistryView } from '@robota-sdk/agent-interface-transport';

function stubProvider(): IAIProvider {
  return {
    name: 'runtime-host-test-provider',
    version: '1.0.0',
    async chat() {
      return {
        id: 'a1',
        role: 'assistant',
        content: 'ok',
        state: 'complete',
        timestamp: new Date(),
      };
    },
    async generateResponse() {
      return { content: 'unused' };
    },
    supportsTools() {
      return true;
    },
    validateConfig() {
      return true;
    },
  } as unknown as IAIProvider;
}

function stubRegistry(): ITransportLifecycleRegistryView & {
  startAll: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
} {
  return {
    register: vi.fn(),
    startAll: vi.fn(async () => undefined),
    waitForCompletion: vi.fn(async () => []),
    waitForFailure: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => ({ errors: [] })),
  } as ITransportLifecycleRegistryView & {
    startAll: ReturnType<typeof vi.fn>;
    stopAll: ReturnType<typeof vi.fn>;
  };
}

describe('startRuntimeHost (RUNTIME-001 TC-01)', () => {
  let cwd: string;
  let home: string;
  let savedHome: string | undefined;
  let savedProfile: string | undefined;
  let homeRoot: string;
  // `process.env.X = undefined` stores the string "undefined", so restoring means delete-or-assign.
  function restoreHome(): void {
    if (savedHome === undefined) delete process.env.HOME;
    else process.env.HOME = savedHome;
    if (savedProfile === undefined) delete process.env.USERPROFILE;
    else process.env.USERPROFILE = savedProfile;
  }
  beforeEach(() => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'runtime-host-')));
    // Keep the Node home used for plugin directory resolution isolated from the developer's home.
    // The runtime has no ambient user settings source, so this no longer admits hooks by itself.
    homeRoot = realpathSync(mkdtempSync(join(tmpdir(), 'runtime-host-home-')));
    home = join(homeRoot, 'home');
    mkdirSync(home);
    savedHome = process.env.HOME;
    savedProfile = process.env.USERPROFILE;
    process.env.HOME = home;
    process.env.USERPROFILE = home;
  });
  afterEach(() => {
    restoreHome();
    rmSync(homeRoot, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  });

  it('binds transports to the built session before starting the argument-free registry', async () => {
    const registry = stubRegistry();
    const bindTransports = vi.fn();
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider() },
      transportRegistry: registry,
      bindTransports,
    });

    expect(host.session.current).toBeInstanceOf(InteractiveSession);
    expect(bindTransports).toHaveBeenCalledWith(host.session);
    expect(registry.startAll).toHaveBeenCalledTimes(1);
    expect(registry.startAll).toHaveBeenCalledWith();
    expect(bindTransports.mock.invocationCallOrder[0]).toBeLessThan(
      registry.startAll.mock.invocationCallOrder[0]!,
    );

    await host.shutdown();
  });

  it('shutdown() leaves no timer holding the event loop open (#1852)', async () => {
    // The bound exists so a WEDGED subsystem cannot block exit. Its own timer must therefore not
    // become a reason to stay alive: the losing side of a `Promise.race` is not cancelled, so an
    // un-unref'd bound keeps the process alive for its full 5s even when shutdown finished in 1ms.
    //
    // Measured on `robota --serve` before the fix: teardown done at 1ms, process exit at 5006ms,
    // with zero handles and a single `Timeout` as the only live resource. The bintest's 8s budget
    // was passing with a 3s margin over a cost paid on every shutdown.
    //
    // Asserted on the identity of the timers armed during the host's lifetime rather than on elapsed
    // time (a timing assertion would pass on a fast machine for the wrong reason) and rather than on
    // a process-wide `getActiveResourcesInfo` count (which moves with whatever else the worker has
    // running — issue #2383). The claim is loop-holding, as the #1852 title says: a timer armed while
    // the host lived — by the host or the session it built — and still ref'd after `shutdown()`.
    // An unref'd timer is accepted; a `clearTimeout → unref()` regression in the host would pass
    // here, and the host's own comment explains why cancelling is the stronger statement.
    //
    // `seen` keeps every Timeout init and is never shrunk — an empty `seen` means the instrument
    // did not see the bound, which is "could not check", not a pass. `destroyed` collects the ids
    // `destroy` reports. `clearTimeout` leaves `hasRef()` true and `destroy` fires on the NEXT
    // check-phase turn (measured on Node 22.14), so one `setImmediate` is awaited before reading:
    // read synchronously, the correctly cancelled bound reports as leaked.
    const seen = new Map<number, { resource: NodeJS.Timeout; stack: string }>();
    const destroyed = new Set<number>();
    const hook = createHook({
      init(asyncId, type, _triggerAsyncId, resource) {
        if (type !== 'Timeout') return;
        // Frame 0 is the Error line and frame 1 is this init hook; the arming site comes first.
        const stack = (new Error().stack ?? '')
          .split('\n')
          .filter((line) => !/node:(internal|timers|async_hooks)/.test(line))
          .slice(2, 7)
          .map((line) => line.trim())
          .join(' | ');
        // The 'Timeout' discriminant is what guarantees the resource is the Timeout itself.
        seen.set(asyncId, { resource: resource as NodeJS.Timeout, stack });
      },
      destroy(asyncId) {
        if (seen.has(asyncId)) destroyed.add(asyncId);
      },
    });
    hook.enable();
    try {
      const registry = stubRegistry();
      const host = await startRuntimeHost({
        session: { cwd, provider: stubProvider() },
        transportRegistry: registry,
      });
      await host.shutdown();
      await new Promise((resolve) => setImmediate(resolve));
    } finally {
      hook.disable();
    }

    expect(seen.size, 'the instrument saw at least the shutdown bound').toBeGreaterThanOrEqual(1);
    const survivors = [...seen]
      .filter(([id, entry]) => !destroyed.has(id) && entry.resource.hasRef())
      .map(([, entry]) => entry.stack);
    expect(
      survivors,
      `${survivors.length} timer(s) armed during the host's lifetime still hold the event loop after shutdown()`,
    ).toEqual([]);
  });

  it("resolves the isolated home for plugin discovery, not the developer's (TEST-012 control)", () => {
    // `homedir()` follows `process.env.HOME` in Vitest's forked worker. A worker-pool change must
    // preserve this isolation for any test that deliberately admits user plugin discovery.
    expect(homedir()).toBe(home);

    restoreHome();
    expect(homedir()).not.toBe(home);
  });

  it('shutdown() stops the transports and is idempotent', async () => {
    const registry = stubRegistry();
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider() },
      transportRegistry: registry,
    });

    const shutdownSpy = vi.spyOn(host.session, 'shutdown');
    await host.shutdown('first');
    await host.shutdown('second'); // idempotent — no second teardown

    expect(registry.stopAll).toHaveBeenCalledTimes(1);
    expect(shutdownSpy).toHaveBeenCalledTimes(1);
  });

  it('runs without a transport registry (no-op lifecycle)', async () => {
    const host = await startRuntimeHost({ session: { cwd, provider: stubProvider() } });
    expect(host.session.current).toBeInstanceOf(InteractiveSession);
    await expect(host.shutdown()).resolves.toBeUndefined();
  });

  it('binds transports to a slot that follows a switch to another session (#3189)', async () => {
    const registry = stubRegistry();
    const store = createNodeHostSessionStore(join(homeRoot, 'sessions'));
    const bindTransports = vi.fn();
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider(), sessionStore: store },
      transportRegistry: registry,
      bindTransports,
    });
    const bound = bindTransports.mock.calls[0]![0] as SessionSlot;
    expect(bound).toBe(host.session);
    const first = host.session.current;

    const next = buildRuntimeSession({ cwd, provider: stubProvider(), sessionStore: store });
    await next.whenInitialized();
    // Saved once initialized, so a host can list it before making it current.
    expect(listResumableSessionSummaries(store, cwd).map((row) => row.id)).toContain(
      next.getSession().getSessionId(),
    );
    const firstShutdown = vi.spyOn(first, 'shutdown');
    await host.session.replace(next);

    expect(bound.current).toBe(next);
    expect(bound.getSession().getSessionId()).toBe(next.getSession().getSessionId());
    expect(firstShutdown).toHaveBeenCalledTimes(1);
    await host.shutdown();
  });

  it('shutdown() drains every pooled session, the primary included (#3189)', async () => {
    const registry = stubRegistry();
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider() },
      transportRegistry: registry,
      pool: {},
    });
    const pool = host.pool!;
    const primary = host.session.current;
    const lease = await pool.acquire();
    const binding = pool.bind('drive');
    binding.moveTo(lease);
    const pooled = lease.session;
    expect(pooled).not.toBe(primary);
    const primaryShutdown = vi.spyOn(primary, 'shutdown');
    const pooledShutdown = vi.spyOn(pooled, 'shutdown');

    await host.shutdown('bye');

    expect(registry.stopAll).toHaveBeenCalledTimes(1);
    expect(primaryShutdown).toHaveBeenCalledTimes(1);
    expect(pooledShutdown).toHaveBeenCalledTimes(1);
    await expect(pool.acquire()).rejects.toMatchObject({ code: 'stopping' });
  });

  it('holds one session and no pool unless asked for one (#3189)', async () => {
    const host = await startRuntimeHost({ session: { cwd, provider: stubProvider() } });
    expect(host.pool).toBeUndefined();
    await host.shutdown();
  });

  it('exposes ordered completion and prompt failure waits from the lifecycle registry', async () => {
    const registry = stubRegistry();
    const failed = createTransportFailedOutcome(2);
    vi.mocked(registry.waitForCompletion).mockResolvedValue([{ name: 'runner', outcome: failed }]);
    vi.mocked(registry.waitForFailure).mockResolvedValue({
      name: 'runner',
      outcome: failed,
    });
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider() },
      transportRegistry: registry,
    });

    await expect(host.waitForCompletion()).resolves.toEqual([
      { name: 'runner', outcome: { status: 'failed', exitCode: 2 } },
    ]);
    await expect(host.waitForFailure()).resolves.toEqual({
      name: 'runner',
      outcome: { status: 'failed', exitCode: 2 },
    });

    await host.shutdown();
  });
});

describe('buildRuntimeSession recipe invariants', () => {
  it('rejects a missing provider before constructing a session', () => {
    expect(() => buildRuntimeSession({ cwd: process.cwd(), provider: undefined } as never)).toThrow(
      'buildRuntimeSession: provider is required',
    );
  });

  it('rejects an empty working directory before constructing a session', () => {
    expect(() => buildRuntimeSession({ cwd: '', provider: stubProvider() })).toThrow(
      'buildRuntimeSession: cwd is required',
    );
  });

  it('rejects an empty injected-session branch before construction', () => {
    expect(() => buildRuntimeSession({ session: undefined } as never)).toThrow(
      'buildRuntimeSession: injected session is required',
    );
  });
});
