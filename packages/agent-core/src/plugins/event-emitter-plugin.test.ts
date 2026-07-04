/**
 * CORE-021 — EventEmitterPlugin error containment (SPEC § EventEmitterPlugin Error
 * Containment). A throwing handler must never take down the process:
 * catchErrors: true (default) swallows after metrics + structured log; the buffered
 * flush timer and the maxSize-overflow flush must never float a rejecting promise.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { EventEmitterPlugin } from './event-emitter-plugin';
import { EVENT_EMITTER_EVENTS } from './event-emitter/types';

const EVENT = EVENT_EMITTER_EVENTS.TOOL_SUCCESS;

describe('EventEmitterPlugin error containment (CORE-021)', () => {
  let unhandled: unknown[];
  const onUnhandled = (reason: unknown): void => {
    unhandled.push(reason);
  };

  beforeEach(() => {
    unhandled = [];
    process.on('unhandledRejection', onUnhandled);
  });
  afterEach(() => {
    process.removeListener('unhandledRejection', onUnhandled);
  });

  it('catchErrors: true (default) — a throwing handler is swallowed, recorded, and logged', async () => {
    const plugin = new EventEmitterPlugin();
    plugin.on(EVENT, () => {
      throw new Error('handler exploded');
    });

    await expect(plugin.emit(EVENT, {})).resolves.toBeUndefined();
    expect(plugin.getStats().totalErrors).toBe(1);
    await plugin.dispose();
  });

  it('catchErrors: false — the handler error rethrows to the emitter caller', async () => {
    const plugin = new EventEmitterPlugin({ catchErrors: false });
    plugin.on(EVENT, () => {
      throw new Error('handler exploded');
    });

    await expect(plugin.emit(EVENT, {})).rejects.toThrow('handler exploded');
    expect(plugin.getStats().totalErrors).toBe(1);
    await plugin.dispose();
  });

  it('buffered flush timer never floats an unhandled rejection (process survival)', async () => {
    const plugin = new EventEmitterPlugin({
      buffer: { enabled: true, maxSize: 1000, flushInterval: 20 },
    });
    plugin.on(EVENT, () => {
      throw new Error('handler exploded in flush');
    });

    await plugin.emit(EVENT, {});
    await new Promise((resolve) => setTimeout(resolve, 80));
    await plugin.dispose();
    // one macrotask so any floating rejection would have surfaced
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
    expect(plugin.getStats().totalErrors).toBe(1);
  });

  it('maxSize-overflow flush never floats an unhandled rejection', async () => {
    const plugin = new EventEmitterPlugin({
      buffer: { enabled: true, maxSize: 1, flushInterval: 60_000 },
    });
    plugin.on(EVENT, () => {
      throw new Error('handler exploded in overflow flush');
    });

    await plugin.emit(EVENT, {});
    await new Promise((resolve) => setTimeout(resolve, 20));
    await plugin.dispose();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(unhandled).toEqual([]);
    expect(plugin.getStats().totalErrors).toBe(1);
  });
});
