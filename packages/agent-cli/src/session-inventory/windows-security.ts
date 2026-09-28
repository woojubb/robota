import { lstatSync } from 'node:fs';
import { dirname } from 'node:path';

import koffi from 'koffi';

// Administrators and SYSTEM can override any local ACL, as root can on POSIX.
const PRIVILEGED_SIDS = new Set(['BA', 'SY', 'S-1-5-32-544', 'S-1-5-18']);
const FULL_CONTROL = 0x1f01ff;

/** A complete owner/DACL descriptor, never a POSIX mode assertion on Windows. */
export function isPrivateWindowsSddl(sddl: string, sid: string, protectedAcl: boolean): boolean {
  const parsed = /^O:([^:]+)D:([A-Z]*)(\(.*\))$/u.exec(sddl);
  if (!parsed || (parsed[1] !== sid && !PRIVILEGED_SIDS.has(parsed[1]!))) return false;
  if (protectedAcl && !parsed[2]!.includes('P')) return false;
  const entries = [...parsed[3]!.matchAll(/\(([^()]*)\)/gu)];
  if (!entries.length || entries.map((entry) => entry[0]).join('') !== parsed[3]) return false;
  let ownerAccess = false;
  for (const entry of entries) {
    const fields = entry[1]!.split(';');
    if (fields.length !== 6 || fields[0] !== 'A' || fields[3] || fields[4]) return false;
    const trustee = fields[5]!;
    if (trustee !== sid && !PRIVILEGED_SIDS.has(trustee)) return false;
    const rights =
      fields[2] === 'FA'
        ? FULL_CONTROL
        : /^0x[0-9a-f]+$/iu.test(fields[2]!)
          ? Number(fields[2])
          : 0;
    if (trustee === sid && !fields[1]!.includes('IO') && (rights & FULL_CONTROL) === FULL_CONTROL)
      ownerAccess = true;
  }
  return ownerAccess;
}

function loadApi() {
  if (process.platform !== 'win32') throw new Error('Windows security requires Windows.');
  const kernel = koffi.load('kernel32.dll');
  const security = koffi.load('advapi32.dll');
  const securityAttributes = koffi.struct({
    length: 'uint32_t',
    descriptor: 'void*',
    inherit: 'int',
  });
  return {
    securityAttributes,
    createDirectory: kernel.func('__stdcall', 'CreateDirectoryW', 'int', [
      'str16',
      koffi.pointer(securityAttributes),
    ]),
    error: kernel.func('uint32_t __stdcall GetLastError()'),
    currentProcess: kernel.func('void* __stdcall GetCurrentProcess()'),
    close: kernel.func('int __stdcall CloseHandle(void*)'),
    free: kernel.func('void* __stdcall LocalFree(void*)'),
    openProcess: kernel.func('void* __stdcall OpenProcess(uint32_t, int, uint32_t)'),
    processTimes: kernel.func('int __stdcall GetProcessTimes(void*, void*, void*, void*, void*)'),
    attributes: kernel.func('uint32_t __stdcall GetFileAttributesW(str16)'),
    openToken: security.func('int __stdcall OpenProcessToken(void*, uint32_t, _Out_ void**)'),
    tokenInfo: security.func(
      'int __stdcall GetTokenInformation(void*, uint32_t, void*, uint32_t, _Out_ uint32_t*)',
    ),
    sidString: security.func('int __stdcall ConvertSidToStringSidW(void*, _Out_ void**)'),
    getSecurity: security.func(
      'uint32_t __stdcall GetNamedSecurityInfoW(str16, int, uint32_t, void*, void*, void*, void*, _Out_ void**)',
    ),
    descriptorString: security.func(
      'int __stdcall ConvertSecurityDescriptorToStringSecurityDescriptorW(void*, uint32_t, uint32_t, _Out_ void**, void*)',
    ),
    descriptor: security.func(
      'int __stdcall ConvertStringSecurityDescriptorToSecurityDescriptorW(str16, uint32_t, _Out_ void**, void*)',
    ),
  };
}

let cachedApi: ReturnType<typeof loadApi> | undefined;
const api = () => (cachedApi ??= loadApi());
let cachedSid: string | undefined;

function tokenSid(processHandle: unknown): string {
  const win = api();
  const token: unknown[] = [null];
  if (!win.openToken(processHandle, 8, token))
    throw new Error('Unable to read Windows process owner.');
  try {
    const length = [0];
    win.tokenInfo(token[0], 1, null, 0, length);
    if (!length[0] || length[0] > 65536) throw new Error('Invalid Windows process owner size.');
    const buffer = Buffer.alloc(length[0]);
    if (!win.tokenInfo(token[0], 1, buffer, buffer.length, length))
      throw new Error('Unable to read Windows process owner.');
    const text: unknown[] = [null];
    if (!win.sidString(koffi.decode(buffer, 'void*'), text))
      throw new Error('Unable to decode Windows process owner.');
    try {
      const sid = String(koffi.decode.string16(text[0]));
      if (!/^S-1-[0-9-]+$/u.test(sid)) throw new Error('Invalid Windows owner SID.');
      return sid;
    } finally {
      win.free(text[0]);
    }
  } finally {
    win.close(token[0]);
  }
}

export function currentWindowsSid(): string {
  return (cachedSid ??= tokenSid(api().currentProcess()));
}

function descriptorOf(path: string): string {
  const win = api();
  const descriptor: unknown[] = [null];
  if (win.getSecurity(path, 1, 5, null, null, null, null, descriptor) !== 0)
    throw new Error('Unable to read Windows access protection.');
  try {
    const text: unknown[] = [null];
    if (!win.descriptorString(descriptor[0], 1, 5, text, null))
      throw new Error('Unable to decode Windows access protection.');
    try {
      return String(koffi.decode.string16(text[0]));
    } finally {
      win.free(text[0]);
    }
  } finally {
    win.free(descriptor[0]);
  }
}

function assertLocalPath(path: string): void {
  const stat = lstatSync(path);
  const attributes = api().attributes(path);
  if (attributes === 0xffffffff || (attributes & 0x400) !== 0 || stat.isSymbolicLink()) {
    throw new Error('Windows supervised storage cannot be a reparse point.');
  }
}

export function assertWindowsPrivatePath(path: string, directory: boolean): void {
  assertLocalPath(path);
  const stat = lstatSync(path);
  if (directory ? !stat.isDirectory() : !stat.isFile())
    throw new Error('Invalid Windows supervised storage type.');
  if (!isPrivateWindowsSddl(descriptorOf(path), currentWindowsSid(), directory)) {
    throw new Error('Windows supervised storage is not private to this user.');
  }
}

/** Apply the private descriptor at creation: an inherited ACL is never briefly exposed. */
export function createWindowsPrivateDirectory(path: string, exclusive = false): void {
  try {
    assertWindowsPrivatePath(path, true);
    if (exclusive) throw new Error('Windows supervised directory already exists.');
    return;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  const parent = dirname(path);
  try {
    assertLocalPath(parent);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT' || parent === path) throw error;
    createWindowsPrivateDirectory(parent);
  }
  const win = api();
  const descriptor: unknown[] = [null];
  const sid = currentWindowsSid();
  if (!win.descriptor(`O:${sid}D:P(A;OICI;FA;;;${sid})`, 1, descriptor, null))
    throw new Error('Unable to build Windows access protection.');
  try {
    if (
      !win.createDirectory(path, {
        length: koffi.sizeof(win.securityAttributes),
        descriptor: descriptor[0],
        inherit: 0,
      }) &&
      (exclusive || win.error() !== 183)
    )
      throw new Error('Unable to create private Windows supervised directory.');
  } finally {
    win.free(descriptor[0]);
  }
  assertWindowsPrivatePath(path, true);
}

export function readWindowsProcessStartTime(pid: number): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const win = api();
  const handle = win.openProcess(0x1000, 0, pid);
  if (!handle) return undefined;
  try {
    const creation = Buffer.alloc(8);
    if (!win.processTimes(handle, creation, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)))
      return undefined;
    return creation.readBigUInt64LE().toString();
  } finally {
    win.close(handle);
  }
}

/** PID and account are read from the same process handle, never from a recycled PID separately. */
export function readWindowsProcessIdentity(
  pid: number,
): { sid: string; startedAt: string } | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const win = api();
  const handle = win.openProcess(0x1000, 0, pid);
  if (!handle) return undefined;
  try {
    const creation = Buffer.alloc(8);
    if (!win.processTimes(handle, creation, Buffer.alloc(8), Buffer.alloc(8), Buffer.alloc(8)))
      return undefined;
    return { sid: tokenSid(handle), startedAt: creation.readBigUInt64LE().toString() };
  } catch {
    return undefined;
  } finally {
    win.close(handle);
  }
}

export function withWindowsPrivateDescriptor<T>(use: (descriptor: unknown) => T): T {
  const win = api();
  const sid = currentWindowsSid();
  const descriptor: unknown[] = [null];
  if (!win.descriptor(`O:${sid}D:P(A;;FA;;;${sid})`, 1, descriptor, null))
    throw new Error('Unable to build Windows pipe protection.');
  try {
    return use(descriptor[0]);
  } finally {
    win.free(descriptor[0]);
  }
}
