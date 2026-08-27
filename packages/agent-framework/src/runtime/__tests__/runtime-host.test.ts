/**
 * RUNTIME-001 TC-01 — the shared runtime host builds the session, owns the transport lifecycle
 * (startAll on start, stopAll on shutdown), and shuts down idempotently. Presentation-free: this test
 * imports no `agent-transport-tui`/ink.
 */

import { createHook } from 'node:async_hooks';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { homedir, tmpdir } from 'node:os';
import { join } from 'node:path';

import { createDefaultUserSettingsSources } from '../../config/settings-source.js';
import { InteractiveSession } from '../../interactive/interactive-session.js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { startRuntimeHost } from '../runtime-host.js';
import { createTransportFailedOutcome } from '@robota-sdk/agent-interface-transport';

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ITransportLifecycleRegistryView } from '@robota-sdk/agent-interface-transport';
import type { IInteractiveSession } from '@robota-sdk/agent-interface-session';

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

function stubRegistry(): ITransportLifecycleRegistryView<IInteractiveSession> & {
  startAll: ReturnType<typeof vi.fn>;
  stopAll: ReturnType<typeof vi.fn>;
} {
  return {
    register: vi.fn(),
    startAll: vi.fn(async () => undefined),
    waitForCompletion: vi.fn(async () => []),
    waitForFailure: vi.fn(async () => undefined),
    stopAll: vi.fn(async () => ({ errors: [] })),
  } as ITransportLifecycleRegistryView<IInteractiveSession> & {
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
    cwd = mkdtempSync(join(tmpdir(), 'runtime-host-'));
    // Contained — TEST-012. The session's default initialisation reads the real user home
    // (`createDefaultUserSettingsSources()` → `process.env.HOME`, `homedir()` for plugins) with no
    // seam, so on a machine whose ~/.claude/settings.json defines a SessionStart command hook the
    // host fires that hook — and its timeout timer — during the very lifetime the #1852 case
    // measures (issue #2383). Pointing HOME at an empty directory per test makes the assertion
    // below mean "the host leaked a timer" on any machine; the class remedy (a global isolation or
    // a userHome seam) is TEST-012's. `USERPROFILE` is the Windows spelling of the same default.
    homeRoot = mkdtempSync(join(tmpdir(), 'runtime-host-home-'));
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

  it('builds the InteractiveSession and calls transportRegistry.startAll with it', async () => {
    const registry = stubRegistry();
    const host = await startRuntimeHost({
      session: { cwd, provider: stubProvider() },
      transportRegistry: registry,
    });

    expect(host.session).toBeInstanceOf(InteractiveSession);
    expect(registry.startAll).toHaveBeenCalledTimes(1);
    expect(registry.startAll).toHaveBeenCalledWith(host.session);

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

  it("reads settings and plugins from the isolated home, not the developer's (TEST-012 control)", () => {
    // The isolation above is a condition of the #1852 case's meaning, so it is checked against the
    // two things the session actually calls. `homedir()` follows `process.env.HOME` only in a forked
    // worker (vitest.shared.ts sets `pool: 'forks'`); a pool change to threads would leave
    // `createDefaultUserSettingsSources()` isolated and `homedir()` reading the real home — this
    // case is what makes that loud.
    for (const source of createDefaultUserSettingsSources()) {
      expect(source.path.startsWith(home), source.path).toBe(true);
    }
    expect(homedir()).toBe(home);

    restoreHome();
    expect(homedir()).not.toBe(home);
    for (const source of createDefaultUserSettingsSources()) {
      expect(source.path.startsWith(home), source.path).toBe(false);
    }
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
    expect(host.session).toBeInstanceOf(InteractiveSession);
    await expect(host.shutdown()).resolves.toBeUndefined();
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
