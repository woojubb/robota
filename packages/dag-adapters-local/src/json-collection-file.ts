import { readFile, rename, writeFile } from 'node:fs/promises';

const OWNER_ONLY_FILE_MODE = 0o600;

/**
 * A `Map` that lives in a JSON file.
 *
 * DAG-003 made `FileStoragePort`'s runs and task runs durable, and this is the durability — separated
 * because it is a different responsibility from knowing what a DAG run IS. The port keeps its Maps as
 * the working set and every query it already had; this owns only their lifetime.
 *
 * Whole-collection writes rather than a file per entity. That tier is single-process — its queue and
 * lease ports are in-memory too — so there is no concurrent writer to lose, and one rename is cheaper
 * than the directory walk a per-entity layout needs on every hydrate.
 */
export async function hydrateCollection<T>(
  filePath: string,
  into: Map<string, T>,
  keyOf: (value: T) => string,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(filePath, 'utf-8');
  } catch (error) {
    // Absent is the normal first-run state. Anything else is a real read failure and must NOT be
    // read as "nothing was stored" — that would silently discard the state this exists to keep, and
    // a store that quietly forgets is the defect DAG-003 is about, one level down.
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return;
    throw error;
  }
  for (const value of JSON.parse(content) as T[]) into.set(keyOf(value), value);
}

/**
 * Serialise writes per file, and let the LAST requested state win.
 *
 * Review round 2 found the hole the first version left. `persistCollection` captured its snapshot
 * synchronously and then wrote and renamed asynchronously, with no ordering between calls — so two
 * concurrent mutations could have their renames land out of call order and the file regress to a
 * stale snapshot while the Maps stayed correct. Demonstrated by delaying one write: with an older
 * snapshot slowed by 40ms, `["a"]` overwrote `["a","b","c"]`.
 *
 * That is not hypothetical here. `dag-worker`'s own suite drives concurrent calls into one storage
 * instance (`stale-task-sweeper.test.ts`, "two concurrent sweeps do not both requeue the same task",
 * via `Promise.all`). The first version's comment said "there is no concurrent writer to lose", which
 * conflated a single OS PROCESS with a single async caller — a claim about the wrong thing, in a
 * change whose whole subject is state that quietly fails to reach disk.
 *
 * Coalescing rather than queueing: a write already in flight means every later request can be served
 * by ONE more write of whatever the state is when that write begins. Requests do not pile up, and the
 * snapshot is taken when the write starts rather than when it was asked for, so the final file
 * reflects the final Map.
 */
/**
 * The coalescing cache, keyed by file path.
 *
 * The queued value is a THUNK returning the already-serialisable snapshot, not the collection: it is
 * only ever spread into `JSON.stringify`, so nothing downstream needs its element type. Storing
 * `Iterable<unknown>` here would type-erase across the two collections for no gain, and
 * `code-quality.md` keeps `unknown` for trust boundaries with narrowing — this is neither.
 */
const pendingWrites = new Map<string, Promise<void>>();
const queuedSources = new Map<string, () => string>();

export async function persistCollection<T>(filePath: string, values: Iterable<T>): Promise<void> {
  // Serialised lazily: whoever runs the next write should publish the newest state, not the one its
  // own caller happened to hold.
  queuedSources.set(filePath, () => JSON.stringify([...values], null, 2));
  const inFlight = pendingWrites.get(filePath);
  if (inFlight !== undefined) return inFlight;

  const run = drainQueue(filePath, queuedSources, writeAtomically).finally(() => {
    pendingWrites.delete(filePath);
  });
  pendingWrites.set(filePath, run);
  return run;
}

/**
 * Write queued states until none is left, and report by what is ON DISK at the end.
 *
 * Review round 6 found the first version abandoning the queue on the first failure. Two things went
 * wrong with that, and both are about the signal rather than the data:
 *
 * - Callers share one promise, so a LATE write failing rejected for callers whose own state had
 *   already landed. "Your write failed" when it did not.
 * - Whatever was still queued when it threw stayed unwritten until some later, unrelated mutation
 *   happened to call in again.
 *
 * Draining fully fixes both, and makes the verdict meaningful: every write publishes the LATEST
 * state, so a later success supersedes an earlier failure and disk is current. Only a failure of the
 * FINAL attempt leaves disk stale, and only that rejects. A caller is told "your state is durable"
 * exactly when it is.
 *
 * The queue is a PARAMETER rather than the module's own map, so this is a pure function over an
 * explicit input and its tests need no seam in shipped code.
 */
export async function drainQueue(
  filePath: string,
  queue: Map<string, () => string>,
  write: (path: string, serialized: string) => Promise<void>,
): Promise<void> {
  let lastError: unknown;
  while (queue.has(filePath)) {
    const serialise = queue.get(filePath);
    queue.delete(filePath);
    try {
      await write(filePath, serialise!());
      // A success supersedes any earlier failure: this write published the newest state, so disk is
      // current regardless of what an earlier attempt did.
      lastError = undefined;
    } catch (error) {
      lastError = error;
    }
  }
  if (lastError !== undefined) throw lastError;
}

/**
 * Write-and-rename, so a reader never sees a half-written file.
 *
 * A partial write is worse than no write here: the file is read back as the whole truth on restart,
 * so a truncated one would present as a smaller, plausible set of runs rather than as a failure.
 */
async function writeAtomically(filePath: string, serialized: string): Promise<void> {
  const temporaryFilePath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(temporaryFilePath, serialized, {
    encoding: 'utf-8',
    // Owner-only, not the process umask. Task runs carry `inputSnapshot`/`outputSnapshot` payloads,
    // and `storageRoot` can resolve under `XDG_DATA_HOME`; this package already pins `cost-meta.json`
    // the same way for the same reason (SEC-003 / CWE-377). Set on the temp file so the mode is in
    // force before any content is written, never widened by a later chmod.
    mode: OWNER_ONLY_FILE_MODE,
  });
  await rename(temporaryFilePath, filePath);
}
