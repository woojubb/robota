import { createHash } from 'node:crypto';
import { appendFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '@robota-sdk/agent-core';
import {
  OWNER_ONLY_FILE_MODE,
  ensureOwnerOnlyDirectory,
  tightenExistingFile,
} from '@robota-sdk/agent-core/node';

import { assertSafeSessionId } from './session-id.js';

import type { IExternalPayloadReference } from './session-logger.js';

const logger = createLogger('NodeSessionLogSink');
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

function assertContentAddress(sha256: string, serialized: string): void {
  const actualSha256 = createHash('sha256').update(serialized).digest('hex');
  if (!SHA256_PATTERN.test(sha256) || sha256 !== actualSha256) {
    throw new Error('Invalid sha256: external JSON payloads require their exact content digest.');
  }
}

/** Canonical validation and construction for every session-log external-payload reference. */
export function createSessionLogExternalPayloadReference(
  sessionId: string,
  sha256: string,
  serialized: string,
): IExternalPayloadReference {
  assertSafeSessionId(sessionId);
  assertContentAddress(sha256, serialized);
  return {
    kind: 'external-payload',
    encoding: 'json',
    sha256,
    byteLength: Buffer.byteLength(serialized),
    relativePath: join(`${sessionId}.payloads`, `${sha256}.json`),
  };
}

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

  constructor(private readonly logDirectory: string) {
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
    // SEC-020: `mode` on a write applies only when the file is CREATED, so a log an older version
    // left at 0644 keeps 0644 for its whole life however many times it is appended to. Tightening
    // first is the repair path for a store written before this change.
    tightenExistingFile(path);
    appendFileSync(path, text, { mode: OWNER_ONLY_FILE_MODE });
  }

  writeJson(sessionId: string, sha256: string, serialized: string): IExternalPayloadReference {
    const reference = createSessionLogExternalPayloadReference(sessionId, sha256, serialized);
    const payloadDirectoryName = `${sessionId}.payloads`;
    if (this.enabled) {
      ensureOwnerOnlyDirectory(join(this.logDirectory, payloadDirectoryName));
      const payloadPath = join(this.logDirectory, reference.relativePath);
      try {
        writeFileSync(payloadPath, serialized, {
          encoding: 'utf8',
          mode: OWNER_ONLY_FILE_MODE,
          flag: 'wx',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
        // SEC-020: the payload is content-addressed, so an existing file already holds these exact
        // bytes and `wx` correctly declines to rewrite it. Its MODE is a different question — one
        // written by an older version is 0644 and nothing else would ever repair it.
        tightenExistingFile(payloadPath);
      }
    }
    return reference;
  }
}
