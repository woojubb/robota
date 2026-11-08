/**
 * What earlier runs left behind that may hold conversation content and that nothing reads again,
 * for `secure migrate` to delete — never seal — once no other product process is running:
 *
 * - sessions handed over to this side and kept aside until saved (`handoff/<sender>/<id>.json`), and
 *   the partial files of transfers that never finished (`.partial-*`);
 * - the `/editor` buffers builds before the owner-only scratch directories kept in the shared
 *   temporary directory under this product's prefix, owned by this account and untouched for a day
 *   (judged by the directory and the newest entry in it);
 * - the scratch directories of product processes that are gone (spilled tool results, `/editor`
 *   buffers, the edit checkpoints of a run that persisted no session), by the owner record each holds.
 *
 * The SDK's default tool-result spill directories in the shared temporary directory are counted and
 * listed, never deleted: their names do not say which program made them. A link is never followed:
 * only real directories and regular files owned by this account are considered. An entry that cannot
 * be read or removed is listed with the links rather than stopping the walk.
 */
import { lstatSync, readdirSync, rmSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';

import {
  inspectProcessScopedDirectories,
  sweepStaleProcessScopedDirectories,
} from '@robota-sdk/agent-core/node';
import { sweepStaleToolResultSpillDirectories } from '@robota-sdk/agent-framework/node';

import { EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX } from '../startup/ephemeral-state.js';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

const HANDOFF_DIRECTORY = 'handoff';
const HANDOFF_PAYLOAD_EXTENSION = '.json';
const PARTIAL_PREFIX = '.partial-';
const SDK_SPILL_PREFIX = 'agent-tool-results-';
/** `mkdtemp` appends exactly six characters from this alphabet. */
const MKDTEMP_SUFFIX = '[A-Za-z0-9]{6}';
const EDITOR_IDLE_MS = 24 * 60 * 60 * 1000;
const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

export interface ILeftoverOptions {
  /** `false` plans: everything is found and counted exactly as a run would, and nothing is removed. */
  readonly apply: boolean;
  /** The shared temporary directory earlier builds used; defaults to this process's. */
  readonly temporaryDirectory?: string;
  /** Now, in milliseconds; defaults to the clock. */
  readonly now?: () => number;
}

export interface ILeftovers {
  readonly temporaryDirectory: string;
  /** Kept-aside hand-off payloads and partial transfers: removed (or to remove). */
  readonly handoffFiles: number;
  /** Earlier builds' `/editor` directories idle for a day: removed (or to remove). */
  readonly editorDirectories: number;
  /** Earlier builds' `/editor` directories used within the day: left for the next run. */
  readonly recentEditorDirectories: number;
  /** Scratch directories of processes that are gone: removed (or to remove). */
  readonly deadProcessDirectories: number;
  /** The SDK's spill directories in the shared temporary directory: listed, never removed. */
  readonly sdkSpillDirectories: readonly string[];
  /**
   * Links, entries that are not this account's, and entries that could not be read or removed, where
   * a leftover would be: never followed, left as they are.
   */
  readonly refused: readonly string[];
}

function ownedByThisAccount(uid: number): boolean {
  return process.getuid === undefined || uid === process.getuid();
}

/**
 * A real directory of this account at `path`, or `undefined` (missing), or `false` (a link, another's,
 * or one whose metadata cannot be read).
 */
function realDirectory(path: string): true | false | undefined {
  try {
    const metadata = lstatSync(path, { throwIfNoEntry: false });
    if (metadata === undefined) return undefined;
    return metadata.isDirectory() && ownedByThisAccount(metadata.uid);
  } catch {
    return false; // allow-fallback: what cannot be looked at is listed as refused, never followed.
  }
}

/** The names in `directory`, sorted; `undefined` (and `directory` listed as refused) when it cannot be read. */
function namesIn(directory: string, refused: string[]): string[] | undefined {
  try {
    return readdirSync(directory).sort();
  } catch {
    // allow-fallback: a directory that cannot be listed is reported, and the walk goes on.
    refused.push(directory);
    return undefined;
  }
}

/** Runs `remove` for the leftover at `path`; one that cannot be removed is listed as refused. */
function removed(path: string, refused: string[], remove: () => void): boolean {
  try {
    remove();
    return true;
  } catch {
    // allow-fallback: a leftover that cannot be removed is reported, and the walk goes on.
    refused.push(path);
    return false;
  }
}

function handoffLeftovers(runtime: ICliRuntimeContext, apply: boolean, refused: string[]): number {
  const root = join(runtime.layout.userRoot, HANDOFF_DIRECTORY);
  const isDirectory = realDirectory(root);
  if (isDirectory === undefined) return 0;
  if (!isDirectory) {
    refused.push(root);
    return 0;
  }
  let count = 0;
  for (const sender of namesIn(root, refused) ?? []) {
    const directory = join(root, sender);
    const senderIsDirectory = realDirectory(directory);
    if (senderIsDirectory !== true) {
      if (senderIsDirectory === false) refused.push(directory);
      continue;
    }
    for (const name of namesIn(directory, refused) ?? []) {
      if (!name.endsWith(HANDOFF_PAYLOAD_EXTENSION) && !name.startsWith(PARTIAL_PREFIX)) continue;
      const path = join(directory, name);
      let metadata;
      try {
        metadata = lstatSync(path, { throwIfNoEntry: false });
      } catch {
        refused.push(path); // allow-fallback: what cannot be looked at is reported, never removed.
        continue;
      }
      if (metadata === undefined) continue;
      if (!metadata.isFile() || !ownedByThisAccount(metadata.uid)) {
        refused.push(path);
        continue;
      }
      if (!apply || removed(path, refused, () => unlinkSync(path))) count += 1;
    }
  }
  return count;
}

/** When `directory` or anything directly in it was last written, by `lstat`. */
function newestChange(directory: string): number {
  let newest = lstatSync(directory).mtimeMs;
  for (const name of readdirSync(directory)) {
    const metadata = lstatSync(join(directory, name), { throwIfNoEntry: false });
    if (metadata !== undefined) newest = Math.max(newest, metadata.mtimeMs);
  }
  return newest;
}

function editorLeftovers(
  runtime: ICliRuntimeContext,
  temporaryDirectory: string,
  names: readonly string[],
  options: ILeftoverOptions,
  refused: string[],
): { readonly removed: number; readonly recent: number } {
  const prefix = runtime.config.identity.editorTemporaryDirectoryPrefix;
  const pattern = new RegExp(
    `^${prefix.replace(REGEXP_SPECIAL_CHARACTERS, '\\$&')}${MKDTEMP_SUFFIX}$`,
    'u',
  );
  const now = (options.now ?? Date.now)();
  let idle = 0;
  let recent = 0;
  for (const name of names) {
    if (!pattern.test(name)) continue;
    const path = join(temporaryDirectory, name);
    const isDirectory = realDirectory(path);
    if (isDirectory !== true) {
      if (isDirectory === false) refused.push(path);
      continue;
    }
    let changed: number;
    try {
      changed = newestChange(path);
    } catch {
      refused.push(path); // allow-fallback: one whose age cannot be read is reported, never removed.
      continue;
    }
    if (now - changed <= EDITOR_IDLE_MS) {
      recent += 1;
      continue;
    }
    const remove = (): void => rmSync(path, { recursive: true, force: true });
    if (!options.apply || removed(path, refused, remove)) idle += 1;
  }
  return { removed: idle, recent };
}

function sdkSpillDirectories(temporaryDirectory: string, names: readonly string[], refused: string[]): string[] {
  const directories: string[] = [];
  for (const name of names) {
    if (!name.startsWith(SDK_SPILL_PREFIX)) continue;
    const path = join(temporaryDirectory, name);
    if (realDirectory(path) === true) directories.push(path);
    else refused.push(path);
  }
  return directories;
}

/** The scratch directories of gone processes, by the owner record each holds; removed only with `apply`. */
function deadProcessDirectories(runtime: ICliRuntimeContext, apply: boolean): number {
  const { spill, editor, ephemeralCheckpoints } = runtime.layout.userPaths;
  const editorPrefix = basename(runtime.vocabulary.editorTemporaryDirectoryPrefix);
  if (!apply) {
    const scoped: ReadonlyArray<readonly [string, string]> = [
      [spill, SDK_SPILL_PREFIX],
      [editor, editorPrefix],
      [ephemeralCheckpoints, EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX],
    ];
    let gone = 0;
    for (const [parent, prefix] of scoped) {
      gone += inspectProcessScopedDirectories(parent, prefix).filter(
        (entry) => entry.liveness === 'gone',
      ).length;
    }
    return gone;
  }
  return (
    sweepStaleToolResultSpillDirectories(spill).length +
    sweepStaleProcessScopedDirectories(editor, editorPrefix).length +
    sweepStaleProcessScopedDirectories(ephemeralCheckpoints, EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX)
      .length
  );
}

/** Finds, and with `apply` removes, the leftovers the module documentation describes. */
export function sweepMigrationLeftovers(
  runtime: ICliRuntimeContext,
  options: ILeftoverOptions,
): ILeftovers {
  const temporaryDirectory = options.temporaryDirectory ?? tmpdir();
  const refused: string[] = [];
  const handoffFiles = handoffLeftovers(runtime, options.apply, refused);
  let names: string[] = [];
  if (realDirectory(temporaryDirectory) === true) {
    names = namesIn(temporaryDirectory, refused) ?? [];
  } else {
    refused.push(temporaryDirectory);
  }
  const editor = editorLeftovers(runtime, temporaryDirectory, names, options, refused);
  return {
    temporaryDirectory,
    handoffFiles,
    editorDirectories: editor.removed,
    recentEditorDirectories: editor.recent,
    deadProcessDirectories: deadProcessDirectories(runtime, options.apply),
    sdkSpillDirectories: sdkSpillDirectories(temporaryDirectory, names, refused),
    refused,
  };
}
