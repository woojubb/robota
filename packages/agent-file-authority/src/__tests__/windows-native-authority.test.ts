import * as koffi from 'koffi';
import { describe, expect, it, vi } from 'vitest';

import { WindowsNativeAuthority } from '../windows-native-authority.js';

import type { TNativeHandle } from '../windows-native-api.js';

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
