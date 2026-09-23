/**
 * CORE-029 — the streaming hot path, and the writes that used to disappear.
 *
 * `session-run.ts` logs a `text_delta` event per streamed token, and this logger answered each with
 * a blocking `appendFileSync` — one synchronous disk write, with its own open and close, per token.
 * A failure was then swallowed by a bare `catch {}`, so a log that silently stopped writing was
 * indistinguishable from a session that produced no events. Both halves are asserted here: the
 * write count, and that a failed write is reported somewhere a host can see it.
 */

import { setGlobalLoggerSink, type ILogger } from '@robota-sdk/agent-core';
import { mkdtempSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { FileSessionLogger } from '../session-logger.js';
import { NodeSessionLogSink } from '../session-log-sinks.js';

// `node:fs` exports cannot be spied on in ESM, so the module is wrapped instead. The wrapper
// COUNTS calls and can be made to fail on demand — the two things these cases need to observe.
const fsControl = vi.hoisted(() => ({
  appendCalls: [] as string[],
  failAppend: null as Error | null,
  failMkdir: null as Error | null,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    appendFileSync: ((file: string, data: string, options: unknown) => {
      fsControl.appendCalls.push(String(data));
      if (fsControl.failAppend) throw fsControl.failAppend;
      return actual.appendFileSync(
        file,
        data,
        options as Parameters<typeof actual.appendFileSync>[2],
      );
    }) as typeof actual.appendFileSync,
    mkdirSync: ((dir: string, options: unknown) => {
      if (fsControl.failMkdir) throw fsControl.failMkdir;
      return actual.mkdirSync(dir, options as Parameters<typeof actual.mkdirSync>[1]);
    }) as typeof actual.mkdirSync,
  };
});

const SESSION = 'session-hot-path';

function readLines(logDir: string): Array<Record<string, unknown>> {
  const text = readFileSync(join(logDir, `${SESSION}.jsonl`), 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as Record<string, unknown>);
}

describe('FileSessionLogger hot path (CORE-029)', () => {
  let logDir: string;

  beforeEach(() => {
    logDir = realpathSync(mkdtempSync(join(tmpdir(), 'session-log-')));
    fsControl.appendCalls.length = 0;
    fsControl.failAppend = null;
    fsControl.failMkdir = null;
  });

  afterEach(() => {
    setGlobalLoggerSink(undefined);
    rmSync(logDir, { recursive: true, force: true });
  });

  it('does not write to disk once per streamed token', () => {
    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir));

    for (let i = 0; i < 200; i++) {
      logger.log(SESSION, 'text_delta', { delta: `token-${i} ` });
    }

    // The number that matters: 200 tokens must not be 200 synchronous writes. Before this change it
    // was exactly one per token, on the path a user watches a response stream on.
    expect(fsControl.appendCalls.length).toBeLessThan(200);
    logger.flush();
    expect(readLines(logDir)).toHaveLength(200);
  });

  it('keeps the file in the order the events happened', () => {
    // Buffering must not reorder: a semantic event flushes the stream ahead of itself, so a reader
    // still sees deltas before the assistant message they belong to.
    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir));

    logger.log(SESSION, 'user', { content: 'hi' });
    logger.log(SESSION, 'text_delta', { delta: 'one ' });
    logger.log(SESSION, 'text_delta', { delta: 'two' });
    logger.log(SESSION, 'assistant', { content: 'one two' });

    expect(readLines(logDir).map((entry) => entry['event'])).toEqual([
      'user',
      'text_delta',
      'text_delta',
      'assistant',
    ]);
  });

  it('a semantic event is durable immediately, without waiting for a flush', () => {
    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir));
    logger.log(SESSION, 'session_shutdown', { reason: 'done' });

    expect(readLines(logDir).map((entry) => entry['event'])).toEqual(['session_shutdown']);
  });

  it('reports a failed write instead of swallowing it', () => {
    // The `catch {}` meant a full disk, a permissions change or a deleted directory produced exactly
    // the same observation as a quiet session: nothing. The write still must not throw — a session
    // is not failed by its log — but it must be sayable.
    const seen: Array<{ message: unknown; context: unknown }> = [];
    const sink: ILogger = {
      debug: () => undefined,
      info: () => undefined,
      warn: (message, context) => seen.push({ message, context }),
      error: () => undefined,
      log: () => undefined,
    };
    setGlobalLoggerSink(sink);

    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir));
    fsControl.failAppend = new Error('ENOSPC: no space left on device');
    expect(() => logger.log(SESSION, 'user', { content: 'hi' })).not.toThrow();

    expect(seen).toHaveLength(1);
    expect(String(seen[0]?.message)).toMatch(/session log write failed/);
    expect(JSON.stringify(seen[0]?.context)).toMatch(/ENOSPC/);
  });

  it('reports a failed flush of buffered deltas too', () => {
    const seen: string[] = [];
    setGlobalLoggerSink({
      debug: () => undefined,
      info: () => undefined,
      warn: (message) => seen.push(String(message)),
      error: () => undefined,
      log: () => undefined,
    });

    const logger = new FileSessionLogger(new NodeSessionLogSink(logDir));
    logger.log(SESSION, 'text_delta', { delta: 'buffered' });

    fsControl.failAppend = new Error('EACCES: permission denied');

    expect(() => logger.flush()).not.toThrow();
    expect(seen.join(' ')).toMatch(/session log write failed/);
  });

  it('says so when the log directory cannot be created', () => {
    // "No log file" and "logging was never attempted" were the same observation.
    const seen: string[] = [];
    setGlobalLoggerSink({
      debug: () => undefined,
      info: () => undefined,
      warn: (message) => seen.push(String(message)),
      error: () => undefined,
      log: () => undefined,
    });

    fsControl.failMkdir = new Error('EROFS: read-only file system');

    new FileSessionLogger(new NodeSessionLogSink(join(logDir, 'nested')));

    expect(seen.join(' ')).toMatch(/session log directory could not be created/);
  });
});
