/**
 * Scratch a run keeps in directories of its own, inside the product state root rather than the shared
 * temporary directory: spilled tool results, the `/editor` buffer, and — when the run persists no
 * session — the edit checkpoints that keep `/rewind` working. Each directory is owner-only, records the
 * process that owns it, and is removed when that process ends; one left by a process that was killed
 * outright is removed by the next start.
 */
import { basename } from 'node:path';

import {
  ensureOwnerOnlyDirectory,
  sweepStaleProcessScopedDirectories,
} from '@robota-sdk/agent-core/node';
import { sweepStaleToolResultSpillDirectories } from '@robota-sdk/agent-framework';

import type { ICliRuntimeContext } from '../product/runtime-context.js';

/** The name every ephemeral edit-checkpoint directory carries before its owner's pid. */
export const EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX = 'checkpoints-';

/** The owner-only parent a run's spill directory is created in. */
export function prepareSpillParentDirectory(runtime: ICliRuntimeContext): string {
  const parent = runtime.layout.userPaths.spill;
  ensureOwnerOnlyDirectory(parent);
  return parent;
}

/** Remove what processes that no longer exist left behind, before this run makes its own. */
export function sweepStaleEphemeralState(runtime: ICliRuntimeContext): void {
  const { spill, editor, ephemeralCheckpoints } = runtime.layout.userPaths;
  sweepStaleToolResultSpillDirectories(spill);
  sweepStaleProcessScopedDirectories(
    editor,
    basename(runtime.vocabulary.editorTemporaryDirectoryPrefix),
  );
  sweepStaleProcessScopedDirectories(ephemeralCheckpoints, EPHEMERAL_CHECKPOINT_DIRECTORY_PREFIX);
}
