import { afterEach, describe, expect, it } from 'vitest';

import {
  createLogger,
  getGlobalLoggerSink,
  setGlobalLogLevel,
  setGlobalLoggerSink,
  type ILogger,
} from './logger';

/**
 * CORE-029 — every diagnostic `agent-core` emits was discarded BY CONSTRUCTION.
 *
 * `createLogger(name, sink?)` fell back to `SilentLogger` when no sink was passed, no call site in
 * the repository ever passed one, and nothing could install one afterwards. So 157 `logger.*` calls
 * — including "Robota initialization failed" and every catch-and-log-only path — had no reachable
 * destination. That is not "logging was not configured"; it could not be.
 *
 * The assertions below are about REACHABILITY, which is the thing that was missing. Each fails
 * against the previous implementation: there was no `setGlobalLoggerSink` to call.
 */
function recordingSink(): { sink: ILogger; lines: string[] } {
  const lines: string[] = [];
  const push =
    (level: string) =>
    (...args: unknown[]) =>
      lines.push(`${level}:${String(args[0] ?? '')}`);
  return {
    lines,
    sink: {
      debug: push('debug'),
      info: push('info'),
      warn: push('warn'),
      error: push('error'),
      log: push('log'),
      group: push('group'),
      groupEnd: () => {},
    } as ILogger,
  };
}

describe('global logger sink (CORE-029)', () => {
  afterEach(() => {
    setGlobalLoggerSink(undefined);
    setGlobalLogLevel('warn');
  });

  it('is silent by default — a library that logs because it was imported is a different defect', () => {
    expect(getGlobalLoggerSink()).toBeUndefined();
    // Nothing to assert output against, which is the point: the default is unchanged.
    expect(() => createLogger('pkg').error('boom')).not.toThrow();
  });

  it('delivers a diagnostic to an installed sink', () => {
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    createLogger('pkg').error('Robota initialization failed');
    expect(lines.some((l) => l.includes('Robota initialization failed'))).toBe(true);
  });

  it('reaches a logger that was CREATED BEFORE the sink was installed', () => {
    // The shape that matters: module-level loggers are constructed at import time, long before a
    // host can configure anything. Freezing the sink in the constructor would lose all of them.
    const logger = createLogger('created-early');
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    logger.error('late delivery');
    expect(lines.some((l) => l.includes('late delivery'))).toBe(true);
  });

  it('an explicitly passed sink still wins over the global one', () => {
    const explicit = recordingSink();
    const global = recordingSink();
    setGlobalLoggerSink(global.sink);
    createLogger('pkg', explicit.sink).error('to the explicit one');
    expect(explicit.lines.some((l) => l.includes('to the explicit one'))).toBe(true);
    expect(global.lines).toHaveLength(0);
  });

  it('goes back to silence when the sink is removed', () => {
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    const logger = createLogger('pkg');
    logger.error('first');
    setGlobalLoggerSink(undefined);
    logger.error('second');
    expect(lines.filter((l) => l.includes('first'))).toHaveLength(1);
    expect(lines.some((l) => l.includes('second'))).toBe(false);
  });

  it('still respects the level — a sink does not turn every level on', () => {
    const { sink, lines } = recordingSink();
    setGlobalLoggerSink(sink);
    setGlobalLogLevel('error');
    const logger = createLogger('pkg');
    logger.debug('not this');
    logger.error('this one');
    expect(lines.some((l) => l.includes('not this'))).toBe(false);
    expect(lines.some((l) => l.includes('this one'))).toBe(true);
  });
});
