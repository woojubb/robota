/**
 * Issue #3693 — the logger no longer watches the process itself: the host that has one hands a
 * registrar in. One registrar gets one flush-everything function however many loggers use it, so a
 * process still has a single exit listener and nothing accumulates per logger.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { registerProcessExitFlush } from '../process-exit-flush.js';
import { FileSessionLogger } from '../session-logger.js';

import type { ISessionLogSink } from '../session-log-sinks.js';
import type { TRegisterExitFlush } from '../session-log-reference-types.js';

function memorySink(): ISessionLogSink & { written: string[] } {
  const written: string[] = [];
  return { written, append: (_sessionId, text) => void written.push(text) };
}

function stream(logger: FileSessionLogger, sessionId: string, text: string): void {
  logger.log(sessionId, 'text_delta', { delta: text });
}

describe('FileSessionLogger registerExitFlush', () => {
  it('hands the registrar a function that writes every logger’s buffered tail', () => {
    const registrars: Array<() => void> = [];
    const register: TRegisterExitFlush = (flush) => void registrars.push(flush);
    const first = memorySink();
    const second = memorySink();
    const a = new FileSessionLogger(first, { registerExitFlush: register });
    const b = new FileSessionLogger(second, { registerExitFlush: register });

    stream(a, 'session-a', 'tail-a');
    stream(b, 'session-b', 'tail-b');
    expect(first.written).toEqual([]);
    expect(second.written).toEqual([]);

    registrars[0]!();

    expect(first.written.join('')).toContain('tail-a');
    expect(second.written.join('')).toContain('tail-b');
  });

  it('registers once per distinct registrar, not once per logger', () => {
    const register = vi.fn();
    const other = vi.fn();

    for (let index = 0; index < 5; index += 1) {
      stream(
        new FileSessionLogger(memorySink(), { registerExitFlush: register }),
        `session-${index}`,
        'x',
      );
    }
    stream(new FileSessionLogger(memorySink(), { registerExitFlush: other }), 'session-o', 'x');

    expect(register).toHaveBeenCalledTimes(1);
    expect(other).toHaveBeenCalledTimes(1);
  });

  it('does not register before something is buffered, and never without a registrar', () => {
    const register = vi.fn();
    const logger = new FileSessionLogger(memorySink(), { registerExitFlush: register });
    logger.log('session-q', 'session_init', {});
    expect(register).not.toHaveBeenCalled();

    const bare = memorySink();
    const unregistered = new FileSessionLogger(bare);
    stream(unregistered, 'session-u', 'tail');
    expect(bare.written).toEqual([]);
    unregistered.flush();
    expect(bare.written.join('')).toContain('tail');
  });
});

describe('registerProcessExitFlush', () => {
  afterEach(() => vi.restoreAllMocks());

  it('runs the flush when the process exits', () => {
    const on = vi.spyOn(process, 'on').mockImplementation(() => process);
    const flush = vi.fn();

    registerProcessExitFlush(flush);

    expect(on).toHaveBeenCalledWith('exit', flush);
  });
});
