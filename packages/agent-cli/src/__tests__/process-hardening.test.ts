/**
 * Same-user inspection hardening: Linux asks the kernel to stop treating the process as dumpable,
 * Node holds SIGUSR1 so it opens no inspector, and no failure of either may reach startup.
 *
 * What the kernel and Node do with this — a second process of the same user being refused
 * `/proc/<pid>/environ`, a signal that opens nothing — cannot be observed through a fake;
 * `process-hardening-kernel.test.ts` and `inspector-signal-hardening.test.ts` check it on real
 * processes.
 */

import { describe, expect, it, vi } from 'vitest';

import {
  hardenProcessAgainstSameUserInspection,
  keepInspectorClosedOnSignal,
  type IInspectorSignalOptions,
  type IProcessHardeningKoffi,
} from '../process-hardening.js';

function fakeKoffi(prctlResult = 0): {
  koffi: IProcessHardeningKoffi;
  load: ReturnType<typeof vi.fn>;
  func: ReturnType<typeof vi.fn>;
  prctl: ReturnType<typeof vi.fn>;
} {
  const prctl = vi.fn((..._args: number[]) => prctlResult);
  const func = vi.fn((_declaration: string) => prctl);
  const load = vi.fn((_path: string) => ({ func }));
  return { koffi: { load }, load, func, prctl };
}

describe('hardenProcessAgainstSameUserInspection', () => {
  it('clears the dumpable attribute through libc on linux', () => {
    const { koffi, load, func, prctl } = fakeKoffi();

    const applied = hardenProcessAgainstSameUserInspection({ platform: 'linux', koffi });

    expect(applied).toBe(true);
    expect(load).toHaveBeenCalledWith('libc.so.6');
    expect(func).toHaveBeenCalledWith(expect.stringContaining('prctl'));
    expect(prctl).toHaveBeenCalledTimes(1);
    expect(prctl).toHaveBeenCalledWith(4, 0, 0, 0, 0);
  });

  it.each(['darwin', 'win32', 'freebsd'] as const)(
    'does not touch libc or the process on %s',
    (platform) => {
      const { koffi, load, prctl } = fakeKoffi();

      const applied = hardenProcessAgainstSameUserInspection({ platform, koffi });

      expect(applied).toBe(false);
      expect(load).not.toHaveBeenCalled();
      expect(prctl).not.toHaveBeenCalled();
    },
  );

  it('reports false when the kernel refuses the change', () => {
    const { koffi } = fakeKoffi(-1);

    expect(hardenProcessAgainstSameUserInspection({ platform: 'linux', koffi })).toBe(false);
  });

  it('never throws when libc cannot be loaded or lacks prctl', () => {
    const missingLibc: IProcessHardeningKoffi = {
      load: () => {
        throw new Error('libc.so.6: cannot open shared object file');
      },
    };
    const missingPrctl: IProcessHardeningKoffi = {
      load: () => ({
        func: () => {
          throw new Error('Cannot find function prctl');
        },
      }),
    };

    for (const koffi of [missingLibc, missingPrctl]) {
      expect(hardenProcessAgainstSameUserInspection({ platform: 'linux', koffi })).toBe(false);
    }
  });

  it('never throws when the native call itself throws', () => {
    const throwing: IProcessHardeningKoffi = {
      load: () => ({
        func: () => () => {
          throw new Error('native call failed');
        },
      }),
    };

    expect(hardenProcessAgainstSameUserInspection({ platform: 'linux', koffi: throwing })).toBe(
      false,
    );
  });

  it('completes synchronously, so the entry installs its diagnostics before any I/O', () => {
    const { koffi, prctl } = fakeKoffi();

    hardenProcessAgainstSameUserInspection({ platform: 'linux', koffi });

    expect(prctl).toHaveBeenCalledTimes(1);
  });
});

function fakeSignalTarget(existing = 0): {
  target: NonNullable<IInspectorSignalOptions['target']>;
  on: ReturnType<typeof vi.fn>;
} {
  const listeners: unknown[] = Array.from({ length: existing }, () => () => undefined);
  const on = vi.fn((_event: string, listener: unknown) => {
    listeners.push(listener);
    return process;
  });
  const target = { listenerCount: () => listeners.length, on } as unknown as NonNullable<
    IInspectorSignalOptions['target']
  >;
  return { target, on };
}

describe('keepInspectorClosedOnSignal', () => {
  it.each(['linux', 'darwin', 'freebsd'] as const)('holds SIGUSR1 under Node on %s', (platform) => {
    const { target, on } = fakeSignalTarget();

    expect(keepInspectorClosedOnSignal({ platform, target })).toBe(true);
    expect(on).toHaveBeenCalledTimes(1);
    expect(on).toHaveBeenCalledWith('SIGUSR1', expect.any(Function));
  });

  it('adds nothing when a listener already holds the signal', () => {
    // The npm wrapper holds it before the bundle's entry asks again.
    const { target, on } = fakeSignalTarget(1);

    expect(keepInspectorClosedOnSignal({ platform: 'linux', target })).toBe(true);
    expect(on).not.toHaveBeenCalled();
  });

  it('leaves Bun and Windows alone', () => {
    for (const options of [{ platform: 'linux', bun: '1.4.2' }, { platform: 'win32' }] as const) {
      const { target, on } = fakeSignalTarget();

      expect(keepInspectorClosedOnSignal({ ...options, target })).toBe(false);
      expect(on).not.toHaveBeenCalled();
    }
  });

  it('never throws when the listener cannot be installed', () => {
    const target = {
      listenerCount: () => 0,
      on: () => {
        throw new Error('uv_signal_start failed');
      },
    } as unknown as NonNullable<IInspectorSignalOptions['target']>;

    expect(keepInspectorClosedOnSignal({ platform: 'linux', target })).toBe(false);
  });
});
