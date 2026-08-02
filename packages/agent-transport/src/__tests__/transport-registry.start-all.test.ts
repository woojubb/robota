import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { createTestInteractiveSession } from '@robota-sdk/agent-interface-transport/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { TransportRegistry } from '../transport-registry.js';

import type {
  IConfigurableTransport,
  IInteractiveSession,
} from '@robota-sdk/agent-interface-transport';

/**
 * ARCH-011 — `start()` did not mean the same thing in every transport, and `startAll` awaited each
 * one in turn.
 *
 * Four transports treat `start()` as BIND: attach to a port, return, keep serving. Two treat it as
 * RUN TO COMPLETION — `headless-transport.ts` runs the whole prompt inside it, and
 * `tui-transport.ts` blocks for the life of the UI. `startAll` awaited them sequentially, so
 * registering either one first meant every transport behind it never started at all. Not a crash, not
 * an error: they were simply never reached, and nothing said so.
 *
 * The contract said only `start(): Promise<void>`, which is why two readings of it could coexist for
 * as long as they did. It says which one it means now, and a transport that runs to completion
 * declares itself so the registry can start it without blocking the rest.
 */
function bindingTransport(
  name: string,
  started: string[],
): IConfigurableTransport<IInteractiveSession> {
  return {
    name,
    defaultEnabled: true,
    attach: vi.fn(),
    start: async () => {
      started.push(name);
    },
    stop: async () => {},
  };
}

/** The shape `headless` and `tui` have: `start()` does not return while the transport is alive. */
function blockingTransport(
  name: string,
  started: string[],
): IConfigurableTransport<IInteractiveSession> & { release: () => void } {
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  return {
    name,
    defaultEnabled: true,
    release,
    attach: vi.fn(),
    start: async () => {
      started.push(name);
      await held;
    },
    stop: async () => {},
    // ARCH-011: the declaration that makes the difference visible to the registry.
    runsToCompletion: true,
  };
}

/** A registry over a real, empty settings file — `/dev/null` is not valid JSON. */
function registryOverTempSettings(): TransportRegistry {
  const dir = mkdtempSync(path.join(tmpdir(), 'transport-registry-'));
  const file = path.join(dir, 'settings.json');
  writeFileSync(file, '{}');
  tempDirs.push(dir);
  return new TransportRegistry(file);
}

const tempDirs: string[] = [];

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

/** Settle or report that it did not — never hang the suite to make a point about hanging. */
async function within<T>(promise: Promise<T>, ms = 250): Promise<'settled' | 'pending'> {
  let timer: ReturnType<typeof setTimeout>;
  const pending = new Promise<'pending'>((resolve) => {
    timer = setTimeout(() => resolve('pending'), ms);
  });
  try {
    return await Promise.race([promise.then(() => 'settled' as const), pending]);
  } finally {
    clearTimeout(timer!);
  }
}

describe('startAll starts every transport (ARCH-011)', () => {
  it('a transport whose start() runs to completion does not block the ones behind it', async () => {
    const started: string[] = [];
    const registry = registryOverTempSettings();
    const blocking = blockingTransport('headless', started);
    registry.register(blocking);
    registry.register(bindingTransport('http', started));

    const outcome = await within(registry.startAll(createTestInteractiveSession()));

    // Against the defect this is `'pending'`, and `started` is `['headless']` — the HTTP transport
    // was never reached.
    expect(outcome).toBe('settled');
    expect(started).toEqual(['headless', 'http']);

    blocking.release();
  });

  it('still starts a purely binding set in order, and awaits each', async () => {
    const started: string[] = [];
    const registry = registryOverTempSettings();
    registry.register(bindingTransport('http', started));
    registry.register(bindingTransport('ws', started));

    expect(await within(registry.startAll(createTestInteractiveSession()))).toBe('settled');
    expect(started).toEqual(['http', 'ws']);
  });

  it('surfaces a run-to-completion transport that FAILS, rather than losing it', async () => {
    // Not awaiting it must not mean not watching it. A transport whose whole job happens inside
    // `start()` is exactly the one whose failure matters, and an unawaited rejection would be an
    // unhandled promise rather than a reported error.
    const registry = registryOverTempSettings();
    const failing: IConfigurableTransport<IInteractiveSession> = {
      name: 'headless',
      defaultEnabled: true,
      attach: vi.fn(),
      start: async () => {
        throw new Error('prompt failed');
      },
      stop: async () => {},
      runsToCompletion: true,
    };
    registry.register(failing);

    await registry.startAll(createTestInteractiveSession());

    await expect(registry.waitForCompletion()).rejects.toThrow(/prompt failed/);
  });

  it('holds a failure across a MACROTASK — the shape a real consumer has', async () => {
    // The window the first draft left open. Storing the promise is not attaching a handler: a
    // rejection between `startAll` returning and the caller reaching `waitForCompletion` was an
    // unhandled rejection, which on Node ≥15 aborts the process. Review measured exit code 1, with
    // `startAll` having already resolved OK. The previous case awaited the two back to back and so
    // never left the microtask drain, which is exactly why it did not catch this.
    const registry = registryOverTempSettings();
    registry.register({
      name: 'headless',
      defaultEnabled: true,
      attach: vi.fn(),
      start: async () => {
        throw new Error('prompt failed');
      },
      stop: async () => {},
      runsToCompletion: true,
    });

    await registry.startAll(createTestInteractiveSession());
    await new Promise((resolve) => setTimeout(resolve, 20));

    await expect(registry.waitForCompletion()).rejects.toThrow(/prompt failed/);
  });

  it('a stopped registry does not wait on work nobody will finish', async () => {
    // `stop()` is a documented no-op for both run-to-completion transports, so awaiting them after
    // `stopAll` would hang forever. Abandoning them is what makes `stopAll`'s bounded, best-effort
    // contract honest — and it is what lets a session switch start from empty rather than
    // overwriting a promise that then has no handler.
    const started: string[] = [];
    const registry = registryOverTempSettings();
    const blocking = blockingTransport('tui', started);
    registry.register(blocking);

    await registry.startAll(createTestInteractiveSession());
    await registry.stopAll();

    expect(await within(registry.waitForCompletion())).toBe('settled');
    blocking.release();
  });

  it('a failure that arrives AFTER a stop does not leak into the next session', async () => {
    // The handler attached to an in-flight `start()` cannot be detached, so it fires after the stop.
    // Emptying the failure array in place left that write landing in the same instance the NEXT
    // session read, and a failure from a stopped session was thrown as if it belonged to the current
    // one — contradicting "a later startAll starts from empty". A session switch is exactly this
    // shape, and the earlier stop case only exercised the resolve path.
    const registry = registryOverTempSettings();
    let failFirst!: (error: Error) => void;
    let run = 0;
    registry.register({
      name: 'headless',
      defaultEnabled: true,
      attach: vi.fn(),
      // A fresh promise per start, as a real transport gives: the FIRST session's fails, the second
      // is healthy. Returning one shared promise would make the second session fail on its own
      // account and prove nothing about leakage.
      start: () => {
        run += 1;
        return run === 1
          ? new Promise<void>((_resolve, reject) => {
              failFirst = reject;
            })
          : Promise.resolve();
      },
      stop: async () => {},
      runsToCompletion: true,
    });

    await registry.startAll(createTestInteractiveSession());
    await registry.stopAll();

    // The stopped session's transport fails only now.
    failFirst(new Error('previous session died'));
    await new Promise((resolve) => setTimeout(resolve, 20));

    // A new session starts on the same registry, and finishes cleanly.
    await registry.startAll(createTestInteractiveSession());
    await expect(registry.waitForCompletion()).resolves.toBeUndefined();
  });
});
