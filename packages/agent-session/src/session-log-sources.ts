import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

import { resolveExternalPayloadPath } from './external-payload-file-reader.js';
import { SessionLogPayloadResolutionError } from './external-payload-resolution-contracts.js';

import type { IExternalPayloadFileState } from './external-payload-file-reader.js';

/** Workspace-neutral byte source for relative external-payload references. */
export interface IExternalPayloadSource {
  readBytes(relativePath: string): Uint8Array | undefined;
}

/** Workspace-neutral source for one session-log document and its optional payload source. */
export interface ISessionLogSource {
  readText(): string | undefined;
  readonly externalPayloadSource?: IExternalPayloadSource;
}

/** Explicit host-filesystem adapter. A file path is never accepted by the neutral parser itself. */
export class NodeExternalPayloadSource implements IExternalPayloadSource {
  private readonly state: IExternalPayloadFileState;

  constructor(baseDirectory: string) {
    this.state = {
      baseDirectory: resolve(baseDirectory),
      maxTotalBytes: Number.MAX_SAFE_INTEGER,
      totalBytes: 0,
    };
  }

  readBytes(relativePath: string): Uint8Array {
    const payloadPath = resolveExternalPayloadPath(relativePath, this.state);
    try {
      if (!statSync(payloadPath).isFile()) {
        throw new SessionLogPayloadResolutionError(
          'PAYLOAD_UNREADABLE',
          `External payload is not a regular file: ${relativePath}.`,
          { relativePath, resolvedPath: payloadPath },
        );
      }
      return new Uint8Array(readFileSync(payloadPath));
    } catch (error) {
      if (error instanceof SessionLogPayloadResolutionError) throw error;
      throw new SessionLogPayloadResolutionError(
        'PAYLOAD_UNREADABLE',
        `External payload could not be read: ${relativePath}.`,
        { relativePath, resolvedPath: payloadPath },
        error,
      );
    }
  }
}

/** Explicit host-filesystem adapter for a JSONL session log. */
export class NodeSessionLogSource implements ISessionLogSource {
  readonly externalPayloadSource: IExternalPayloadSource;

  constructor(private readonly logFile: string) {
    this.externalPayloadSource = new NodeExternalPayloadSource(dirname(logFile));
  }

  readText(): string | undefined {
    return existsSync(this.logFile) ? readFileSync(this.logFile, 'utf8') : undefined;
  }
}
