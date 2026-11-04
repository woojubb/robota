import { createLogger } from '@robota-sdk/agent-core';
import { assertSafeSessionId, SessionLogPayloadResolutionError } from '@robota-sdk/agent-session';
import {
  StoredLines,
  StoredPayloads,
  sessionSealingOf,
  splitStoredLines,
} from '@robota-sdk/agent-session/node';

import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import { ProjectReadLimitExceededError } from '../workspace-trust/project-reader-path.js';

import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type {
  IExternalPayloadReference,
  IExternalPayloadSink,
  IExternalPayloadSource,
  ISessionLogSink,
  ISessionLogSource,
} from '@robota-sdk/agent-session';
import type {
  ISessionStoreOptions,
  IStoredPayloadWrite,
  TStoredLine,
} from '@robota-sdk/agent-session/node';

const logger = createLogger('WorkspaceSessionLogSink');

function assertLogStorage(storage: IWorkspaceProjectStateStorage): IWorkspaceProjectStateStorage {
  const accepted = assertWorkspaceProjectStateStorage(storage);
  if (accepted.namespace !== 'session-logs') {
    throw new Error('Workspace session log I/O requires the session-logs state namespace.');
  }
  return accepted;
}

function assertPayloadReadLimit(maxBytes: number): void {
  if (!Number.isFinite(maxBytes) || !Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw new SessionLogPayloadResolutionError(
      'INVALID_LIMIT',
      'External-payload maxBytes must be a finite, non-negative safe integer.',
      { actual: String(maxBytes) },
    );
  }
}

/**
 * Authority-backed source for one project session log and its sidecar payloads. Its sealed lines and
 * payloads open bound to its session id.
 */
export class WorkspaceSessionLogSource implements ISessionLogSource, IExternalPayloadSource {
  readonly externalPayloadSource: IExternalPayloadSource = this;
  private readonly storage: IWorkspaceProjectStateStorage;
  private readonly lines: StoredLines;
  private readonly payloads: StoredPayloads;

  /**
   * @param options `sealing` (required): `{ sealer }` opens sealed lines and payloads (plain ones
   *   still read); `'plain'` meets a sealed line as one no key in this process opens.
   */
  constructor(
    storage: IWorkspaceProjectStateStorage,
    private readonly sessionId: string,
    options: ISessionStoreOptions,
  ) {
    this.storage = assertLogStorage(storage);
    assertSafeSessionId(sessionId);
    const sealing = sessionSealingOf(options);
    this.lines = new StoredLines(sealing, 'session-log-line');
    this.payloads = new StoredPayloads(sealing);
  }

  /** Strict: the plain-equivalent text, failing on the first line it cannot read. */
  readText(): string | undefined {
    const text = this.readLogText();
    return text === undefined ? undefined : this.lines.openText(text, this.sessionId);
  }

  /** Tolerant: every physical line in file order, each as this process can read it; `undefined` when there is no log. */
  readStoredLines(): readonly TStoredLine[] | undefined {
    const text = this.readLogText();
    if (text === undefined) return undefined;
    return splitStoredLines(text).map((line) => this.lines.decode(line, this.sessionId));
  }

  private readLogText(): string | undefined {
    return this.storage.readText(`${this.sessionId}.jsonl`, 'load project session log');
  }

  readBytes(relativePath: string, maxBytes: number): Uint8Array | undefined {
    assertPayloadReadLimit(maxBytes);
    const normalized = relativePath.replaceAll('\\', '/');
    if (!normalized.startsWith(`${this.sessionId}.payloads/`)) {
      throw new Error('External payload reference does not belong to this session log.');
    }
    let stored: Uint8Array | undefined;
    try {
      stored = this.storage.readBytes(
        normalized,
        'load project session log payload',
        this.payloads.rawBudget(maxBytes),
      );
    } catch (error) {
      if (!(error instanceof ProjectReadLimitExceededError)) throw error;
      throw new SessionLogPayloadResolutionError(
        'MAX_TOTAL_BYTES_EXCEEDED',
        `External payload exceeds the remaining byte budget of ${maxBytes}.`,
        { relativePath, expected: maxBytes, actual: error.actualBytes.toString() },
      );
    }
    if (stored === undefined) return undefined;
    return this.payloads.open(stored, maxBytes, this.sessionId, relativePath);
  }
}

/** Authority-backed best-effort sink for project session logs and sidecars. */
export class WorkspaceSessionLogSink implements ISessionLogSink, IExternalPayloadSink {
  readonly externalPayloadSink: IExternalPayloadSink = this;
  private readonly storage: IWorkspaceProjectStateStorage;
  private readonly lines: StoredLines;
  private readonly payloads: StoredPayloads;
  private enabled = true;

  /**
   * @param options `sealing` (required): `{ sealer }` seals every append (one sealed line per call)
   *   and every sidecar; `'plain'` writes plain lines and content-addressed sidecars.
   */
  constructor(storage: IWorkspaceProjectStateStorage, options: ISessionStoreOptions) {
    this.storage = assertLogStorage(storage);
    const sealing = sessionSealingOf(options);
    this.lines = new StoredLines(sealing, 'session-log-line');
    this.payloads = new StoredPayloads(sealing);
  }

  append(sessionId: string, text: string): void {
    if (!this.enabled) return;
    assertSafeSessionId(sessionId);
    try {
      this.storage.appendText(
        `${sessionId}.jsonl`,
        this.lines.encode(text, sessionId),
        'append project session log',
      );
    } catch (error) {
      // allow-fallback: session logging is diagnostic and must not disable the session. A sealing
      // failure lands here too, and disables the log rather than writing the line in the clear.
      this.disable(
        'session log append failed — project session logging is disabled',
        error instanceof Error ? error : String(error),
      );
    }
  }

  writeJson(sessionId: string, sha256: string, serialized: string): IExternalPayloadReference {
    return this.payloads.place(sessionId, sha256, serialized, (target) =>
      this.writePayload(target),
    );
  }

  private writePayload(target: IStoredPayloadWrite): void {
    if (!this.enabled) return;
    const purpose = 'write project session log payload';
    try {
      // A content-addressed file already there holds these exact bytes.
      if (
        target.contentAddressed &&
        this.storage.readBytes(target.relativePath, 'inspect project session log payload') !==
          undefined
      ) {
        return;
      }
      if (typeof target.data === 'string') {
        this.storage.writeText(target.relativePath, target.data, purpose);
      } else {
        this.storage.writeBytes(target.relativePath, target.data, purpose);
      }
    } catch (error) {
      // allow-fallback: externalized logging payloads are diagnostic and never stop the turn.
      this.disable(
        'session payload write failed — project session logging is disabled',
        error instanceof Error ? error : String(error),
      );
    }
  }

  private disable(message: string, error: Error | string): void {
    this.enabled = false;
    logger.warn(message, { error: error instanceof Error ? error.message : error });
  }
}
