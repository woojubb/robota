import {
  authorityError,
  StableFileAuthorityError,
  type INamedStableRootedFileWriter,
} from './contracts.js';
import { createHostBackend } from './host-factory.js';
import { validateRelativeSegments, validateRootDirectory } from './input-validation.js';

import type { IFileAuthorityTestHooks, IStableFileHostBackend } from './host-backend.js';

const finalizer = new FinalizationRegistry<IStableFileHostBackend>((backend) => {
  backend.close();
});

class StableRootedFileWriter implements INamedStableRootedFileWriter {
  private backend: IStableFileHostBackend | undefined;
  private readonly finalizerToken = {};

  constructor(
    private readonly rootDirectory: string,
    private readonly hooks: IFileAuthorityTestHooks,
  ) {
    const backend = createHostBackend(validateRootDirectory(rootDirectory));
    this.backend = backend;
    finalizer.register(this, backend, this.finalizerToken);
  }

  assertNamedRoot(): void {
    const backend = this.backend;
    if (backend === undefined) throw authorityError('AUTHORITY_CLOSED', 'inspect-root');
    if (backend.assertNamedRoot === undefined)
      throw authorityError('UNSUPPORTED_BACKEND', 'inspect-root');
    backend.assertNamedRoot(this.rootDirectory);
  }

  writeUtf8WhileNamed(relativeSegments: readonly string[], content: string): void {
    const backend = this.backend;
    if (backend === undefined) throw authorityError('AUTHORITY_CLOSED', 'write');
    validateRelativeSegments(relativeSegments);
    if (typeof content !== 'string') throw authorityError('INVALID_PATH', 'validate-content');
    this.assertNamedRoot();
    backend.writeUtf8(relativeSegments, content, {
      ...this.hooks,
      afterPreCommitValidated: () => {
        this.assertNamedRoot();
        this.hooks.afterPreCommitValidated?.();
        this.assertNamedRoot();
      },
      afterCommit: () => {
        this.hooks.afterCommit?.();
        this.assertNamedRoot();
      },
    });
  }

  writeUtf8(relativeSegments: readonly string[], content: string): void {
    const backend = this.backend;
    if (backend === undefined) throw authorityError('AUTHORITY_CLOSED', 'write');
    validateRelativeSegments(relativeSegments);
    if (typeof content !== 'string') throw authorityError('INVALID_PATH', 'validate-content');
    try {
      backend.writeUtf8(relativeSegments, content, this.hooks);
    } catch (error) {
      if (error instanceof StableFileAuthorityError) throw error;
      throw authorityError('HOST_IO', 'write');
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

/** Create a stable, opaque write authority rooted at the currently opened directory identity. */
export function createStableRootedFileWriter(rootDirectory: string): INamedStableRootedFileWriter {
  return new StableRootedFileWriter(rootDirectory, {});
}

/** Internal-only deterministic seams used by native replacement tests. */
export function createStableRootedFileWriterForTest(
  rootDirectory: string,
  hooks: IFileAuthorityTestHooks,
): INamedStableRootedFileWriter {
  return new StableRootedFileWriter(rootDirectory, hooks);
}
