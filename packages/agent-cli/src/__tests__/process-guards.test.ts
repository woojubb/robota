/**
 * ERR-001 G1 — TUI process survival boundary: unhandled rejections and uncaught
 * exceptions route into the live session instead of killing the process; without a
 * live channel they fall back to stderr; headless mode (guards not installed) keeps
 * bin.ts fail-fast semantics via areTuiProcessGuardsActive().
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  areTuiProcessGuardsActive,
  classifyUncaughtException,
  installTuiProcessGuards,
  setLiveChannel,
} from '../process-guards.js';

function listenerCount(event: 'unhandledRejection' | 'uncaughtException'): number {
  return process.listeners(event as 'uncaughtException').length;
}

describe('process guards (ERR-001 G1)', () => {
  const baseRejection = listenerCount('unhandledRejection');
  const baseException = listenerCount('uncaughtException');
  let stderrSpy: ReturnType<typeof vi.fn>;
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrSpy = vi.fn().mockReturnValue(true);
    originalWrite = process.stderr.write.bind(process.stderr);
    process.stderr.write = stderrSpy as unknown as typeof process.stderr.write;
  });
  afterEach(() => {
    process.stderr.write = originalWrite;
  });

  it('is inactive until installed (headless keeps fail-fast)', () => {
    expect(areTuiProcessGuardsActive()).toBe(false);
  });

  it('installs both handlers exactly once (idempotent)', () => {
    installTuiProcessGuards();
    installTuiProcessGuards();

    expect(areTuiProcessGuardsActive()).toBe(true);
    expect(listenerCount('unhandledRejection')).toBe(baseRejection + 1);
    expect(listenerCount('uncaughtException')).toBe(baseException + 1);
  });

  it('routes an unhandled rejection into the live session and keeps the process alive', () => {
    installTuiProcessGuards();
    const reportBackgroundError = vi.fn();
    setLiveChannel({ getSession: () => ({ reportBackgroundError }) });

    const handler = process.listeners('unhandledRejection').slice(-1)[0] as (
      reason: unknown,
    ) => void;
    handler(new Error('socket hang up'));

    expect(reportBackgroundError).toHaveBeenCalledTimes(1);
    expect((reportBackgroundError.mock.calls[0][0] as Error).message).toBe('socket hang up');
    expect(reportBackgroundError.mock.calls[0][1]).toBe('unhandled rejection');
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('falls back to stderr when routing into the session itself fails (last resort)', () => {
    installTuiProcessGuards();
    setLiveChannel({
      getSession: () => ({
        reportBackgroundError: () => {
          throw new Error('render broken');
        },
      }),
    });

    const handler = process.listeners('uncaughtException').slice(-1)[0] as (err: unknown) => void;
    handler(new Error('boom'));

    expect(stderrSpy).toHaveBeenCalled();
    expect(String(stderrSpy.mock.calls[0][0])).toContain('uncaught exception: boom');
  });
});

/**
 * CORE-020 (RUNTIME-34) — the IME crash-swallow heuristic must be scoped to interactive
 * TUI mode. Previously any error whose message contained 'slice'/'charCodeAt' was
 * swallowed BEFORE the guard check, masking real crashes in headless mode.
 */
describe('classifyUncaughtException (CORE-020)', () => {
  it('headless (guards inactive): every error rethrows — including IME-looking ones', () => {
    expect(classifyUncaughtException(new Error('Cannot read slice of undefined'), false)).toBe(
      'rethrow',
    );
    expect(classifyUncaughtException(new Error('x.charCodeAt is not a function'), false)).toBe(
      'rethrow',
    );
    expect(classifyUncaughtException(new Error('string-width overflow'), false)).toBe('rethrow');
    expect(classifyUncaughtException(new Error('ENOENT: no such file'), false)).toBe('rethrow');
  });

  it('interactive (guards active): IME-signature errors get the hint, others are guard-owned', () => {
    expect(classifyUncaughtException(new Error('string-width overflow'), true)).toBe('ime-hint');
    expect(classifyUncaughtException(new Error('setCursorPosition failed'), true)).toBe('ime-hint');
    expect(classifyUncaughtException(new Error('bad slice input'), true)).toBe('ime-hint');
    expect(classifyUncaughtException(new Error('socket hang up'), true)).toBe('guard-owned');
  });

  it('handles errors without a message', () => {
    const bare = new Error();
    expect(classifyUncaughtException(bare, false)).toBe('rethrow');
    expect(classifyUncaughtException(bare, true)).toBe('guard-owned');
  });
});
