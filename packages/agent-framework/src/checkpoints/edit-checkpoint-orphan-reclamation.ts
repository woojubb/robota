import { join } from 'node:path';

import { MANIFEST_FILE, sequenceOfDirectory } from './edit-checkpoint-store-helpers.js';

import type { IEditCheckpointStateStorage } from './edit-checkpoint-state-storage.js';
import type { IProcessMarkerHandle } from '@robota-sdk/agent-core';

/** How many times one orphan's removal is called while it answers `partial` before it is left. */
export const ORPHAN_REMOVAL_ATTEMPTS = 4;
/** The time one reclamation may spend removing, so it never holds up the turn that runs it. */
export const ORPHAN_RECLAMATION_MS = 1_000;

const PURPOSE = 'reclaim abandoned edit checkpoint directories';

/**
 * Removes the turn directories of `sessionDir` that hold no manifest: the claims of a writer that
 * stopped before finalizing, empty or holding pre-images no checkpoint names. Only the holder of the
 * session's writer lease claims turn directories and writes manifests, so while `lease` is held no
 * manifest-less directory belongs to a live writer, and each removal runs under the lease's guard.
 *
 * A directory counts as an orphan only when it is a real directory with a canonical turn name and its
 * listing shows no entry named like a manifest, of any kind: nothing is read or opened, so a manifest
 * that is damaged or sealed with locked keys keeps its checkpoint. A directory whose listing is
 * refused may hold one and is kept, and so is anything else under a turn name (a link, FIFO or file
 * is no crashed claim). State that cannot remove directories reclaims nothing. Errors propagate; the
 * caller decides that reclamation never fails a turn.
 */
export function reclaimOrphanTurns(
  state: IEditCheckpointStateStorage,
  sessionDir: string,
  lease: IProcessMarkerHandle,
  now: () => number = Date.now,
): void {
  const remove = state.removeDirectory?.bind(state);
  if (remove === undefined) return;
  const deadline = now() + ORPHAN_RECLAMATION_MS;
  for (const entry of state.listDirectory(sessionDir, PURPOSE)) {
    if (entry.kind !== 'directory' || sequenceOfDirectory(entry.name) === undefined) continue;
    const turn = join(sessionDir, entry.name);
    if (!provablyWithoutManifest(state, turn)) continue;
    for (let attempt = 0; attempt < ORPHAN_REMOVAL_ATTEMPTS; attempt += 1) {
      const maxMs = deadline - now();
      if (maxMs <= 0) return;
      const guarded = lease.withGuard(() => remove(turn, PURPOSE, { maxMs }));
      if (guarded.status !== 'ran') return;
      if (guarded.value.status !== 'partial') break;
    }
  }
}

function provablyWithoutManifest(state: IEditCheckpointStateStorage, turn: string): boolean {
  try {
    return !state.listDirectory(turn, PURPOSE).some((entry) => entry.name === MANIFEST_FILE);
  } catch {
    // allow-fallback: a directory that refuses its listing may hold a manifest, so it is kept.
    return false;
  }
}
