import { resolve } from 'node:path';

import {
  authorityError,
  isStableFileAuthorityError,
  type IStableRootedFileReader,
} from './contracts.js';
import { PosixStableFileHostBackend } from './posix-backend.js';
import { WindowsStableFileHostBackend } from './windows-backend.js';

import type { IFileAuthorityTestHooks, IStableFileHostBackend } from './host-backend.js';

export type { IFileAuthorityTestHooks } from './host-backend.js';

const SUPPORTED_HOSTS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]);

const finalizer = new FinalizationRegistry<IStableFileHostBackend>((backend) => {
  backend.close();
});

function validateRoot(rootDirectory: string): string {
  if (
    typeof rootDirectory !== 'string' ||
    rootDirectory.trim().length === 0 ||
    rootDirectory.includes('\0')
  ) {
    throw authorityError('INVALID_PATH', 'validate-root');
  }
  return resolve(rootDirectory);
}

function validateReadInput(relativeSegments: readonly string[], maxBytes: number): void {
  if (!Array.isArray(relativeSegments) || relativeSegments.length === 0) {
    throw authorityError('INVALID_PATH', 'validate-segments');
  }
  for (let index = 0; index < relativeSegments.length; index += 1) {
    const segment = relativeSegments[index];
    if (
      typeof segment !== 'string' ||
      segment.length === 0 ||
      segment === '.' ||
      segment === '..' ||
      segment.includes('\0') ||
      segment.includes('/') ||
      segment.includes('\\')
    ) {
      throw authorityError('INVALID_PATH', 'validate-segments', { segmentIndex: index });
    }
  }
  if (!Number.isSafeInteger(maxBytes) || maxBytes < 0) {
    throw authorityError('INVALID_PATH', 'validate-budget');
  }
}

function createHostBackend(rootDirectory: string): IStableFileHostBackend {
  const host = `${process.platform}-${process.arch}`;
  if (!SUPPORTED_HOSTS.has(host)) {
    throw authorityError('UNSUPPORTED_BACKEND', 'select-backend', { hostCode: host });
  }
  if (process.platform === 'win32') return new WindowsStableFileHostBackend(rootDirectory);
  return new PosixStableFileHostBackend(rootDirectory);
}

class StableRootedFileReader implements IStableRootedFileReader {
  private backend: IStableFileHostBackend | undefined;
  private readonly finalizerToken = {};

  constructor(
    rootDirectory: string,
    private readonly hooks: IFileAuthorityTestHooks,
  ) {
    const backend = createHostBackend(validateRoot(rootDirectory));
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
      if (isStableFileAuthorityError(error)) throw error;
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
      if (isStableFileAuthorityError(error)) throw error;
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
