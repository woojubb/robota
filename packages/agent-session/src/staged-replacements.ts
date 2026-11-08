/**
 * Replacing many files of a store directory at once, for the converters that seal session records and
 * session-log sidecars in place. A file is read without following a link; every replacement
 * is written and flushed beside its file before any is put in place, so no rename is published ahead
 * of content not yet flushed; and each replace is atomic, made only while the file still holds the
 * bytes that were read under no other name, so a file a running process saved meanwhile is left.
 */
import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, openSync } from 'node:fs';

import { stageOwnerOnlyFile } from '@robota-sdk/agent-core/node';

import { readWhole } from './append-file-rewrite.js';

import type { IStagedOwnerOnlyFile } from '@robota-sdk/agent-core/node';

/** A regular file's bytes and how many names it has. */
export interface IRegularFile {
  readonly bytes: Buffer;
  readonly links: number;
}

/** The regular file at `path`, never through a link; `undefined` when it is gone or not regular. */
export function readRegularFile(path: string): IRegularFile | undefined {
  let descriptor: number;
  try {
    descriptor = openSync(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return undefined;
    throw error;
  }
  try {
    const metadata = fstatSync(descriptor);
    return metadata.isFile() ? { bytes: readWhole(descriptor), links: metadata.nlink } : undefined;
  } finally {
    closeSync(descriptor);
  }
}

const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Stages one replacement: the file at `path`, read as `read`, is to hold `content`. */
export type TStageReplacement = (path: string, read: Uint8Array, content: Uint8Array) => void;

/** What {@link replaceStagedFiles} put in place, and what it left because it changed meanwhile. */
export interface IStagedReplacements {
  readonly replaced: number;
  readonly changed: readonly string[];
}

/** A file changed between the read and its replace; that replace is abandoned. */
class FileChangedError extends Error {
  constructor() {
    super('The file changed while its replacement was staged.');
    this.name = 'FileChangedError';
  }
}

/**
 * Runs `collect`, which stages the replacements, then puts each in place, as the module
 * documentation describes; `beforeCommit` runs first each time, and a throw stops there with that
 * file as it was. Whatever is not put in place is removed, however this ends.
 */
export function replaceStagedFiles(
  collect: (stage: TStageReplacement) => void,
  beforeCommit?: () => void,
  aroundCommit: (path: string, commit: () => void) => boolean = (_path, commit) => {
    commit();
    return true;
  },
): IStagedReplacements {
  const staged: { path: string; file: IStagedOwnerOnlyFile; digest: string }[] = [];
  const changed: string[] = [];
  let replaced = 0;
  try {
    collect((path, read, content) => {
      staged.push({ path, file: stageOwnerOnlyFile(path, content), digest: digestOf(read) });
    });
    for (const { path, file, digest } of staged) {
      try {
        const committed = aroundCommit(path, () =>
          file.commit(() => {
            beforeCommit?.();
            const now = readRegularFile(path);
            if (now === undefined || now.links > 1 || digestOf(now.bytes) !== digest) {
              throw new FileChangedError();
            }
          }),
        );
        if (committed) replaced += 1;
        else changed.push(path);
      } catch (error) {
        if (!(error instanceof FileChangedError)) throw error;
        changed.push(path);
      }
    }
  } finally {
    for (const { file } of staged) file.discard();
  }
  return { replaced, changed };
}
