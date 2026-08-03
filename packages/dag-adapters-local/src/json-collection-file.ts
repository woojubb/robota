import { readFile, rename, writeFile } from 'node:fs/promises';

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
 * Write a collection atomically — the same write-and-rename the definitions use.
 *
 * A partial write is worse than no write here: the file is read back as the whole truth on restart,
 * so a truncated one would present as a smaller, plausible set of runs rather than as a failure.
 */
export async function persistCollection<T>(filePath: string, values: Iterable<T>): Promise<void> {
  const temporaryFilePath = `${filePath}.tmp-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  await writeFile(temporaryFilePath, JSON.stringify([...values], null, 2), 'utf-8');
  await rename(temporaryFilePath, filePath);
}
