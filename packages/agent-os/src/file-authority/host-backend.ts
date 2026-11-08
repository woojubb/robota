import type { IStableRootedDirectoryEntry } from './contracts.js';

export interface IFileAuthorityTestHooks {
  readonly afterDirectoryOpened?: (segmentIndex: number) => void;
  readonly afterReadChunk?: (bytesRead: number) => void;
  readonly afterTemporaryWritten?: (temporaryName: string) => void;
  readonly afterPreCommitValidated?: () => void;
  readonly afterCommit?: () => void;
}

export interface IStableFileHostBackend {
  /** Compare two still-open root objects without exposing their native identities. */
  assertSameRoot(other: IStableFileHostBackend): void;
  /** Compare a caller-retained POSIX directory descriptor before it can produce any effect. */
  assertSamePosixDescriptor?(descriptor: number): void;
  /** Refuse if the supplied name no longer names this retained directory object. */
  assertNamedRoot?(rootDirectory: string): void;
  readBytes(
    relativeSegments: readonly string[],
    maxBytes: number,
    hooks: IFileAuthorityTestHooks,
  ): Uint8Array | undefined;
  listDirectory(relativeSegments: readonly string[]): readonly IStableRootedDirectoryEntry[];
  inspectKind?(relativeSegments: readonly string[]): IStableRootedDirectoryEntry['kind'] | undefined;
  writeUtf8(
    relativeSegments: readonly string[],
    content: string,
    hooks: IFileAuthorityTestHooks,
  ): void;
  close(): void;
}
