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
 *    so a recycled pid fails the check. This is what `/proc/<pid>/stat`'s start field is for on
 *    Linux, and where it is unavailable the entry degrades to `unknown` rather than to `alive`.
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
}

/** Whether the process behind an entry is still running. */
export type TPeerLiveness = 'alive' | 'dead' | 'unknown';

export interface IDiscoveredPeer {
  readonly entry: IPeerEntry;
  readonly liveness: TPeerLiveness;
}

export interface IRegistryOptions {
  /** The verified guarded directory. */
  readonly guardedDirectory: string;
  /** Reads a process's start time, or undefined when the platform cannot answer. Injected. */
  readonly readStartTime?: (pid: number) => string | undefined;
  readonly now?: () => number;
}

const ENTRY_SUFFIX = '.peer.json';

/**
 * Read a process's start time from `/proc`.
 *
 * Returns undefined rather than throwing when the process is gone or the platform has no `/proc` —
 * "no answer" and "not running" are different, and collapsing them here would make a
 * non-Linux host report every peer as dead.
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

/** Announce this session, atomically. Returns the entry as published. */
export function announcePeer(
  options: IRegistryOptions,
  input: { sessionId: string; name?: string; pid?: number },
): IPeerEntry {
  const pid = input.pid ?? process.pid;
  const readStartTime = options.readStartTime ?? readProcStartTime;
  const entry: IPeerEntry = {
    sessionId: input.sessionId,
    ...(input.name !== undefined ? { name: input.name } : {}),
    pid,
    startedAt: readStartTime(pid) ?? '',
    announcedAt: (options.now ?? Date.now)(),
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
): TPeerLiveness {
  const current = readStartTime(entry.pid);
  if (current === undefined) return entry.startedAt === '' ? 'unknown' : 'dead';
  if (entry.startedAt === '') return 'unknown';
  return current === entry.startedAt ? 'alive' : 'dead';
}

/**
 * Every entry in the rendezvous, with a liveness verdict for each.
 *
 * An unreadable or malformed entry is SKIPPED rather than reported as a peer: it is not evidence of
 * anything, and surfacing it would invite a caller to act on a shape nobody wrote.
 */
export function listPeers(options: IRegistryOptions): readonly IDiscoveredPeer[] {
  const readStartTime = options.readStartTime ?? readProcStartTime;
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
    out.push({ entry, liveness: judgeLiveness(entry, readStartTime) });
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
