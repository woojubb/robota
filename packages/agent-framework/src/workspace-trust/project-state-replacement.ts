/**
 * Reading and replacing a trusted project's state files for a store's migration (#3679), over the
 * anchored writer every project write goes through. A file is read back only up to the project read
 * limit. A replace is made only while the file still holds what was read, under no other name; many
 * files are replaced at once by staging each beside its file, flushed, before any is put in place. The
 * anchored writer has no compare-and-swap, so that last read is as close as the check gets, and a
 * migration runs with no other writer. Internal to the framework.
 */
import { createHash } from 'node:crypto';

import { ProjectReadLimitExceededError } from './project-reader-path.js';
import {
  stageWorkspaceProjectStateFile,
  workspaceProjectStateLinkCount,
} from './project-state-storage.js';

import type { IStagedWorkspaceProjectStateFile } from './project-state-storage.js';
import type { IWorkspaceProjectStateStorage } from './types.js';

/** The bytes at `name`, `'over-cap'` past the project read limit, `undefined` when it is gone. */
export function readCappedProjectStateFile(
  storage: IWorkspaceProjectStateStorage,
  name: string,
  purpose: string,
): Uint8Array | 'over-cap' | undefined {
  try {
    return storage.readBytes(name, purpose);
  } catch (error) {
    if (error instanceof ProjectReadLimitExceededError) return 'over-cap';
    throw error;
  }
}

/** Whether the regular file at `name` has another name, which a replace would leave holding its bytes. */
export function projectStateFileHardLinked(
  storage: IWorkspaceProjectStateStorage,
  name: string,
): boolean {
  return (workspaceProjectStateLinkCount(storage, name) ?? 1) > 1;
}

const digestOf = (bytes: Uint8Array): string => createHash('sha256').update(bytes).digest('hex');

/** Whether `name` still holds exactly what had digest `expected`, under no other name. */
function unchanged(
  storage: IWorkspaceProjectStateStorage,
  name: string,
  purpose: string,
  expected: string,
): boolean {
  const now = readCappedProjectStateFile(storage, name, purpose);
  return (
    now instanceof Uint8Array &&
    digestOf(now) === expected &&
    workspaceProjectStateLinkCount(storage, name) === 1
  );
}

/**
 * Replaces `name`, read as `read`, with `content` unless it changed since; returns whether it did.
 * `beforeCommit` runs first, so a throw stops before the write.
 */
export function replaceProjectStateFileIfUnchanged(
  storage: IWorkspaceProjectStateStorage,
  name: string,
  read: Uint8Array,
  content: Uint8Array,
  purpose: string,
  beforeCommit?: () => void,
): boolean {
  beforeCommit?.();
  if (!unchanged(storage, name, purpose, digestOf(read))) return false;
  storage.replaceBytes(name, content, purpose);
  return true;
}

/** Stages one replacement: `name` (reported as `path`), read as `read`, is to hold `content`. */
export type TStageProjectStateReplacement = (
  name: string,
  path: string,
  read: Uint8Array,
  content: Uint8Array,
) => void;

/**
 * Runs `collect`, which stages the replacements, then puts in place each that is unchanged,
 * `beforeCommit` first each time; returns how many it put in place and the paths of those that
 * changed meanwhile, which are left. Whatever is not put in place is removed, however this ends.
 */
export function replaceStagedProjectStateFiles(
  storage: IWorkspaceProjectStateStorage,
  purpose: string,
  collect: (stage: TStageProjectStateReplacement) => void,
  beforeCommit?: () => void,
  aroundCommit: (name: string, commit: () => void) => boolean = (_name, commit) => {
    commit();
    return true;
  },
): { readonly replaced: number; readonly changed: readonly string[] } {
  const staged: {
    name: string;
    path: string;
    file: IStagedWorkspaceProjectStateFile;
    digest: string;
  }[] = [];
  const changed: string[] = [];
  let replaced = 0;
  try {
    collect((name, path, read, content) => {
      const file = stageWorkspaceProjectStateFile(storage, name, content);
      staged.push({ name, path, file, digest: digestOf(read) });
    });
    for (const { name, path, file, digest } of staged) {
      let didReplace = false;
      const ran = aroundCommit(name, () => {
        beforeCommit?.();
        if (unchanged(storage, name, purpose, digest)) {
          file.commit();
          didReplace = true;
        }
      });
      if (ran && didReplace) replaced += 1;
      else {
        file.discard();
        changed.push(path);
      }
    }
  } finally {
    for (const { file } of staged) file.discard();
  }
  return { replaced, changed };
}
