import * as koffi from 'koffi';

import { authorityError } from './contracts.js';

import type { IFileAuthorityTestHooks } from './host-backend.js';
import type { IWindowsApi, IWindowsFileIdInfo, TNativeHandle } from './windows-native-api.js';

export interface IWindowsIdentity {
  readonly volume: bigint;
  readonly fileId: string;
}

interface IWindowsFileSnapshot extends IWindowsIdentity {
  readonly size: bigint;
}

const FILE_ID_INFO_CLASS = 18;
const CHUNK_BYTES = 1_048_576;
const ZERO_SIZE = BigInt('0');

function bytesToHex(value: Uint8Array | number[] | undefined): string {
  if (value instanceof Uint8Array) return Buffer.from(value).toString('hex');
  if (Array.isArray(value)) return Buffer.from(value).toString('hex');
  throw authorityError('UNSUPPORTED_BACKEND', 'decode-file-identity');
}

export function windowsLastErrorCode(api: IWindowsApi): string {
  return `WIN32_${api.getLastError()}`;
}

export function queryWindowsIdentity(
  api: IWindowsApi,
  handle: TNativeHandle,
  operation: string,
): IWindowsIdentity {
  const info: IWindowsFileIdInfo = {};
  if (!api.getFileIdInfo(handle, FILE_ID_INFO_CLASS, info, koffi.sizeof(api.fileIdInfoType))) {
    throw authorityError('UNSUPPORTED_BACKEND', operation, {
      hostCode: windowsLastErrorCode(api),
    });
  }
  return {
    volume: BigInt(info.VolumeSerialNumber ?? ZERO_SIZE),
    fileId: bytesToHex(info.FileId),
  };
}

export function readWindowsFile(
  api: IWindowsApi,
  handle: TNativeHandle,
  maxBytes: number,
  hooks: IFileAuthorityTestHooks,
): Uint8Array {
  const before = queryFileSnapshot(api, handle);
  if (before.size > BigInt(maxBytes)) throw authorityError('OVER_BUDGET', 'read-file');
  const expectedBytes = Number(before.size);
  let bytes: Buffer;
  try {
    bytes = Buffer.alloc(expectedBytes);
  } catch {
    throw authorityError('HOST_IO', 'allocate-read-buffer');
  }

  const offset = readExpectedBytes(api, handle, bytes, hooks);
  const probeCount = [0];
  if (!api.readFile(handle, Buffer.alloc(1), 1, probeCount, null)) {
    throw authorityError('HOST_IO', 'probe-file', { hostCode: windowsLastErrorCode(api) });
  }
  const after = queryFileSnapshot(api, handle);
  if (probeCount[0] !== 0 && expectedBytes >= maxBytes) {
    throw authorityError('OVER_BUDGET', 'read-file');
  }
  if (!isStableRead(before, after, offset, expectedBytes, probeCount[0])) {
    throw authorityError('FILE_CHANGED', 'read-file');
  }
  return bytes;
}

function readExpectedBytes(
  api: IWindowsApi,
  handle: TNativeHandle,
  bytes: Buffer,
  hooks: IFileAuthorityTestHooks,
): number {
  let offset = 0;
  while (offset < bytes.length) {
    const length = Math.min(CHUNK_BYTES, bytes.length - offset);
    const count = [0];
    if (!api.readFile(handle, bytes.subarray(offset, offset + length), length, count, null)) {
      throw authorityError('HOST_IO', 'read-file', { hostCode: windowsLastErrorCode(api) });
    }
    if (count[0] === 0) break;
    offset += count[0];
    hooks.afterReadChunk?.(offset);
  }
  return offset;
}

function queryFileSnapshot(api: IWindowsApi, handle: TNativeHandle): IWindowsFileSnapshot {
  const identity = queryWindowsIdentity(api, handle, 'inspect-file');
  const size = [ZERO_SIZE];
  if (!api.getFileSizeEx(handle, size)) {
    throw authorityError('HOST_IO', 'inspect-file', { hostCode: windowsLastErrorCode(api) });
  }
  return { ...identity, size: BigInt(size[0]) };
}

function isStableRead(
  before: IWindowsFileSnapshot,
  after: IWindowsFileSnapshot,
  actualBytes: number,
  expectedBytes: number,
  probeBytes: number,
): boolean {
  return (
    actualBytes === expectedBytes &&
    probeBytes === 0 &&
    before.volume === after.volume &&
    before.fileId === after.fileId &&
    before.size === after.size
  );
}
