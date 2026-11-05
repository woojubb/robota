/**
 * When a runtime nothing certifies ends itself: it was started by a spawner for an owner, so one that
 * no spawner ever links to, or whose spawner left without certifying it, would otherwise live for
 * nobody. The rules run on the custody's events and the sessions' own activity events, with no polling.
 */
import { describe, expect, it, vi } from 'vitest';

import { armUncertifiedStop } from '../uncertified-stop.js';

import type { TCustodyEvent } from '../runtime-custody.js';

const READY_MS = 30_000;

function fakeTimers() {
  let now = 0;
  const pending = new Set<{ at: number; run: () => void }>();
  return {
    setTimer(run: () => void, ms: number) {
      const timer = { at: now + ms, run };
      pending.add(timer);
      return { clear: () => void pending.delete(timer) };
    },
    advance(ms: number) {
      now += ms;
      for (const timer of [...pending].filter((entry) => entry.at <= now)) {
        pending.delete(timer);
        timer.run();
      }
    },
    pending: () => pending.size,
  };
}

function harness() {
  const timers = fakeTimers();
  const custody = {
    certified: false,
    spawnerLinks: 0,
    seenSpawner: false,
    listeners: new Set<(event: TCustodyEvent) => void>(),
  };
  const activity = { busy: false, listeners: new Set<() => void>() };
  const stop = vi.fn();
  const arm = () =>
    armUncertifiedStop({
      custody: {
        status: () => ({ certified: custody.certified, daemon: false, restricted: false }),
        spawnerLinks: () => custody.spawnerLinks,
        hasSeenSpawner: () => custody.seenSpawner,
        onChange: (listener) => {
          custody.listeners.add(listener);
          return () => custody.listeners.delete(listener);
        },
      },
      stop,
      isBusy: () => activity.busy,
      onActivity: (listener) => {
        activity.listeners.add(listener);
        return () => activity.listeners.delete(listener);
      },
      timers,
      noSpawnerMs: READY_MS,
    });
  const emit = (event: TCustodyEvent) => {
    if (event === 'spawner-linked') { custody.spawnerLinks += 1; custody.seenSpawner = true; }
    if (event === 'spawner-dropped') custody.spawnerLinks -= 1;
    if (event === 'certified') custody.certified = true;
    for (const listener of [...custody.listeners]) listener(event);
  };
  const activityChanged = () => {
    for (const listener of [...activity.listeners]) listener();
  };
  return { timers, custody, activity, stop, arm, emit, activityChanged };
}

describe('a runtime that no spawner links to', () => {
  it('stops once the time for a spawner to link has passed', () => {
    const h = harness();
    h.arm();

    h.timers.advance(READY_MS - 1);
    expect(h.stop).not.toHaveBeenCalled();
    h.timers.advance(1);

    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('does not stop for it once a spawner has linked', () => {
    const h = harness();
    h.arm();
    h.emit('spawner-linked');

    h.timers.advance(10 * READY_MS);

    expect(h.stop).not.toHaveBeenCalled();
  });

  it('is never stopped for it once certified', () => {
    const h = harness();
    h.arm();
    h.emit('spawner-linked');
    h.emit('certified');
    h.emit('spawner-dropped');
    h.timers.advance(10 * READY_MS);

    expect(h.stop).not.toHaveBeenCalled();
    expect(h.timers.pending()).toBe(0);
  });

  it('is not stopped at all when it is already certified', () => {
    const h = harness();
    h.custody.certified = true;
    h.arm();
    h.timers.advance(10 * READY_MS);

    expect(h.stop).not.toHaveBeenCalled();
  });
});

describe('a runtime whose spawner left without certifying it', () => {
  it('stops when the last spawner left before the readiness observer was armed', () => {
    const h = harness();
    h.emit('spawner-linked');
    h.emit('spawner-dropped');

    h.arm();

    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.timers.pending()).toBe(0);
  });

  it('waits for running work when the last spawner left before the observer was armed', () => {
    const h = harness();
    h.emit('spawner-linked');
    h.emit('spawner-dropped');
    h.activity.busy = true;

    h.arm();
    expect(h.stop).not.toHaveBeenCalled();
    h.activity.busy = false;
    h.activityChanged();

    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('stops at once when nothing is running', () => {
    const h = harness();
    h.arm();
    h.emit('spawner-linked');

    h.emit('spawner-dropped');

    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('stops when the work it is running ends, and not before', () => {
    const h = harness();
    h.arm();
    h.emit('spawner-linked');
    h.activity.busy = true;

    h.emit('spawner-dropped');
    expect(h.stop).not.toHaveBeenCalled();
    h.activityChanged();
    expect(h.stop).not.toHaveBeenCalled();
    h.activity.busy = false;
    h.activityChanged();

    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.activity.listeners.size).toBe(0);
  });

  it('waits for the last spawner link, not the first to drop', () => {
    const h = harness();
    h.arm();
    h.emit('spawner-linked');
    h.emit('spawner-linked');

    h.emit('spawner-dropped');
    expect(h.stop).not.toHaveBeenCalled();
    h.emit('spawner-dropped');

    expect(h.stop).toHaveBeenCalledTimes(1);
  });

  it('keeps running when a spawner links again before the work ends', () => {
    const h = harness();
    h.arm();
    h.emit('spawner-linked');
    h.activity.busy = true;
    h.emit('spawner-dropped');

    h.emit('spawner-linked');
    h.activity.busy = false;
    h.activityChanged();

    expect(h.stop).not.toHaveBeenCalled();
  });

  it('does not stop when certification arrives while the work ends', () => {
    const h = harness();
    h.arm();
    h.emit('spawner-linked');
    h.activity.busy = true;
    h.emit('spawner-dropped');

    h.emit('certified');
    h.activity.busy = false;
    h.activityChanged();

    expect(h.stop).not.toHaveBeenCalled();
  });

  it('stops once, however many events follow, and nothing after it is disposed', () => {
    const h = harness();
    const dispose = h.arm();
    h.emit('spawner-linked');
    h.emit('spawner-dropped');
    h.emit('spawner-dropped');
    h.timers.advance(10 * READY_MS);
    dispose();

    expect(h.stop).toHaveBeenCalledTimes(1);
    expect(h.custody.listeners.size).toBe(0);
  });
});
