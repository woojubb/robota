/**
 * Who a process is, beyond its pid.
 *
 * A pid is recycled, so a record that names only a pid can later describe an unrelated process. The
 * start time tells a recycled pid from its first owner; the boot id says whether the machine has
 * restarted since, after which no process from the record can be alive; on Linux the pid namespace
 * says which pid table the number belongs to, since two containers on one kernel each have a pid 1.
 *
 * Every reader answers `undefined` rather than guessing when the platform cannot tell: "no answer" is
 * not "not running", and a caller must treat it as unknown.
 *
 * Sources: Linux reads `/proc/<pid>/stat` (start time in clock ticks since boot),
 * `/proc/sys/kernel/random/boot_id` and `/proc/self/ns/pid`. macOS reads `ps -o lstart=` (whole
 * seconds, in UTC with the C locale so every reader formats it alike) and `kern.bootsessionuuid`, and
 * has no pid namespaces. Windows has neither here: a host that can read a process creation time
 * passes its own reader, and the boot is unknown.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readlinkSync } from 'node:fs';

/** A process as an observer on the same machine can later recognize it. */
export interface IProcessIdentity {
  readonly pid: number;
  /** The process start time as {@link readProcessStartTime} reads it; absent when unreadable. */
  readonly startTime?: string;
  /** The machine boot the process runs in; absent where the platform offers none. */
  readonly bootId?: string;
  /** The Linux pid namespace the pid belongs to; absent elsewhere. */
  readonly pidNamespace?: string;
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

let currentIdentity: IProcessIdentity | undefined;

/** This process, read once: none of these change while it runs. */
export function readCurrentProcessIdentity(): IProcessIdentity {
  if (currentIdentity?.pid === process.pid) return currentIdentity;
  const startTime = readProcessStartTime(process.pid);
  const bootId = readBootId();
  const pidNamespace = readPidNamespace();
  currentIdentity = {
    pid: process.pid,
    ...(startTime === undefined ? {} : { startTime }),
    ...(bootId === undefined ? {} : { bootId }),
    ...(pidNamespace === undefined ? {} : { pidNamespace }),
  };
  return currentIdentity;
}
