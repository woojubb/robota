import { createLogger } from '@robota-sdk/agent-core';
import {
  assertSafeSessionId,
  createSessionLogExternalPayloadReference,
  SessionLogPayloadResolutionError,
} from '@robota-sdk/agent-session';

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

/** Authority-backed source for one project session log and its sidecar payloads. */
export class WorkspaceSessionLogSource implements ISessionLogSource, IExternalPayloadSource {
  readonly externalPayloadSource: IExternalPayloadSource = this;
  private readonly storage: IWorkspaceProjectStateStorage;

  constructor(
    storage: IWorkspaceProjectStateStorage,
    private readonly sessionId: string,
  ) {
    this.storage = assertLogStorage(storage);
    assertSafeSessionId(sessionId);
  }

  readText(): string | undefined {
    return this.storage.readText(`${this.sessionId}.jsonl`, 'load project session log');
  }

  readBytes(relativePath: string, maxBytes: number): Uint8Array | undefined {
    assertPayloadReadLimit(maxBytes);
    const normalized = relativePath.replaceAll('\\', '/');
    if (!normalized.startsWith(`${this.sessionId}.payloads/`)) {
      throw new Error('External payload reference does not belong to this session log.');
    }
    try {
      return this.storage.readBytes(normalized, 'load project session log payload', maxBytes);
    } catch (error) {
      if (!(error instanceof ProjectReadLimitExceededError)) throw error;
      throw new SessionLogPayloadResolutionError(
        'MAX_TOTAL_BYTES_EXCEEDED',
        `External payload exceeds the remaining byte budget of ${maxBytes}.`,
        { relativePath, expected: maxBytes, actual: error.actualBytes.toString() },
      );
    }
  }
}

/** Authority-backed best-effort sink for project session logs and sidecars. */
export class WorkspaceSessionLogSink implements ISessionLogSink, IExternalPayloadSink {
  readonly externalPayloadSink: IExternalPayloadSink = this;
  private readonly storage: IWorkspaceProjectStateStorage;
  private enabled = true;

  constructor(storage: IWorkspaceProjectStateStorage) {
    this.storage = assertLogStorage(storage);
  }

  append(sessionId: string, text: string): void {
    if (!this.enabled) return;
    assertSafeSessionId(sessionId);
    try {
      this.storage.appendText(`${sessionId}.jsonl`, text, 'append project session log');
    } catch (error) {
      // allow-fallback: session logging is diagnostic and must not disable the session.
      this.disable(
        'session log append failed — project session logging is disabled',
        error instanceof Error ? error : String(error),
      );
    }
  }

  writeJson(sessionId: string, sha256: string, serialized: string): IExternalPayloadReference {
    const reference = createSessionLogExternalPayloadReference(sessionId, sha256, serialized);
    if (this.enabled) {
      try {
        if (
          this.storage.readBytes(reference.relativePath, 'inspect project session log payload') ===
          undefined
        ) {
          this.storage.writeText(
            reference.relativePath,
            serialized,
            'write project session log payload',
          );
        }
      } catch (error) {
        // allow-fallback: externalized logging payloads are diagnostic and never stop the turn.
        this.disable(
          'session payload write failed — project session logging is disabled',
          error instanceof Error ? error : String(error),
        );
      }
    }
    return reference;
  }

  private disable(message: string, error: Error | string): void {
    this.enabled = false;
    logger.warn(message, { error: error instanceof Error ? error.message : error });
  }
}
