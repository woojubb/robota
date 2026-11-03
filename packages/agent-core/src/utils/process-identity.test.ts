/**
 * Who a process is beyond its pid, read from the real machine where the platform can answer.
 */

import { spawnSync } from 'node:child_process';
import { hostname } from 'node:os';

import { describe, expect, it } from 'vitest';

import {
  readBootId,
  readCurrentProcessIdentity,
  readMachineId,
  readPidNamespace,
  readProcessStartTime,
} from './process-identity.js';

const POSIX = process.platform === 'linux' || process.platform === 'darwin';

describe('readProcessStartTime', () => {
  it.runIf(POSIX)(
    'reads the same start time for a live process every time, and none for a process that is gone',
    () => {
      const first = readProcessStartTime(process.pid);

      expect(first).toMatch(/\S/u);
      expect(readProcessStartTime(process.pid)).toBe(first);
      const exited = spawnSync(process.execPath, ['-e', '']);
      expect(readProcessStartTime(exited.pid)).toBeUndefined();
    },
  );

  it('asks the macOS reader on macOS, and answers nothing on Windows unless the host supplies a reader', () => {
    const readDarwin = (pid: number): string | undefined =>
      pid === 123 ? 'darwin-birth' : undefined;
    const readWindows = (pid: number): string | undefined => (pid === 123 ? '133000' : undefined);

    expect(readProcessStartTime(123, { platform: 'darwin', readDarwin })).toBe('darwin-birth');
    expect(readProcessStartTime(123, { platform: 'win32' })).toBeUndefined();
    expect(readProcessStartTime(123, { platform: 'win32', readWindows })).toBe('133000');
  });

  it('answers nothing for a pid that is not a positive integer', () => {
    for (const pid of [0, -1, 1.5, Number.NaN]) {
      expect(
        readProcessStartTime(pid, { platform: 'darwin', readDarwin: () => 'x' }),
      ).toBeUndefined();
    }
  });
});

describe('readBootId', () => {
  it.runIf(POSIX)('names the current boot the same way on every read', () => {
    const boot = readBootId();

    expect(boot).toMatch(
      /^[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}$/u,
    );
    expect(readBootId()).toBe(boot);
  });

  it('has no boot identity on a platform that offers none', () => {
    expect(readBootId('win32')).toBeUndefined();
  });
});

describe('readPidNamespace', () => {
  it.runIf(process.platform === 'linux')('names the pid namespace on Linux', () => {
    expect(readPidNamespace()).toMatch(/^pid:\[\d+\]$/u);
  });

  it('has none where the platform has no pid namespaces', () => {
    expect(readPidNamespace('darwin')).toBeUndefined();
    expect(readPidNamespace('win32')).toBeUndefined();
  });
});

describe('readMachineId', () => {
  const LINUX_ID = '0123456789abcdef0123456789abcdef';
  const DBUS_ID = 'fedcba9876543210fedcba9876543210';
  /** What machine-id(5) asks for: an application-specific derivation, never the raw identifier. */
  const DERIVED = /^[0-9a-f]{32}$/u;

  /** The Linux answer when exactly these files exist, with these contents. */
  const onLinux = (entries: Readonly<Record<string, string>>): string | undefined =>
    readMachineId({
      platform: 'linux',
      readFile: (path) => {
        const content = entries[path];
        if (content === undefined) throw new Error(`ENOENT: ${path}`);
        return content;
      },
    });
  /** The macOS answer when ioreg reports `uuid` as the platform UUID. */
  const onMac = (uuid: string): string | undefined =>
    readMachineId({
      platform: 'darwin',
      runIoreg: () =>
        `+-o J314sAP  <class IOPlatformExpertDevice>\n    {\n      "IOPlatformSerialNumber" = "X"\n      "IOPlatformUUID" = "${uuid}"\n    }\n`,
    });

  it.runIf(process.platform === 'darwin')(
    'names this Mac the same way on every read, without writing out its platform UUID',
    () => {
      const ioreg = spawnSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
        encoding: 'utf8',
      }).stdout;
      const raw = /"IOPlatformUUID" = "([^"]+)"/u.exec(ioreg)?.[1];
      const id = readMachineId();

      expect(raw).toMatch(/\S/u);
      expect(id).toMatch(DERIVED);
      expect(id).toBe(onMac(raw!));
      expect(readMachineId()).toBe(id);
    },
  );

  it.runIf(process.platform === 'linux')(
    'names this Linux machine the same way on every read, where it has a machine id',
    () => {
      const id = readMachineId();

      if (id !== undefined) expect(id).toMatch(DERIVED);
      expect(readMachineId()).toBe(id);
    },
  );

  it('derives the Linux answer from /etc/machine-id, falling back to the D-Bus copy when it is missing, empty or not yet initialized', () => {
    const fromEtc = onLinux({
      '/etc/machine-id': `${LINUX_ID}\n`,
      '/var/lib/dbus/machine-id': DBUS_ID,
    });

    expect(fromEtc).toMatch(DERIVED);
    expect(fromEtc).not.toContain(LINUX_ID);
    expect(fromEtc).toBe(onLinux({ '/etc/machine-id': LINUX_ID }));
    expect(fromEtc).not.toBe(onLinux({ '/etc/machine-id': DBUS_ID }));
    for (const etc of [undefined, '', 'uninitialized\n']) {
      const entries: Record<string, string> = { '/var/lib/dbus/machine-id': `${DBUS_ID}\n` };
      if (etc !== undefined) entries['/etc/machine-id'] = etc;
      expect(onLinux(entries)).toBe(onLinux({ '/etc/machine-id': DBUS_ID }));
    }
    expect(onLinux({})).toBeUndefined();
  });

  it('derives the macOS answer from the IOPlatformUUID ioreg reports, and has none when ioreg fails or does not name it', () => {
    const uuid = '12345678-ABCD-4EF0-9876-0123456789AB';

    expect(onMac(uuid)).toMatch(DERIVED);
    expect(onMac(uuid)).not.toContain(uuid.toLowerCase().replaceAll('-', ''));
    expect(onMac(uuid)).not.toBe(onMac('12345678-ABCD-4EF0-9876-0123456789AC'));
    expect(readMachineId({ platform: 'darwin', runIoreg: () => '{}' })).toBeUndefined();
    expect(
      readMachineId({
        platform: 'darwin',
        runIoreg: () => {
          throw new Error('ioreg timed out');
        },
      }),
    ).toBeUndefined();
  });

  it('has none on Windows, where only the host name names the machine', () => {
    expect(readMachineId({ platform: 'win32', readFile: () => LINUX_ID })).toBeUndefined();
  });
});

describe('readCurrentProcessIdentity', () => {
  it('describes this process with the same readers a later observer uses', () => {
    const identity = readCurrentProcessIdentity();

    expect(identity.pid).toBe(process.pid);
    expect(identity.startTime).toBe(readProcessStartTime(process.pid));
    expect(identity.bootId).toBe(readBootId());
    expect(identity.pidNamespace).toBe(readPidNamespace());
    expect(identity.hostname).toBe(hostname());
    expect(identity.machineId).toBe(readMachineId());
  });
});
