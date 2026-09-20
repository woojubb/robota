export type TStableFileAuthorityErrorCode =
  | 'INVALID_PATH'
  | 'UNSAFE_ENTRY'
  | 'UNSUPPORTED_BACKEND'
  | 'AUTHORITY_CLOSED'
  | 'ROOT_CHANGED'
  | 'FILE_CHANGED'
  | 'OVER_BUDGET'
  | 'HOST_IO';

export interface IStableFileAuthorityErrorContext {
  readonly operation: string;
  readonly segmentIndex?: number;
  readonly hostCode?: string;
}

const ERROR_MESSAGES: Readonly<Record<TStableFileAuthorityErrorCode, string>> = {
  INVALID_PATH: 'The requested root-relative file operation is invalid.',
  UNSAFE_ENTRY: 'The requested entry cannot be opened without following an unsafe object.',
  UNSUPPORTED_BACKEND: 'This host cannot provide stable root-relative file reads.',
  AUTHORITY_CLOSED: 'The stable rooted file authority is closed.',
  ROOT_CHANGED: 'The retained root identity changed during the operation.',
  FILE_CHANGED: 'The file identity or contents changed during the bounded read.',
  OVER_BUDGET: 'The file exceeds the supplied byte budget.',
  HOST_IO: 'The host could not complete the stable root-relative file operation.',
};

/** A stable, secret-free failure from a rooted file authority. */
export class StableFileAuthorityError extends Error {
  readonly code: TStableFileAuthorityErrorCode;
  readonly context: Readonly<IStableFileAuthorityErrorContext>;

  constructor(code: TStableFileAuthorityErrorCode, context: IStableFileAuthorityErrorContext) {
    super(ERROR_MESSAGES[code]);
    this.name = 'StableFileAuthorityError';
    this.code = code;
    this.context = Object.freeze({ ...context });
  }
}

/** Opaque authority for bounded regular-file reads beneath one retained directory identity. */
export interface IStableRootedFileReader {
  readBytes(relativeSegments: readonly string[], maxBytes: number): Uint8Array | undefined;
  close(): void;
  [Symbol.dispose](): void;
}

export function authorityError(
  code: TStableFileAuthorityErrorCode,
  operation: string,
  details: Omit<IStableFileAuthorityErrorContext, 'operation'> = {},
): StableFileAuthorityError {
  return new StableFileAuthorityError(code, { operation, ...details });
}

export function isStableFileAuthorityError(error: unknown): error is StableFileAuthorityError {
  return error instanceof StableFileAuthorityError;
}
