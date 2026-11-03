import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger, sha256Hex, utf8ByteLength } from '@robota-sdk/agent-core';
import {
  OWNER_ONLY_FILE_MODE,
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
} from '@robota-sdk/agent-core/node';

import { assertSafeSessionId } from './session-id.js';
import { StoredLines, StoredPayloads } from './stored-append-lines.js';
import { sessionSealingOf } from './stored-session-record.js';

import type { IExternalPayloadReference } from './session-log-reference-types.js';
import type { IStoredPayloadWrite } from './stored-append-lines.js';
import type { ISessionStoreOptions } from './stored-session-record.js';

export { createSessionLogExternalPayloadReference } from './stored-append-lines.js';

const logger = createLogger('NodeSessionLogSink');

/** Workspace-neutral sink for content-addressed external JSON payloads. */
export interface IExternalPayloadSink {
  writeJson(sessionId: string, sha256: string, serialized: string): IExternalPayloadReference;
}

/** Workspace-neutral append sink for session-log bytes. */
export interface ISessionLogSink {
  append(sessionId: string, text: string): void;
  readonly externalPayloadSink?: IExternalPayloadSink;
}

/** Explicit host-filesystem sink for JSONL logs and their content-addressed sidecars. */
export class NodeSessionLogSink implements ISessionLogSink, IExternalPayloadSink {
  readonly externalPayloadSink: IExternalPayloadSink = this;
  private readonly enabled: boolean;
  private readonly lines: StoredLines;
  private readonly payloads: StoredPayloads;

  /**
   * @param options `sealing` (required): `{ sealer }` seals every append (one sealed line per call)
   *   and every sidecar; `'plain'` writes plain lines and content-addressed sidecars.
   */
  constructor(
    private readonly logDirectory: string,
    options: ISessionStoreOptions,
  ) {
    const sealing = sessionSealingOf(options);
    this.lines = new StoredLines(sealing, 'session-log-line');
    this.payloads = new StoredPayloads(sealing);
    try {
      // SEC-020: `mkdirSync(dir, { recursive: true, mode })` does NOT set the mode of a directory
      // that already exists — it returns successfully and adopts whatever is there. Measured: a log
      // directory pre-created at 0777 stayed 0777 while its records were written 0600, which means
      // another local account could not read a record but could unlink and replace one, and could
      // enumerate every session id.
      ensureOwnerOnlyDirectory(logDirectory);
      this.enabled = true;
    } catch (error) {
      // allow-fallback: session logging is diagnostic and must not disable the session. It now also
      // disables on a directory that cannot be made owner-only, which is the correct direction: no
      // log is better than a log any account can read or replace.
      this.enabled = false;
      logger.warn('session log directory could not be created — session logging is disabled', {
        logDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  append(sessionId: string, text: string): void {
    assertSafeSessionId(sessionId);
    if (!this.enabled) return;
    const path = join(this.logDirectory, `${sessionId}.jsonl`);
    // Sealed before the file is touched, so a sealing failure writes nothing at all.
    const stored = this.lines.encode(text, sessionId);
    // SEC-020: `mode` on a write applies only when the file is CREATED, so a log an older version
    // left at 0644 keeps 0644 for its whole life however many times it is appended to. Tightening
    // first is the repair path for a store written before this change.
    tightenExistingFile(path);
    appendFileSync(path, stored, { mode: OWNER_ONLY_FILE_MODE });
  }

  writeJson(sessionId: string, sha256: string, serialized: string): IExternalPayloadReference {
    return this.payloads.place(sessionId, sha256, serialized, (target) =>
      this.writePayload(sessionId, target),
    );
  }

  private writePayload(sessionId: string, target: IStoredPayloadWrite): void {
    if (!this.enabled) return;
    ensureOwnerOnlyDirectory(join(this.logDirectory, `${sessionId}.payloads`));
    const payloadPath = join(this.logDirectory, target.relativePath);
    try {
      writeFileSync(payloadPath, target.data, {
        ...(typeof target.data === 'string' ? { encoding: 'utf8' as const } : {}),
        mode: OWNER_ONLY_FILE_MODE,
        flag: 'wx',
      });
    } catch (error) {
      // A random sealed name that already exists is not this payload, so only a content-addressed
      // one may be taken as already written.
      if (!target.contentAddressed || (error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error;
      }
      // SEC-020: the payload is content-addressed, so an existing file already holds these exact
      // bytes and `wx` correctly declines to rewrite it. Its MODE is a different question — one
      // written by an older version is 0644 and nothing else would ever repair it.
      tightenExistingFile(payloadPath);
    }
  }
}
