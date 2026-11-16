/**
 * One JSON value kept in an owner-only file of its own, in an owner-only directory, rewritten atomically.
 * The files here hold what is a capability or a key, so nothing else is written beside them and no
 * reader outside the module that owns the file is given its contents.
 */
import { chmodSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

export interface IOwnerFile {
  /** The path, for words that tell the person which file to look at. */
  readonly path: string;
  /** The stored value, or `undefined` when there is no file. A file that is not JSON throws. */
  read(): unknown;
  write(value: unknown): void;
}

export function createOwnerFile(directory: string, name: string): IOwnerFile {
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  // A directory that already existed keeps no looser mode than the one asked for.
  chmodSync(directory, 0o700);
  const path = join(directory, name);
  return {
    path,
    read: () =>
      existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as unknown) : undefined,
    write: (value) => {
      const temporary = `${path}.${process.pid}.tmp`;
      writeFileSync(temporary, `${JSON.stringify(value)}\n`, { mode: 0o600 });
      renameSync(temporary, path);
    },
  };
}
