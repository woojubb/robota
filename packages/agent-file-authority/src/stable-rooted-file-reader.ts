import {
  authorityError,
  StableFileAuthorityError,
  type IStableRootedFileReader,
  type IStableRootedDirectoryEntry,
} from './contracts.js';
import { createHostBackend } from './host-factory.js';
import {
  validateReadBudget,
  validateRelativeSegments,
  validateRootDirectory,
} from './input-validation.js';

import type { IFileAuthorityTestHooks, IStableFileHostBackend } from './host-backend.js';

export type { IFileAuthorityTestHooks } from './host-backend.js';

const finalizer = new FinalizationRegistry<IStableFileHostBackend>((backend) => {
  backend.close();
});
const readerBackends = new WeakMap<IStableRootedFileReader, IStableFileHostBackend>();

function validateReadInput(relativeSegments: readonly string[], maxBytes: number): void {
  validateRelativeSegments(relativeSegments);
  validateReadBudget(maxBytes);
}

class StableRootedFileReader implements IStableRootedFileReader {
  private backend: IStableFileHostBackend | undefined;
  private readonly finalizerToken = {};

  constructor(
    rootDirectory: string,
    private readonly hooks: IFileAuthorityTestHooks,
  ) {
    const backend = createHostBackend(validateRootDirectory(rootDirectory));
    this.backend = backend;
    readerBackends.set(this, backend);
    finalizer.register(this, backend, this.finalizerToken);
  }

  readBytes(relativeSegments: readonly string[], maxBytes: number): Uint8Array | undefined {
    const backend = this.backend;
    if (backend === undefined) throw authorityError('AUTHORITY_CLOSED', 'read');
    validateReadInput(relativeSegments, maxBytes);
    try {
      return backend.readBytes(relativeSegments, maxBytes, this.hooks);
    } catch (error) {
      if (error instanceof StableFileAuthorityError) throw error;
      throw authorityError('HOST_IO', 'read');
    }
  }

  listDirectory(relativeSegments: readonly string[]): readonly IStableRootedDirectoryEntry[] {
    const backend = this.backend;
    if (backend === undefined) throw authorityError('AUTHORITY_CLOSED', 'list-directory');
    if (!Array.isArray(relativeSegments)) throw authorityError('INVALID_PATH', 'validate-segments');
    if (relativeSegments.length > 0) validateRelativeSegments(relativeSegments);
    return backend.listDirectory(relativeSegments);
  }

  inspectKind(relativeSegments: readonly string[]): IStableRootedDirectoryEntry['kind'] | undefined {
    if (this.backend === undefined) throw authorityError('AUTHORITY_CLOSED', 'inspect-kind');
    if (!Array.isArray(relativeSegments)) throw authorityError('INVALID_PATH', 'validate-segments');
    if (relativeSegments.length === 0) return 'directory';
    validateRelativeSegments(relativeSegments);
    const entries = this.listDirectory(relativeSegments.slice(0, -1));
    return entries.find((entry) => entry.name === relativeSegments.at(-1))?.kind;
  }

  close(): void {
    const backend = this.backend;
    if (backend === undefined) return;
    this.backend = undefined;
    finalizer.unregister(this.finalizerToken);
    try {
      backend.close();
    } catch (error) {
      if (error instanceof StableFileAuthorityError) throw error;
      throw authorityError('HOST_IO', 'close');
    }
  }

  [Symbol.dispose](): void {
    this.close();
  }
}

/** Create a stable, opaque read authority rooted at the currently opened directory identity. */
export function createStableRootedFileReader(rootDirectory: string): IStableRootedFileReader {
  return new StableRootedFileReader(rootDirectory, {});
}

/** Refuse unless two live opaque readers retain the same directory object. */
export function assertSameStableRoot(
  approved: IStableRootedFileReader,
  operation: IStableRootedFileReader,
): void {
  const approvedBackend = readerBackends.get(approved);
  const operationBackend = readerBackends.get(operation);
  if (approvedBackend === undefined || operationBackend === undefined) {
    throw authorityError('INVALID_PATH', 'compare-roots');
  }
  approvedBackend.assertSameRoot(operationBackend);
}

/** Internal bridge for writers that retain their own opaque root backend. */
export function assertStableReaderMatchesBackend(
  approved: IStableRootedFileReader,
  operation: IStableFileHostBackend,
): void {
  const backend = readerBackends.get(approved);
  if (backend === undefined) throw authorityError('INVALID_PATH', 'compare-roots');
  backend.assertSameRoot(operation);
}

/** Refuse unless a caller-retained POSIX directory descriptor is the approved live root. */
export function assertSameStablePosixRootDescriptor(
  approved: IStableRootedFileReader,
  descriptor: number,
): void {
  const backend = readerBackends.get(approved);
  if (backend === undefined || backend.assertSamePosixDescriptor === undefined) {
    throw authorityError('UNSUPPORTED_BACKEND', 'compare-roots');
  }
  backend.assertSamePosixDescriptor(descriptor);
}

/** Internal-only deterministic seams used by native replacement tests. */
export function createStableRootedFileReaderForTest(
  rootDirectory: string,
  hooks: IFileAuthorityTestHooks,
): IStableRootedFileReader {
  return new StableRootedFileReader(rootDirectory, hooks);
}
