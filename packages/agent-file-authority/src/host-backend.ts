export interface IFileAuthorityTestHooks {
  readonly afterDirectoryOpened?: (segmentIndex: number) => void;
  readonly afterReadChunk?: (bytesRead: number) => void;
  readonly afterTemporaryWritten?: (temporaryName: string) => void;
  readonly afterPreCommitValidated?: () => void;
  readonly afterCommit?: () => void;
}

export interface IStableFileHostBackend {
  /** Refuse if the supplied name no longer names this retained directory object. */
  assertNamedRoot?(rootDirectory: string): void;
  readBytes(
    relativeSegments: readonly string[],
    maxBytes: number,
    hooks: IFileAuthorityTestHooks,
  ): Uint8Array | undefined;
  writeUtf8(
    relativeSegments: readonly string[],
    content: string,
    hooks: IFileAuthorityTestHooks,
  ): void;
  close(): void;
}
