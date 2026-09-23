/**
 * #1863: how one live session learns another is reachable.
 *
 * A session announces itself by writing one file into the guarded rendezvous directory; discovery
 * is reading that directory. The directory's permissions do the security work — only this user on
 * this machine could have written there — so an entry's presence already carries `same-user-
 * same-host`, and this module never re-decides that.
 *
 * ## The hard part is not writing entries, it is knowing which are dead
 *
 * A crashed session leaves its file behind. An entry is therefore a CLAIM about liveness, and the
 * question is what evidence settles it. Three candidates, and why the third wins:
 *
 * 1. **A timestamp with a staleness window.** Cheap and wrong at both ends: a session that is idle
 *    but alive looks dead, and one that died a second ago looks alive.
 * 2. **The pid alone.** Pid reuse is real, and the failure it produces is the dangerous direction —
 *    an unrelated process inherits a dead session's identity and is treated as a peer.
 * 3. **The pid, checked with a start-time recorded at announce.** Pid reuse changes the start time,
 *    so a recycled pid fails the check. Linux reads `/proc/<pid>/stat`; macOS reads `ps` birth time.
 *    Where neither can answer, the entry degrades to `unknown` rather than to `alive`.
 *
 * `unknown` is a real state and not a synonym for either answer. A caller may show it to an
 * operator; what it must not do is treat it as reachable, which is why `listReachablePeers` filters
 * to `alive` and the raw listing keeps the distinction.
 *
 * ## Writing is atomic
 *
 * A reader can arrive mid-write. Entries are written to a temporary name in the same directory and
 * renamed into place, so a partial file is never a discoverable peer — `rename` within one
 * directory is atomic on every filesystem this runs on.
 */

import { execFileSync } from 'node:child_process';
import { readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

/** What a session publishes about itself. */
export interface IPeerEntry {
  readonly sessionId: string;
  /** Display name, if the session has one. Never an authorization input. */
  readonly name?: string;
  readonly pid: number;
  /** Process start time, so a recycled pid does not inherit this entry. */
  readonly startedAt: string;
  readonly announcedAt: number;
  /** Content-free activity observation; independent of process liveness. */
  readonly status?: 'working' | 'needs-input' | 'idle';
  readonly statusObservedAt?: number;
  /** macOS `ps` reports whole seconds; only a later reannouncement certifies this birth second. */
  readonly startTimePrecision?: 'seconds';
  readonly startSecondMs?: number;
}

/** Whether the process behind an entry is still running. */
export type TPeerLiveness = 'alive' | 'dead' | 'unknown';

export interface IDiscoveredPeer {
  readonly entry: IPeerEntry;
  readonly liveness: TPeerLiveness;
  readonly status: 'working' | 'needs-input' | 'idle' | 'unknown';
}

export interface IRegistryOptions {
  /** The verified guarded directory. */
  readonly guardedDirectory: string;
  /** Reads a process's start time, or undefined when the platform cannot answer. Injected. */
  readonly readStartTime?: (pid: number) => string | undefined;
  /** For a test reader that, like macOS `ps`, reports only whole seconds. */
  readonly startTimePrecision?: 'seconds';
  /** Distinguish a missing PID from an inspection failure. */
  readonly probePid?: (pid: number) => 'present' | 'absent' | 'unknown';
  readonly now?: () => number;
}

const ENTRY_SUFFIX = '.peer.json';
const SECOND_MS = 1_000;
const STATUS_FRESH_MS = 30_000;

/**
 * Read a process's start time from `/proc`.
 *
 * Returns undefined rather than throwing when the process is gone or `/proc` cannot answer —
 * "no answer" and "not running" are different, so the caller must not guess `alive`.
 */
function readProcStartTime(pid: number): string | undefined {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    // Field 22 is starttime. The comm field can contain spaces and parentheses, so the split is
    // anchored on the LAST ')' rather than on whitespace — splitting naively mis-indexes every
    // field for a process whose name contains a space.
    const afterComm = stat.slice(stat.lastIndexOf(')') + 2);
    return afterComm.split(' ')[19];
  } catch {
    // allow-fallback: this substitutes no alternative value — undefined means "could not tell",
    // which the caller maps to `unknown` rather than to either verdict.
    return undefined;
  }
}

/** macOS has no `/proc`; `ps` supplies a whole-second birth time. */
export function readDarwinStartTime(
  pid: number,
  runPs: (pid: number) => string = (targetPid) =>
    execFileSync('/bin/ps', ['-p', String(targetPid), '-o', 'lstart='], {
      encoding: 'utf8',
      timeout: 1_000,
      maxBuffer: 128,
      env: { TZ: 'UTC', LC_ALL: 'C' },
    }),
): string | undefined {
  try {
    const startedAt = runPs(pid).trim();
    return startedAt || undefined;
  } catch {
    return undefined;
  }
}

function probePid(pid: number): 'present' | 'absent' | 'unknown' {
  try {
    process.kill(pid, 0);
    return 'present';
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === 'ESRCH' ? 'absent' : 'unknown';
  }
}

export function readProcessStartTime(
  pid: number,
  platform: string = process.platform,
  readDarwin: (pid: number) => string | undefined = readDarwinStartTime,
): string | undefined {
  if (!Number.isSafeInteger(pid) || pid <= 0) return undefined;
  return platform === 'darwin' ? readDarwin(pid) : readProcStartTime(pid);
}

function readAnnouncedStartMetadata(
  options: IRegistryOptions,
  pid: number,
  requireStartTime: boolean,
): Pick<IPeerEntry, 'startedAt' | 'startTimePrecision' | 'startSecondMs'> {
  const startedAt = (options.readStartTime ?? readProcessStartTime)(pid) ?? '';
  // A certification retry must never replace a previously valid birth time with an empty one.
  if (requireStartTime && startedAt === '') {
    throw new Error('The process start time could not be read for peer certification.');
  }
  const secondPrecision =
    options.startTimePrecision === 'seconds' ||
    (options.readStartTime === undefined && process.platform === 'darwin');
  const startSecondMs = secondPrecision ? Date.parse(`${startedAt} UTC`) : NaN;
  if (requireStartTime && secondPrecision && !Number.isFinite(startSecondMs)) {
    throw new Error('The process birth second could not be decoded for peer certification.');
  }
  return {
    startedAt,
    ...(secondPrecision ? { startTimePrecision: 'seconds' as const } : {}),
    ...(Number.isFinite(startSecondMs) ? { startSecondMs } : {}),
  };
}

/** Announce this session, atomically. Returns the entry as published. */
export function announcePeer(
  options: IRegistryOptions,
  input: {
    sessionId: string;
    name?: string;
    pid?: number;
    requireStartTime?: boolean;
    status?: 'working' | 'needs-input' | 'idle';
  },
): IPeerEntry {
  const pid = input.pid ?? process.pid;
  const start = readAnnouncedStartMetadata(options, pid, input.requireStartTime === true);
  const announcedAt = (options.now ?? Date.now)();
  const entry: IPeerEntry = {
    sessionId: input.sessionId,
    ...(input.name !== undefined ? { name: input.name } : {}),
    pid,
    ...start,
    announcedAt,
    ...(input.status !== undefined ? { status: input.status, statusObservedAt: announcedAt } : {}),
  };
  const target = join(options.guardedDirectory, `${input.sessionId}${ENTRY_SUFFIX}`);
  const temporary = `${target}.${pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(entry), { encoding: 'utf8', mode: 0o600 });
  renameSync(temporary, target);
  return entry;
}

/** Withdraw this session's entry. Absent is success — the goal is that it is not there. */
export function withdrawPeer(options: IRegistryOptions, sessionId: string): void {
  rmSync(join(options.guardedDirectory, `${sessionId}${ENTRY_SUFFIX}`), { force: true });
}

function judgeLiveness(
  entry: IPeerEntry,
  readStartTime: (pid: number) => string | undefined,
  probe: (pid: number) => 'present' | 'absent' | 'unknown',
): TPeerLiveness {
  if (entry.startedAt === '') return 'unknown';
  const current = readStartTime(entry.pid);
  if (current === undefined) return probe(entry.pid) === 'absent' ? 'dead' : 'unknown';
  if (current !== entry.startedAt) return 'dead';
  // A second-granularity birth time cannot rule out PID reuse in that same second. The original
  // process reannounces after the second ends; a dead process cannot make that later claim.
  if (entry.startTimePrecision === 'seconds') {
    const birth = entry.startSecondMs;
    if (typeof birth !== 'number' || !Number.isFinite(birth)) return 'unknown';
    if (entry.announcedAt < birth + SECOND_MS) return 'unknown';
  }
  return 'alive';
}

/**
 * Every entry in the rendezvous, with a liveness verdict for each.
 *
 * An unreadable or malformed entry is SKIPPED rather than reported as a peer: it is not evidence of
 * anything, and surfacing it would invite a caller to act on a shape nobody wrote.
 */
export function listPeers(options: IRegistryOptions): readonly IDiscoveredPeer[] {
  const readStartTime = options.readStartTime ?? readProcessStartTime;
  const probe = options.probePid ?? probePid;
  const out: IDiscoveredPeer[] = [];
  for (const file of readdirSync(options.guardedDirectory)) {
    if (!file.endsWith(ENTRY_SUFFIX)) continue;
    let entry: IPeerEntry;
    try {
      entry = JSON.parse(readFileSync(join(options.guardedDirectory, file), 'utf8')) as IPeerEntry;
    } catch {
      // allow-fallback: a malformed entry is not a peer and not an alternative peer — it is skipped.
      continue;
    }
    if (typeof entry?.sessionId !== 'string' || typeof entry?.pid !== 'number') continue;
    const liveness = judgeLiveness(entry, readStartTime, probe);
    const now = (options.now ?? Date.now)();
    const observed = entry.statusObservedAt;
    const status =
      liveness === 'alive' &&
      (entry.status === 'working' || entry.status === 'needs-input' || entry.status === 'idle') &&
      typeof observed === 'number' &&
      Number.isFinite(observed) &&
      observed <= now &&
      now - observed <= STATUS_FRESH_MS
        ? entry.status
        : 'unknown';
    out.push({ entry, liveness, status });
  }
  return out.sort((a, b) => a.entry.sessionId.localeCompare(b.entry.sessionId));
}

/**
 * The peers a caller may actually address.
 *
 * `unknown` is deliberately excluded. A session that cannot be shown to be running must not be
 * offered as a destination — the message would be delivered to nothing and the sender would hold an
 * ack for it.
 */
export function listReachablePeers(options: IRegistryOptions): readonly IPeerEntry[] {
  return listPeers(options)
    .filter((p) => p.liveness === 'alive')
    .map((p) => p.entry);
}
