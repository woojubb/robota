import {
  authorityError,
  StableFileAuthorityError,
  type IStableRootedFileReader,
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

/** Internal-only deterministic seams used by native replacement tests. */
export function createStableRootedFileReaderForTest(
  rootDirectory: string,
  hooks: IFileAuthorityTestHooks,
): IStableRootedFileReader {
  return new StableRootedFileReader(rootDirectory, hooks);
}
