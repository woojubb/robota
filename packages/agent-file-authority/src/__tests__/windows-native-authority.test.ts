import * as koffi from 'koffi';
import { describe, expect, it, vi } from 'vitest';

import { WindowsNativeAuthority } from '../windows-native-authority.js';

import type { IWindowsRenameInfo, TNativeHandle } from '../windows-native-api.js';

function uninitializedAuthority(): WindowsNativeAuthority {
  return Object.create(WindowsNativeAuthority.prototype) as WindowsNativeAuthority;
}

describe('WindowsNativeAuthority cleanup', () => {
  it('closes a successfully opened handle when safety inspection rejects it', () => {
    const authority = uninitializedAuthority();
    const handle = BigInt(42);
    const close = vi.fn<(value: TNativeHandle) => void>();
    Reflect.set(authority, 'issueRelativeOpen', () => ({ handle, status: 0 }));
    Reflect.set(authority, 'assertSafeHandle', () => {
      throw new Error('unsafe handle');
    });
    Reflect.set(authority, 'close', close);

    expect(() => authority.openRelative(BigInt(1), 'payload.bin', true, 0)).toThrow(
      'unsafe handle',
    );
    expect(close).toHaveBeenCalledExactlyOnceWith(handle);
  });

  it('closes a returned handle when NtCreateFile reports failure', () => {
    const authority = uninitializedAuthority();
    const handle = BigInt(42);
    const close = vi.fn<(value: TNativeHandle) => void>();
    Reflect.set(authority, 'issueRelativeOpen', () => ({ handle, status: -1 }));
    Reflect.set(authority, 'close', close);

    expect(() => authority.openRelative(BigInt(1), 'payload.bin', true, 0)).toThrow();
    expect(close).toHaveBeenCalledExactlyOnceWith(handle);
  });

  it('closes a temporary handle when safety inspection rejects it', () => {
    const authority = uninitializedAuthority();
    const handle = BigInt(43);
    const close = vi.fn<(value: TNativeHandle) => void>();
    Reflect.set(authority, 'issueRelativeCreate', () => ({ handle, status: 0 }));
    Reflect.set(authority, 'assertSafeHandle', () => {
      throw new Error('unsafe temporary');
    });
    Reflect.set(authority, 'close', close);

    expect(() => authority.createTemporaryFile(BigInt(1), '.atomic-tmp-test')).toThrow(
      'unsafe temporary',
    );
    expect(close).toHaveBeenCalledExactlyOnceWith(handle);
  });

  it('falls back to CloseHandle when NtClose returns a failure status', () => {
    const authority = uninitializedAuthority();
    const ntClose = vi.fn<() => number>().mockReturnValue(-1);
    const closeHandle = vi.fn<() => boolean>().mockReturnValue(true);
    Reflect.set(authority, 'api', { ntClose, closeHandle });

    authority.close(BigInt(42));

    expect(ntClose).toHaveBeenCalledOnce();
    expect(closeHandle).toHaveBeenCalledOnce();
  });

  it('does not double-close after NtClose succeeds', () => {
    const authority = uninitializedAuthority();
    const ntClose = vi.fn<() => number>().mockReturnValue(0);
    const closeHandle = vi.fn<() => boolean>().mockReturnValue(true);
    Reflect.set(authority, 'api', { ntClose, closeHandle });

    authority.close(BigInt(42));

    expect(ntClose).toHaveBeenCalledOnce();
    expect(closeHandle).not.toHaveBeenCalled();
  });
});

describe('WindowsNativeAuthority handle-relative replacement', () => {
  it('renames the exact temporary handle relative to the retained parent handle', () => {
    const authority = uninitializedAuthority();
    const handleType = koffi.pointer('TestStableWriteHandle', koffi.opaque());
    const renameInfoType = koffi.struct('TestStableWriteRenameInfo', {
      ReplaceIfExists: 'uint8_t',
      RootDirectory: handleType,
      FileNameLength: 'uint32_t',
      FileName: koffi.array('uint16_t', 256, 'Typed'),
    });
    const sourceHandle = BigInt(42);
    const parentHandle = BigInt(7);
    let decoded: IWindowsRenameInfo | undefined;
    const setFileInformation = vi.fn(
      (
        handle: TNativeHandle,
        informationClass: number,
        information: object,
        informationBytes: number,
      ) => {
        expect(handle).toBe(sourceHandle);
        expect(informationClass).toBe(3);
        expect(informationBytes).toBe(koffi.sizeof(renameInfoType));
        decoded = koffi.decode(information, renameInfoType) as IWindowsRenameInfo;
        return true;
      },
    );
    Reflect.set(authority, 'api', {
      renameInfoType,
      setFileInformation,
      getLastError: () => 0,
    });

    authority.renameTo(sourceHandle, parentHandle, 'result.txt', true);

    expect(setFileInformation).toHaveBeenCalledOnce();
    expect(decoded?.ReplaceIfExists).toBe(1);
    expect(decoded?.RootDirectory).toBe(parentHandle);
    expect(decoded?.FileNameLength).toBe(Buffer.byteLength('result.txt', 'utf16le'));
    expect(
      String.fromCharCode(...Array.from(decoded?.FileName ?? []).slice(0, 'result.txt'.length)),
    ).toBe('result.txt');
  });

  it('does not authorize replacement when the destination was initially absent', () => {
    const authority = uninitializedAuthority();
    const handleType = koffi.pointer('TestStableCreateHandle', koffi.opaque());
    const renameInfoType = koffi.struct('TestStableCreateRenameInfo', {
      ReplaceIfExists: 'uint8_t',
      RootDirectory: handleType,
      FileNameLength: 'uint32_t',
      FileName: koffi.array('uint16_t', 256, 'Typed'),
    });
    let decoded: IWindowsRenameInfo | undefined;
    Reflect.set(authority, 'api', {
      renameInfoType,
      setFileInformation: (
        _handle: TNativeHandle,
        _informationClass: number,
        information: object,
      ) => {
        decoded = koffi.decode(information, renameInfoType) as IWindowsRenameInfo;
        return true;
      },
      getLastError: () => 0,
    });

    authority.renameTo(BigInt(42), BigInt(7), 'result.txt', false);

    expect(decoded?.ReplaceIfExists).toBe(0);
  });
});

describe('WindowsNativeAuthority read sharing', () => {
  it('excludes concurrent writers only while a final file is held for reading', () => {
    const authority = uninitializedAuthority();
    const handleType = koffi.pointer('TestStableReadHandle', koffi.opaque());
    const unicodeStringType = koffi.struct('TestStableReadUnicodeString', {
      Length: 'uint16_t',
      MaximumLength: 'uint16_t',
      Buffer: koffi.pointer('char16_t'),
    });
    const objectAttributesType = koffi.struct('TestStableReadObjectAttributes', {
      Length: 'uint32_t',
      RootDirectory: handleType,
      ObjectName: koffi.pointer(unicodeStringType),
      Attributes: 'uint32_t',
      SecurityDescriptor: 'void *',
      SecurityQualityOfService: 'void *',
    });
    const shares: number[] = [];
    Reflect.set(authority, 'api', {
      unicodeStringType,
      objectAttributesType,
      ntCreateFile: (
        output: TNativeHandle[],
        _desiredAccess: number,
        _attributes: object,
        _ioStatus: object,
        _allocationSize: null,
        _fileAttributes: number,
        shareAccess: number,
      ) => {
        shares.push(shareAccess);
        output[0] = BigInt(42);
        return 0;
      },
    });
    const issueRelativeOpen = Reflect.get(authority, 'issueRelativeOpen') as (
      parent: TNativeHandle,
      segment: string,
      final: boolean,
    ) => unknown;

    issueRelativeOpen.call(authority, BigInt(1), 'nested', false);
    issueRelativeOpen.call(authority, BigInt(1), 'payload.bin', true);

    expect(shares).toHaveLength(2);
    expect(shares[0] & 0x2).toBe(0x2);
    expect(shares[1] & 0x2).toBe(0);
  });
});
