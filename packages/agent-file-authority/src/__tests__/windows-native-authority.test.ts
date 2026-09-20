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
