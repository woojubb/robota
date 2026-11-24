/**
 * The two file operations every task-catalog file adapter shares: rewrite a file whole through a
 * temporary file and a rename, and read a file of records one by one so a record that is not what
 * this module writes is left out and counted instead of failing the page.
 */
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';

export interface IRead<T> {
  readonly records: readonly T[];
  readonly issue?: string;
}

export function writeAtomically(path: string, value: unknown): void {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  try {
    writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600, flag: 'wx' });
    renameSync(temporary, path);
  } catch (error) {
    rmSync(temporary, { force: true });
    throw error;
  }
}

/** One file's records. The issue names the kind of record and never a path or the parser's message. */
export function readRecords<T>(
  path: string,
  key: string,
  noun: { readonly one: string; readonly many: string },
  parse: (raw: unknown) => T,
): IRead<T> {
  if (!existsSync(path)) return { records: [] };
  let raw: unknown;
  try {
    raw = (JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>)[key];
  } catch {
    // allow-fallback: a file that cannot be read starts empty, and says so as an issue.
    raw = undefined;
  }
  if (!Array.isArray(raw))
    return { records: [], issue: `Saved ${noun.many} could not be read, so none are shown.` };
  const records: T[] = [];
  for (const entry of raw) {
    try {
      records.push(parse(entry));
    } catch {
      // allow-fallback: one record that is not valid is left out and counted in the issue below.
    }
  }
  const skipped = raw.length - records.length;
  if (skipped === 0) return { records };
  return {
    records,
    issue:
      skipped === 1
        ? `1 saved ${noun.one} could not be read and is not shown.`
        : `${skipped} saved ${noun.many} could not be read and are not shown.`,
  };
}
