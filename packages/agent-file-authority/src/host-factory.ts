import { authorityError } from './contracts.js';
import { PosixStableFileHostBackend } from './posix-backend.js';
import { WindowsStableFileHostBackend } from './windows-backend.js';

import type { IStableFileHostBackend } from './host-backend.js';

const SUPPORTED_HOSTS = new Set([
  'darwin-arm64',
  'darwin-x64',
  'linux-arm64',
  'linux-x64',
  'win32-x64',
]);

export function createHostBackend(rootDirectory: string): IStableFileHostBackend {
  const host = `${process.platform}-${process.arch}`;
  if (!SUPPORTED_HOSTS.has(host)) {
    throw authorityError('UNSUPPORTED_BACKEND', 'select-backend', { hostCode: host });
  }
  if (process.platform === 'win32') return new WindowsStableFileHostBackend(rootDirectory);
  return new PosixStableFileHostBackend(rootDirectory);
}
