export interface IFileAuthorityTestHooks {
  readonly afterDirectoryOpened?: (segmentIndex: number) => void;
  readonly afterReadChunk?: (bytesRead: number) => void;
}

export interface IStableFileHostBackend {
  readBytes(
    relativeSegments: readonly string[],
    maxBytes: number,
    hooks: IFileAuthorityTestHooks,
  ): Uint8Array | undefined;
  close(): void;
}
