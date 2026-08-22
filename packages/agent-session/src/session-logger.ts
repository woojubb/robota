/**
 * Session Logger — pluggable logging interface for session events.
 *
 * ISessionLogger defines the contract. FileSessionLogger serializes JSONL through an
 * injected sink and never opens a path itself. Consumers can implement their
 * own (e.g., remote, database, silent) and inject via Session constructor.
 */

import { createLogger } from '@robota-sdk/agent-core';

import { isSafeSessionId } from './session-id.js';
import { normalizeLogData } from './session-log-payload.js';

import type { ISessionLogSink } from './session-log-sinks.js';

const logger = createLogger('FileSessionLogger');

/**
 * Events that arrive once per streamed token.
 *
 * CORE-029: `session-run.ts` logs one of these per text delta and this class answered each with a
 * blocking `appendFileSync` — a synchronous disk write per token on the streaming hot path. They are
 * buffered and written in one call; every OTHER event flushes the buffer before writing itself, so
 * ordering in the file is unchanged and no semantic event is ever delayed behind a stream.
 */
const HOT_PATH_EVENTS: ReadonlySet<string> = new Set(['text_delta']);

/** Flush the delta buffer once it reaches this size, so a long stream cannot grow without bound. */
const HOT_PATH_FLUSH_BYTES = 64 * 1024;

/**
 * Every logger with something buffered, flushed if the process exits mid-stream.
 *
 * Buffering trades a write per token for a write per batch, and the price is a window in which the
 * tail of a stream exists only in memory. A normal shutdown closes that window by itself — the
 * `session_shutdown` event is not a hot-path event, so it flushes before writing — but an abnormal
 * exit would not, and a replay log missing its last exchange is a worse defect than the one being
 * fixed. `exit` handlers may only do synchronous work, which is exactly what `flush` does.
 */
const liveLoggers = new Set<FileSessionLogger>();
let exitHookInstalled = false;

function ensureExitFlush(loggerInstance: FileSessionLogger): void {
  liveLoggers.add(loggerInstance);
  if (exitHookInstalled) return;
  if (typeof process === 'undefined' || typeof process.on !== 'function') return;
  exitHookInstalled = true;
  process.on('exit', () => {
    for (const live of liveLoggers) {
      live.flush();
    }
  });
}

/** Session log event data — extensible record of event metadata. */
export type TSessionLogValue = string | number | boolean | object | null | undefined;
export type TSessionLogData = Record<string, TSessionLogValue>;

export interface IExternalPayloadReference {
  kind: 'external-payload';
  encoding: 'json';
  sha256: string;
  byteLength: number;
  relativePath: string;
}

export interface IFileSessionLoggerOptions {
  externalPayloadThresholdBytes?: number;
  redactedValue?: string;
}

const BYTES_PER_KIB = 1024;
const DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_KIB = 32;
const DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_BYTES =
  DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_KIB * BYTES_PER_KIB;
const DEFAULT_REDACTED_VALUE = '[REDACTED]';

/**
 * Session logger interface — injected into Session for pluggable logging.
 *
 * Implementations decide where and how to persist session events.
 * The Session class calls log() for every significant action.
 */
export interface ISessionLogger {
  /** Log a session event with structured data. */
  log(sessionId: string, event: string, data: TSessionLogData): void;
  /**
   * Write out anything buffered.
   *
   * Optional because an implementation that never buffers has nothing to do. A caller that needs
   * the log to be complete on disk — session end, or a reader about to parse it — calls this.
   */
  flush?(): void;
}

/**
 * Sink-driven session logger — writes JSONL through `ISessionLogSink`.
 *
 * This is the default implementation used by the CLI.
 * Each line is a self-contained JSON object with timestamp, sessionId, event, and data.
 */
export class FileSessionLogger implements ISessionLogger {
  private readonly options: Required<IFileSessionLoggerOptions>;
  /** Buffered hot-path lines, per session file. Keyed by session id (CORE-029). */
  private readonly pending = new Map<string, string[]>();
  private pendingBytes = 0;

  constructor(
    private readonly sink: ISessionLogSink,
    options: IFileSessionLoggerOptions = {},
  ) {
    this.options = {
      externalPayloadThresholdBytes:
        options.externalPayloadThresholdBytes ?? DEFAULT_EXTERNAL_PAYLOAD_THRESHOLD_BYTES,
      redactedValue: options.redactedValue ?? DEFAULT_REDACTED_VALUE,
    };
  }

  log(sessionId: string, event: string, data: TSessionLogData): void {
    // SEC-006: `sessionId` becomes a path component below. This is a second sink on the same value the
    // session store guards, and it is reachable with a remote-supplied id via the playground resume
    // path, so it must not rely on the store having been called first. Logging must never break a
    // session, so a rejected id drops the line rather than throwing — the store raises the loud error.
    if (!isSafeSessionId(sessionId)) return;
    try {
      const normalizedData = normalizeLogData(
        sessionId,
        data,
        this.options,
        this.sink.externalPayloadSink,
      );
      const entry =
        JSON.stringify({
          timestamp: new Date().toISOString(),
          sessionId,
          event,
          ...normalizedData,
        }) + '\n';

      if (HOT_PATH_EVENTS.has(event)) {
        this.buffer(sessionId, entry);
        return;
      }

      // Any other event flushes first, so the file's order is the order the events happened in.
      this.flush();
      this.write(sessionId, entry);
    } catch (error) {
      // allow-fallback: logging must never break a session (SEC-006 states the same rule for a
      // rejected id). What changed in CORE-029 is that the failure is no longer INVISIBLE — a log
      // that silently stops writing is indistinguishable from a session that produced no events.
      this.report(sessionId, event, error);
    }
  }

  /** Write out every buffered hot-path line. Safe to call when nothing is pending. */
  flush(): void {
    if (this.pending.size === 0) {
      liveLoggers.delete(this);
      return;
    }
    const batches = [...this.pending.entries()];
    this.pending.clear();
    this.pendingBytes = 0;
    liveLoggers.delete(this);
    for (const [sessionId, lines] of batches) {
      try {
        this.write(sessionId, lines.join(''));
      } catch (error) {
        this.report(sessionId, 'flush', error);
      }
    }
  }

  private buffer(sessionId: string, entry: string): void {
    ensureExitFlush(this);
    const lines = this.pending.get(sessionId) ?? [];
    lines.push(entry);
    this.pending.set(sessionId, lines);
    this.pendingBytes += entry.length;
    // A stream that never ends must not accumulate without bound; flushing on size keeps the
    // write count proportional to bytes rather than to tokens, which is the whole point.
    if (this.pendingBytes >= HOT_PATH_FLUSH_BYTES) {
      this.flush();
    }
  }

  private write(sessionId: string, text: string): void {
    this.sink.append(sessionId, text);
  }

  private report(sessionId: string, event: string, error: unknown): void {
    logger.warn('session log write failed', {
      sessionId,
      event,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

export class SilentSessionLogger implements ISessionLogger {
  log(): void {
    // intentionally empty
  }
}
