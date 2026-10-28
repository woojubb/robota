export interface IFileAuthorityTestHooks {
  readonly afterDirectoryOpened?: (segmentIndex: number) => void;
  readonly afterReadChunk?: (bytesRead: number) => void;
  readonly afterTemporaryWritten?: (temporaryName: string) => void;
  readonly afterPreCommitValidated?: () => void;
}

export interface IStableFileHostBackend {
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
