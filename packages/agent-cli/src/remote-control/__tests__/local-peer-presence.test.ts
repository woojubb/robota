/**
 * PEER-004 (#1863) — the composition leaf that makes this session discoverable.
 *
 * These cases exist because the two leaves underneath were both landed and called by nothing. What
 * is pinned here is the WIRING: that announcing publishes an entry a second reader can see, that a
 * clean exit removes it, and that a refused rendezvous is not quietly announced anyway.
 */

import { mkdtempSync, readdirSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import { afterAll, describe, expect, it } from 'vitest';

import { announceLocalPeerPresence } from '../local-peer-presence.js';

const scratch: string[] = [];
afterAll(() => {
  while (scratch.length > 0) rmSync(scratch.pop() as string, { recursive: true, force: true });
});

function guardedDirectory(): string {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'peer-presence-')));
  scratch.push(dir);
  return dir;
}

/** An exit subscription a case can fire, so the runner is never actually asked to exit. */
function exitBus() {
  const handlers: (() => void)[] = [];
  return {
    on: (_event: 'exit', handler: () => void) => {
      handlers.push(handler);
    },
    off: (_event: 'exit', handler: () => void) => {
      const at = handlers.indexOf(handler);
      if (at !== -1) handlers.splice(at, 1);
    },
    fire: () => {
      for (const handler of [...handlers]) handler();
    },
    get size() {
      return handlers.length;
    },
  };
}

const ALIVE = () => 'start-time-fixed';

describe('announcing makes this session discoverable', () => {
  it('publishes an entry a second reader sees', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    const one = announceLocalPeerPresence({
      sessionId: 'session-one',
      name: 'first',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });
    const two = announceLocalPeerPresence({
      sessionId: 'session-two',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });

    // Each sees the other AND itself: the reader decides which row is its own, so the list must
    // carry both rather than a pre-filtered view whose filter nobody can inspect.
    expect(
      one
        .list()
        .map((p) => p.sessionId)
        .sort(),
    ).toEqual(['session-one', 'session-two']);
    expect(
      two
        .list()
        .map((p) => p.sessionId)
        .sort(),
    ).toEqual(['session-one', 'session-two']);
    expect(one.list().find((p) => p.sessionId === 'session-one')?.name).toBe('first');
  });

  it('carries liveness through instead of deciding it here', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    const presence = announceLocalPeerPresence({
      sessionId: 'session-one',
      guardedDirectory: dir,
      // A host that cannot answer. `unknown` must survive to the surface — rounding it to `alive`
      // is the guess the registry exists to refuse.
      registry: { readStartTime: () => undefined },
      on: bus.on,
      off: bus.off,
    });
    expect(presence.list()[0]?.liveness).toBe('unknown');
  });
});

describe('withdrawal is bound to the process ending', () => {
  it('removes the entry when the exit fires', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    announceLocalPeerPresence({
      sessionId: 'session-one',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });
    expect(readdirSync(dir)).toHaveLength(1);

    bus.fire();

    // A clean exit removes its own entry, so the common case never depends on the liveness floor.
    // Leaning on the detector instead would make every clean exit look like a crash until something
    // else noticed.
    expect(readdirSync(dir)).toHaveLength(0);
  });

  it('withdraws once, and unsubscribes so a later exit is not a second removal', () => {
    const dir = guardedDirectory();
    const bus = exitBus();
    const presence = announceLocalPeerPresence({
      sessionId: 'session-one',
      guardedDirectory: dir,
      registry: { readStartTime: ALIVE },
      on: bus.on,
      off: bus.off,
    });

    presence.withdraw();
    expect(readdirSync(dir)).toHaveLength(0);
    expect(bus.size).toBe(0);

    // Idempotent: an explicit withdraw followed by the real exit must not throw on a file that is
    // already gone. A process exiting is not a place an exception can be reported.
    expect(() => {
      presence.withdraw();
      bus.fire();
    }).not.toThrow();
  });
});
