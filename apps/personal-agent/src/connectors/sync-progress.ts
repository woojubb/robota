/**
 * How far each connector's sync runs confirmed they read: one owner-only file per connector in an
 * owner-only directory, written atomically, with the latest few reports. It is the host's own record of
 * what a run said about itself after the host checked it; the goal's run history says only that a run
 * ended, which is not evidence of what it covered. Forgotten when the sync is turned off or the
 * connector is removed.
 */
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';

const CONNECTOR_ID = /^connector-[a-z0-9-]{1,60}$/;
/** How many reports are kept for a connector: enough to find the last finished run's. */
const KEPT_ENTRIES = 20;

export interface ISyncProgressEntry {
  readonly runId: string;
  /** The receipt time of the last item the run fully handled, when it handled any. */
  readonly through?: string;
  /** Whether the run reached the end of what the service had from its start point on. */
  readonly complete: boolean;
  readonly at: string;
}

export interface ISyncProgressStore {
  /** The kept reports of a connector, oldest first. */
  list(connectorId: string): readonly ISyncProgressEntry[];
  record(connectorId: string, entry: ISyncProgressEntry): void;
  forget(connectorId: string): void;
}

function isEntry(value: unknown): value is ISyncProgressEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry['runId'] === 'string' &&
    typeof entry['complete'] === 'boolean' &&
    typeof entry['at'] === 'string' &&
    (entry['through'] === undefined || typeof entry['through'] === 'string')
  );
}

export function createFileSyncProgress(directory: string): ISyncProgressStore {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  chmodSync(directory, 0o700);
  const pathOf = (id: string): string => {
    if (!CONNECTOR_ID.test(id)) throw new Error('Invalid connector id');
    return join(directory, `${id}.json`);
  };
  const read = (id: string): ISyncProgressEntry[] => {
    const path = pathOf(id);
    if (!existsSync(path)) return [];
    try {
      const parsed = JSON.parse(readFileSync(path, 'utf8')) as { entries?: unknown };
      return Array.isArray(parsed.entries) ? parsed.entries.filter(isEntry) : [];
    } catch {
      // allow-fallback: an unreadable record confirms nothing, so the sync starts as it did before there was one.
      return [];
    }
  };
  return {
    list: read,
    record(id, entry) {
      const path = pathOf(id);
      const entries = [...read(id), entry].slice(-KEPT_ENTRIES);
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify({ entries })}\n`, { mode: 0o600 });
      renameSync(temporary, path);
    },
    forget(id) {
      rmSync(pathOf(id), { force: true });
    },
  };
}
