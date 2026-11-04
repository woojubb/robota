/**
 * Who a process is, beyond its pid.
 *
 * A pid is recycled, so a record that names only a pid can later describe an unrelated process. The
 * start time tells a recycled pid from its first owner; the boot id says whether the machine has
 * restarted since, after which no process from the record can be alive; on Linux the pid namespace
 * says which pid table the number belongs to, since two containers on one kernel each have a pid 1.
 * The machine — its host name and, where readable, its machine id — says whose pid, boot and
 * namespace these are: files shared between machines (a home directory over NFS, a state root
 * mounted into a container on another kernel) carry records whose pids and boots mean nothing here,
 * and every Linux kernel reports the same number for its initial pid namespace.
 *
 * Every reader answers `undefined` rather than guessing when the platform cannot tell: "no answer" is
 * not "not running", and a caller must treat it as unknown.
 *
 * Sources: Linux reads `/proc/<pid>/stat` (start time in clock ticks since boot),
 * `/proc/sys/kernel/random/boot_id`, `/proc/self/ns/pid` and `/etc/machine-id` (or the D-Bus copy).
 * macOS reads `ps -o lstart=` (whole seconds, in UTC with the C locale so every reader formats it
 * alike), `kern.bootsessionuuid` and the `IOPlatformUUID` that `ioreg` reports, and has no pid
 * namespaces; either machine identifier is answered only as a keyed hash. Windows has none of these
 * here: a host that can read a process creation time passes its own reader, the boot is unknown, and
 * the host name alone names the machine.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';
import { hostname } from 'node:os';

import { sha256Hex } from './digest.js';

import type { IProcessIdentity } from '../interfaces/process-marker.js';

// The identity is a neutral contract (a marker port names its holder by it); it is read here.
export type { IProcessIdentity };

export interface IReadMachineIdOptions {
  readonly platform?: string;
  /** Linux file reader; defaults to reading the file as UTF-8. */
  readonly readFile?: (path: string) => string;
  /** macOS: the output of `ioreg -rd1 -c IOPlatformExpertDevice`; defaults to running it. */
  readonly runIoreg?: () => string;
}

export interface IReadProcessStartTimeOptions {
  readonly platform?: string;
  /** macOS reader; defaults to {@link readDarwinStartTime}. */
  readonly readDarwin?: (pid: number) => string | undefined;
  /** Windows reader. There is no default: without one, Windows answers `undefined`. */
  readonly readWindows?: (pid: number) => string | undefined;
}

const PROBE_TIMEOUT_MS = 1_000;

function nonEmpty(value: string): string | undefined {
  const trimmed = value.trim();
  return trimmed === '' ? undefined : trimmed;
}

/** Read a process's start time from `/proc`, or undefined when the process is gone or unreadable. */
function readProcStartTime(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 22 is starttime. The comm field can contain spaces and parentheses, so the split is
    // anchored on the LAST ')' rather than on whitespace — splitting naively mis-indexes every
    // field for a process whose name contains a space.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    return afterComm.split(' ')[19];
  } catch {
    // allow-fallback: undefined means "could not tell", which callers keep distinct from either verdict.
    return undefined;
  }
}

/** macOS has no `/proc`; `ps` supplies a whole-second birth time. */
export function readDarwinStartTime(
  pid: number,
  runPs: (pid: number) => string = (targetPid) =>
    execFileSync('/bin/ps', ['-p', String(targetPid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: PROBE_TIMEOUT_MS,
      maxBuffer: 128,
      env: { TZ: 'UTC', LC_ALL: 'C' },
    }),
): string | undefined {
  try {
    return nonEmpty(runPs(pid));
  } catch {
    // allow-fallback: `ps` exits non-zero for a pid that is gone; both mean "no start time here".
    return undefined;
  }
}

/** A process's start time in a platform-specific form that is equal for the same process. */
export function readProcessStartTime(
  pid: number,
  options: IReadProcessStartTimeOptions = {},
): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  const platform = options.platform ?? process.platform;
  if (platform === 'darwin') return (options.readDarwin ?? readDarwinStartTime)(pid);
  if (platform === 'win32') return options.readWindows?.(pid);
  return readProcStartTime(pid);
}

/** The identity of the machine's current boot, or undefined where the platform offers none. */
export function readBootId(platform: string = process.platform): string | undefined {
  try {
    if (platform === 'linux')
      return nonEmpty(readFileSync('/proc/sys/kernel/random/boot_id', 'utf8'));
    if (platform === 'darwin') {
      return nonEmpty(
        execFileSync('/usr/sbin/sysctl', ['-n', 'kern.bootsessionuuid'], {
          encoding: 'utf8',
          timeout: PROBE_TIMEOUT_MS,
          maxBuffer: 128,
          env: { LC_ALL: 'C' },
        }),
      );
    }
  } catch {
    // allow-fallback: an unreadable boot id is an unknown boot, never a guessed one.
    return undefined;
  }
  return undefined;
}

/** The Linux pid namespace this process's pids belong to, such as `pid:[4026531836]`. */
export function readPidNamespace(platform: string = process.platform): string | undefined {
  if (platform !== 'linux') return undefined;
  try {
    return readlinkSync('/proc/self/ns/pid');
  } catch {
    // allow-fallback: an unreadable namespace is unknown, which callers treat as "maybe another one".
    return undefined;
  }
}

/** Where Linux keeps the machine id: systemd's file first, then the D-Bus copy older systems have. */
const LINUX_MACHINE_ID_PATHS = ['/etc/machine-id', '/var/lib/dbus/machine-id'] as const;
/** A Linux machine id is 32 lowercase hex digits; anything else ("uninitialized", empty) is none. */
const LINUX_MACHINE_ID = /^[0-9a-f]{32}$/u;
const IOREG_PLATFORM_UUID =
  /"IOPlatformUUID"\s*=\s*"([0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12})"/u;
const IOREG_MAX_OUTPUT_BYTES = 64 * 1024;
/**
 * machine-id(5) asks an application not to use the machine id itself but a hash of it under a fixed
 * value of its own; the same holds for the platform UUID. It only has to be this application's and
 * never change, not be secret, so it is a readable label.
 */
const MACHINE_ID_HASH_LABEL = 'agent-core/process-identity/machine-id/v1';

function applicationSpecific(rawId: string): string {
  return sha256Hex(`${MACHINE_ID_HASH_LABEL}:${rawId}`).slice(0, 32);
}

function runIoregPlatformExpert(): string {
  return execFileSync('/usr/sbin/ioreg', ['-rd1', '-c', 'IOPlatformExpertDevice'], {
    encoding: 'utf8',
    timeout: PROBE_TIMEOUT_MS,
    maxBuffer: IOREG_MAX_OUTPUT_BYTES,
    env: { LC_ALL: 'C' },
  });
}

/** The raw Linux machine id or macOS platform UUID, before it is made application-specific. */
function readRawMachineId(options: IReadMachineIdOptions): string | undefined {
  const platform = options.platform ?? process.platform;
  if (platform === 'linux') {
    const readFile = options.readFile ?? ((path: string) => readFileSync(path, 'utf8'));
    for (const path of LINUX_MACHINE_ID_PATHS) {
      try {
        const id = readFile(path).trim();
        if (LINUX_MACHINE_ID.test(id)) return id;
      } catch {
        // allow-fallback: a missing or unreadable file only means "try the next source".
      }
    }
    return undefined;
  }
  if (platform === 'darwin') {
    try {
      return IOREG_PLATFORM_UUID.exec((options.runIoreg ?? runIoregPlatformExpert)())?.[1];
    } catch {
      // allow-fallback: an unreadable platform UUID is an unknown machine, never a guessed one.
      return undefined;
    }
  }
  return undefined;
}

/**
 * A stable identifier of this machine that survives reboots, derived from the Linux machine id or the
 * macOS platform UUID so the raw identifier is never written anywhere. Undefined on Windows and
 * wherever neither can be read.
 */
export function readMachineId(options: IReadMachineIdOptions = {}): string | undefined {
  const raw = readRawMachineId(options);
  return raw === undefined ? undefined : applicationSpecific(raw);
}

let currentIdentity: IProcessIdentity | undefined;

/** This process, read once: none of these change while it runs. */
export function readCurrentProcessIdentity(): IProcessIdentity {
  if (currentIdentity?.pid === process.pid) return currentIdentity;
  const startTime = readProcessStartTime(process.pid);
  const bootId = readBootId();
  const pidNamespace = readPidNamespace();
  const host = nonEmpty(hostname());
  const machineId = readMachineId();
  currentIdentity = {
    pid: process.pid,
    ...(startTime === undefined ? {} : { startTime }),
    ...(bootId === undefined ? {} : { bootId }),
    ...(pidNamespace === undefined ? {} : { pidNamespace }),
    ...(host === undefined ? {} : { hostname: host }),
    ...(machineId === undefined ? {} : { machineId }),
  };
  return currentIdentity;
}
