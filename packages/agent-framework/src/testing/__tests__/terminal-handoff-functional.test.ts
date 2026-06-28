/**
 * Terminal handoff — framework functional test (TERM-001).
 *
 * Drives the handoff ORCHESTRATION through a REAL InteractiveSession (scripted provider, no CLI): a
 * transport-provided `ITerminalHandoff` capability is injected; the session surfaces `runWithTerminal`
 * on its host context, enforces exclusivity, and fast-fails when no interactive terminal is available.
 * The framework never spawns a child itself — the caller's `fn` runs whatever it wants.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

import type { ITerminalHandoff } from '@robota-sdk/agent-interface-transport';

const TEST_TIMEOUT = 20_000;

/** A fake transport handoff capability: records suspend/resume around `fn`. */
function fakeHandoff(canHandoff: boolean): ITerminalHandoff & { readonly events: string[] } {
  const events: string[] = [];
  return {
    events,
    canHandoffTerminal: canHandoff,
    async runWithTerminal<T>(fn: () => Promise<T>): Promise<T> {
      events.push('suspend');
      try {
        return await fn();
      } finally {
        events.push('restore');
      }
    },
  };
}

let h: ScriptedSessionHarness | undefined;
afterEach(async () => {
  await h?.dispose();
  h = undefined;
});

describe('terminal handoff (framework functional)', () => {
  it(
    'runs the caller fn between transport suspend/restore and reports canHandoffTerminal',
    async () => {
      const handoff = fakeHandoff(true);
      h = scriptedSession({ turns: [{ text: 'unused' }], terminalHandoff: handoff });

      expect(h.session.canHandoffTerminal()).toBe(true);

      const order: string[] = [];
      const result = await h.session.runWithTerminal(async () => {
        order.push('child-ran');
        return 42;
      });

      expect(result).toBe(42);
      // The transport suspended, the caller's fn ran, then the transport restored.
      expect(handoff.events).toEqual(['suspend', 'restore']);
      expect(order).toEqual(['child-ran']);
    },
    TEST_TIMEOUT,
  );

  it(
    'restores the display even when the caller fn throws',
    async () => {
      const handoff = fakeHandoff(true);
      h = scriptedSession({ turns: [{ text: 'unused' }], terminalHandoff: handoff });

      await expect(
        h.session.runWithTerminal(async () => {
          throw new Error('child failed');
        }),
      ).rejects.toThrow('child failed');

      expect(handoff.events).toEqual(['suspend', 'restore']);
    },
    TEST_TIMEOUT,
  );

  it(
    'is exclusive: a second handoff while one is in flight is rejected',
    async () => {
      const handoff = fakeHandoff(true);
      h = scriptedSession({ turns: [{ text: 'unused' }], terminalHandoff: handoff });

      let release!: () => void;
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const first = h.session.runWithTerminal(async () => {
        await gate;
        return 'first';
      });

      await expect(h.session.runWithTerminal(async () => 'second')).rejects.toThrow(
        /already in progress/,
      );

      release();
      expect(await first).toBe('first');
    },
    TEST_TIMEOUT,
  );

  it(
    'fast-fails (does not hang) when no interactive terminal is available',
    async () => {
      // No terminalHandoff injected → headless-like: canHandoffTerminal is false.
      h = scriptedSession({ turns: [{ text: 'unused' }] });
      expect(h.session.canHandoffTerminal()).toBe(false);
      await expect(h.session.runWithTerminal(async () => 'x')).rejects.toThrow(/unavailable/);
    },
    TEST_TIMEOUT,
  );

  it(
    'reports canHandoffTerminal=false when the transport cannot hand off, and rejects',
    async () => {
      const handoff = fakeHandoff(false);
      h = scriptedSession({ turns: [{ text: 'unused' }], terminalHandoff: handoff });
      expect(h.session.canHandoffTerminal()).toBe(false);
      await expect(h.session.runWithTerminal(async () => 'x')).rejects.toThrow(/unavailable/);
      // The transport was never asked to suspend.
      expect(handoff.events).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
