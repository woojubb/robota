import { appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { createLogger } from '@robota-sdk/agent-core';

import type { IExternalPayloadReference } from './session-logger.js';

const logger = createLogger('NodeSessionLogSink');
const OWNER_ONLY_FILE_MODE = 0o600;
const OWNER_ONLY_DIR_MODE = 0o700;

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
      mkdirSync(logDirectory, { recursive: true, mode: OWNER_ONLY_DIR_MODE });
      this.enabled = true;
    } catch (error) {
      // allow-fallback: session logging is diagnostic and must not disable the session.
      this.enabled = false;
      logger.warn('session log directory could not be created — session logging is disabled', {
        logDirectory,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  append(sessionId: string, text: string): void {
    if (!this.enabled) return;
    appendFileSync(join(this.logDirectory, `${sessionId}.jsonl`), text, {
      mode: OWNER_ONLY_FILE_MODE,
    });
  }

  writeJson(sessionId: string, sha256: string, serialized: string): IExternalPayloadReference {
    const payloadDirectoryName = `${sessionId}.payloads`;
    const payloadFileName = `${sha256}.json`;
    const relativePath = join(payloadDirectoryName, payloadFileName);
    if (this.enabled) {
      mkdirSync(join(this.logDirectory, payloadDirectoryName), {
        recursive: true,
        mode: OWNER_ONLY_DIR_MODE,
      });
      try {
        writeFileSync(join(this.logDirectory, relativePath), serialized, {
          encoding: 'utf8',
          mode: OWNER_ONLY_FILE_MODE,
          flag: 'wx',
        });
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      }
    }
    return {
      kind: 'external-payload',
      encoding: 'json',
      sha256,
      byteLength: Buffer.byteLength(serialized),
      relativePath,
    };
  }
}
