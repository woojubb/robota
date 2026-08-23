import type { IExternalPayloadSource } from './session-log-sources.js';

export type TSessionLogPayloadResolutionErrorCode =
  | 'INVALID_LIMIT'
  | 'INVALID_REFERENCE'
  | 'UNRESOLVED_REFERENCE'
  | 'OUTSIDE_ROOT'
  | 'PAYLOAD_NOT_FOUND'
  | 'PAYLOAD_UNREADABLE'
  | 'BYTE_LENGTH_MISMATCH'
  | 'SHA256_MISMATCH'
  | 'INVALID_JSON'
  | 'MAX_DEPTH_EXCEEDED'
  | 'MAX_TOTAL_BYTES_EXCEEDED'
  | 'CIRCULAR_REFERENCE';

export interface ISessionLogPayloadResolutionOptions {
  readonly source?: IExternalPayloadSource;
  readonly maxDepth?: number;
  readonly maxTotalBytes?: number;
}

export interface ISessionLogPayloadResolutionErrorMetadata {
  readonly relativePath?: string;
  readonly resolvedPath?: string;
  readonly depth?: number;
  readonly expected?: string | number;
  readonly actual?: string | number;
}

export class SessionLogPayloadResolutionError extends Error {
  readonly code: TSessionLogPayloadResolutionErrorCode;
  readonly metadata: Readonly<ISessionLogPayloadResolutionErrorMetadata>;

  constructor(
    code: TSessionLogPayloadResolutionErrorCode,
    message: string,
    metadata: ISessionLogPayloadResolutionErrorMetadata = {},
    cause?: unknown,
  ) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'SessionLogPayloadResolutionError';
    this.code = code;
    this.metadata = metadata;
  }
}
