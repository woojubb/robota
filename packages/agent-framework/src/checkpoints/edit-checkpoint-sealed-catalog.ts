/**
 * How a store whose state seals finds and reads its checkpoints without trusting what a file says:
 * a checkpoint is a canonically named turn directory holding a `manifest.json`, found by listing
 * alone, and its manifest is believed only where it agrees with that place. Every read ends in one
 * of four outcomes — opened, locked, damaged or written by a newer build — so one file that does not
 * open, or cannot be read at all, never fails a listing and is never mistaken for one that is absent.
 */
import { basename, dirname, join } from 'node:path';

import {
  isArtifactCorruptError,
  isArtifactLockedError,
  isSealedArtifactBytes,
} from '@robota-sdk/agent-core';

import { refusingCheckpoint } from './edit-checkpoint-inspection.js';
import {
  EditCheckpointNumberingExhaustedError,
  EditCheckpointUnreadableError,
  EditCheckpointsLockedError,
} from './edit-checkpoint-errors.js';
import { EditCheckpointNewerFramingError } from './edit-checkpoint-sealed-state.js';
import {
  MANIFEST_FILE,
  MAX_CHECKPOINT_SEQUENCE,
  SNAPSHOT_DIR,
  STAGED_PREIMAGE_SUFFIX,
  migrateManifestsToTree,
  resolveContainedSnapshotPath,
  sequenceOfDirectory,
} from './edit-checkpoint-store-helpers.js';
import { WorkspaceAuthorityRequiredError } from '../workspace-trust/index.js';

import type { EditCheckpointAuthorityIO } from './edit-checkpoint-authority-io.js';
import type {
  IEditCheckpointCatalog,
  IReadableCheckpoints,
  IRestorePlanEntry,
} from './edit-checkpoint-catalog.js';
import type { TEditCheckpointUnreadableReason } from './edit-checkpoint-errors.js';
import type {
  IEditCheckpointSnapshotState,
  IUnreadableEditCheckpoint,
} from './edit-checkpoint-inspection.js';
import type { SealedEditCheckpointState } from './edit-checkpoint-sealed-state.js';
import type {
  IEditCheckpointFileRecord,
  IEditCheckpointManifest,
} from './edit-checkpoint-types.js';
import type { TArtifactLockedReason } from '@robota-sdk/agent-core';
import type { IWorkspaceDirectoryEntry } from '../workspace-trust/index.js';

/**
 * A turn directory that holds a manifest, or refuses the listing that would tell: a checkpoint,
 * whether or not its manifest opens.
 */
interface IEditCheckpointPlace {
  readonly id: string;
  readonly sequence: number;
  /** Whether the listing showed `manifest.json` as a regular file; anything else is damaged. */
  readonly manifestIsFile: boolean;
}

/** Why a checkpoint file did not open or could not be read; never a defect, which is rethrown. */
type TUnopened =
  | { readonly status: 'locked'; readonly reason: TArtifactLockedReason }
  | { readonly status: TEditCheckpointUnreadableReason };

type TEditCheckpointReadOutcome =
  | {
      readonly status: 'open';
      readonly place: IEditCheckpointPlace;
      readonly manifest: IEditCheckpointManifest;
      /** A sealed manifest's pre-images must be sealed; a plain one's are read as stored. */
      readonly sealed: boolean;
    }
  | (TUnopened & { readonly place: IEditCheckpointPlace });

/** System errors that describe the file itself; others (too many open files, I/O) do not. */
const PER_FILE_SYSTEM_CODES = new Set(['EACCES', 'EPERM', 'ELOOP', 'EISDIR', 'ENOTDIR', 'EINVAL']);

/**
 * A read the system or the reader refused for this one file — no permission, a link, not a regular
 * file, past the read limit — which says the file is damaged, unlike a defect in this code or a
 * system error that says nothing of the file.
 */
function isPerFileRefusal(error: unknown): boolean {
  if (error instanceof WorkspaceAuthorityRequiredError) return true;
  if (!(error instanceof Error)) return false;
  const { code, errno, syscall } = error as NodeJS.ErrnoException;
  return (
    typeof errno === 'number' &&
    typeof syscall === 'string' &&
    PER_FILE_SYSTEM_CODES.has(code ?? '')
  );
}

/** What a checkpoint file that failed to read or open comes to; anything else is rethrown. */
function unopened(error: unknown): TUnopened {
  if (isArtifactLockedError(error)) {
    const reason = (error as { readonly reason?: unknown }).reason;
    return { status: 'locked', reason: reason === 'no-keys' ? 'no-keys' : 'locked' };
  }
  if (error instanceof EditCheckpointNewerFramingError) return { status: 'newer' };
  if (isArtifactCorruptError(error) || isPerFileRefusal(error)) return { status: 'damaged' };
  throw error;
}

/** Whether `value` is a manifest that names the place it was read from, and the session. */
function agreesWithPlace(
  value: unknown,
  place: IEditCheckpointPlace,
  sessionId: string,
): value is IEditCheckpointManifest {
  if (typeof value !== 'object' || value === null) return false;
  const manifest = value as Partial<IEditCheckpointManifest>;
  return (
    manifest.id === place.id &&
    manifest.sequence === place.sequence &&
    manifest.sessionId === sessionId &&
    Array.isArray(manifest.files)
  );
}

/** A recorded size worth believing: a non-negative whole number of bytes. */
function isRecordedSize(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;
}

/**
 * The indexes of the entries that decide what each file of `plan` ends as — its last entry, since a
 * plan is written in order — in plan order.
 */
function decidingEntries(plan: readonly IRestorePlanEntry[]): number[] {
  const last = new Map<string, number>();
  plan.forEach((entry, index) => last.set(entry.projectPath, index));
  return [...last.values()].sort((a, b) => a - b);
}

export class SealedEditCheckpointCatalog implements IEditCheckpointCatalog {
  constructor(
    private readonly state: SealedEditCheckpointState,
    private readonly io: EditCheckpointAuthorityIO,
  ) {}

  /**
   * Numbered from directory listings alone — the highest turn directory holding a manifest, whether
   * or not it opens, or refusing its listing — so a store that cannot open its manifests never
   * numbers onto an earlier checkpoint's pre-images.
   */
  next(sessionDir: string): { readonly sequence: number; readonly latestId: string | undefined } {
    const latest = this.places(sessionDir).at(-1);
    const sequence = (latest?.sequence ?? 0) + 1;
    if (sequence > MAX_CHECKPOINT_SEQUENCE) throw new EditCheckpointNumberingExhaustedError();
    return { sequence, latestId: latest?.id };
  }

  /**
   * Each checkpoint read on its own: one locked refuses the read (an unlock would change the
   * answer), and one damaged or written by a newer build is left out and reported as such.
   */
  read(sessionId: string, sessionDir: string): IReadableCheckpoints {
    const outcomes = this.readAll(sessionId, sessionDir);
    const locked = outcomes.flatMap((outcome) =>
      outcome.status === 'locked' ? [outcome.reason] : [],
    );
    if (locked.length > 0) {
      throw new EditCheckpointsLockedError(locked.includes('locked') ? 'locked' : 'no-keys');
    }
    const manifests: IEditCheckpointManifest[] = [];
    const sealedIds = new Set<string>();
    const unreadable: IUnreadableEditCheckpoint[] = [];
    for (const outcome of outcomes) {
      if (outcome.status === 'open') {
        manifests.push(outcome.manifest);
        if (outcome.sealed) sealedIds.add(outcome.place.id);
      } else if (outcome.status !== 'locked') {
        unreadable.push({
          id: outcome.place.id,
          sequence: outcome.place.sequence,
          reason: outcome.status,
        });
      }
    }
    return { manifests: migrateManifestsToTree(manifests), sealedIds, unreadable };
  }

  /** A directory check: the checkpoint's directory holds a manifest file. Nothing is opened. */
  pointsAt(sessionDir: string, checkpointId: string): boolean {
    return this.placeOf(sessionDir, checkpointId)?.manifestIsFile === true;
  }

  /**
   * Opens no pre-image it need not: whether one is there comes from one listing of the checkpoint's
   * files, and its size from the size its manifest recorded. Only a manifest that recorded none (one
   * written before checkpoints sealed) has its pre-images read.
   */
  inspector(
    target: IEditCheckpointManifest,
    checkpointDir: string,
    checkpoints: IReadableCheckpoints,
  ): (file: IEditCheckpointFileRecord) => IEditCheckpointSnapshotState {
    const filesDir = join(checkpointDir, SNAPSHOT_DIR);
    const present = new Set(
      this.state
        .listDirectory(filesDir, 'inspect checkpoint snapshots')
        .filter((entry) => entry.kind === 'file')
        .map((entry) => entry.name),
    );
    return (file) => {
      if (file.snapshotFile === undefined) return { available: false };
      const snapshotPath = resolveContainedSnapshotPath(checkpointDir, file.snapshotFile);
      if (!file.existed || dirname(snapshotPath) !== filesDir) return { available: false };
      if (!present.has(basename(snapshotPath))) return { available: false };
      if (isRecordedSize(file.byteLength)) {
        return { available: true, sizeBytes: file.byteLength, recorded: true };
      }
      let preimage: Uint8Array | undefined;
      try {
        preimage = this.readPreimage(target.id, snapshotPath, checkpoints.sealedIds.has(target.id));
      } catch (error) {
        // allow-fallback: a pre-image that does not open is reported as unavailable.
        if (error instanceof EditCheckpointUnreadableError) return { available: false };
        throw error;
      }
      if (preimage === undefined) return { available: false };
      const sizeBytes = preimage.byteLength;
      preimage.fill(0);
      return { available: true, sizeBytes };
    };
  }

  /**
   * All or nothing: a range holding a checkpoint that does not open is refused naming it, and every
   * pre-image is opened before the first project write, so a failure leaves the project as it was.
   * Only the pre-image that decides what a file ends as is kept until it is written; every other one
   * is wiped as soon as it is verified.
   */
  restore(
    plan: readonly IRestorePlanEntry[],
    checkpoints: IReadableCheckpoints,
    target: IEditCheckpointManifest,
    assertWriter: () => void,
  ): number {
    const refusing = refusingCheckpoint(checkpoints.unreadable, target.sequence);
    if (refusing !== undefined) {
      throw new EditCheckpointUnreadableError(refusing.id, refusing.reason, { refused: true });
    }
    const deciding = decidingEntries(plan);
    const decides = new Set(deciding);
    const kept = new Map<number, Uint8Array>();
    try {
      plan.forEach((entry, index) => {
        if (!entry.record.existed) return;
        const preimage =
          entry.snapshotPath === undefined
            ? undefined
            : this.readPreimage(
                entry.checkpointId,
                entry.snapshotPath,
                checkpoints.sealedIds.has(entry.checkpointId),
              );
        if (preimage === undefined) {
          throw new EditCheckpointUnreadableError(entry.checkpointId, 'damaged', {
            part: 'pre-image',
            refused: true,
          });
        }
        if (decides.has(index)) kept.set(index, preimage);
        else preimage.fill(0);
      });
      for (const index of deciding) {
        assertWriter();
        this.io.restoreVerifiedFile(plan[index]!.record, kept.get(index));
      }
    } finally {
      for (const preimage of kept.values()) preimage.fill(0);
    }
    return plan.length;
  }

  /** The session's checkpoints by sequence, from directory listings alone: nothing is opened. */
  private places(sessionDir: string): IEditCheckpointPlace[] {
    const places: IEditCheckpointPlace[] = [];
    for (const entry of this.state.listDirectory(sessionDir, 'list checkpoint directories')) {
      if (entry.kind !== 'directory') continue;
      const place = this.placeOf(sessionDir, entry.name);
      if (place !== undefined) places.push(place);
    }
    return places.sort((a, b) => a.sequence - b.sequence);
  }

  /**
   * Checkpoint `id` when its directory holds a manifest; a listing, never a read of the manifest. A
   * directory that refuses its listing may hold one, so it is a damaged checkpoint keeping its number.
   */
  private placeOf(sessionDir: string, id: string): IEditCheckpointPlace | undefined {
    const sequence = sequenceOfDirectory(id);
    if (sequence === undefined) return undefined;
    let entries: readonly IWorkspaceDirectoryEntry[];
    try {
      entries = this.state.listDirectory(join(sessionDir, id), 'find checkpoint manifest');
    } catch (error) {
      if (isPerFileRefusal(error)) return { id, sequence, manifestIsFile: false };
      throw error;
    }
    const manifest = entries.find((entry) => entry.name === MANIFEST_FILE);
    return manifest === undefined
      ? undefined
      : { id, sequence, manifestIsFile: manifest.kind === 'file' };
  }

  /**
   * Every checkpoint of the session with what reading it came to, by sequence. A store that seals
   * never writes a plain manifest, so a plain one numbered after the first sealed manifest — or any
   * plain one in state that only ever sealed — was put there by someone else, and is damaged.
   */
  private readAll(sessionId: string, sessionDir: string): TEditCheckpointReadOutcome[] {
    const stored = this.places(sessionDir).map((place) => ({
      place,
      bytes: this.readManifestBytes(sessionDir, place),
    }));
    const firstSealed = this.state.sealedOnly
      ? 0
      : (stored.find(({ bytes }) => bytes instanceof Uint8Array && isSealedArtifactBytes(bytes))
          ?.place.sequence ?? Number.POSITIVE_INFINITY);
    return stored.map(({ place, bytes }) => {
      if (!(bytes instanceof Uint8Array)) return { ...bytes, place };
      const sealed = isSealedArtifactBytes(bytes);
      if (!sealed && place.sequence > firstSealed) return { status: 'damaged', place };
      return this.parse(sessionId, sessionDir, place, bytes, sealed);
    });
  }

  /** The manifest's bytes as stored, or why they could not be read. */
  private readManifestBytes(
    sessionDir: string,
    place: IEditCheckpointPlace,
  ): Uint8Array | TUnopened {
    if (!place.manifestIsFile) return { status: 'damaged' };
    try {
      return (
        this.state.readStoredBytes(
          join(sessionDir, place.id, MANIFEST_FILE),
          'load checkpoint manifest',
        ) ?? { status: 'damaged' }
      );
    } catch (error) {
      return unopened(error);
    }
  }

  private parse(
    sessionId: string,
    sessionDir: string,
    place: IEditCheckpointPlace,
    stored: Uint8Array,
    sealed: boolean,
  ): TEditCheckpointReadOutcome {
    let text: string;
    if (sealed) {
      let opened: Uint8Array;
      try {
        opened = this.state.openStoredBytes(join(sessionDir, place.id, MANIFEST_FILE), stored);
      } catch (error) {
        return { ...unopened(error), place };
      }
      text = Buffer.from(opened).toString('utf8');
      opened.fill(0);
    } else {
      text = Buffer.from(stored).toString('utf8');
    }
    let manifest: unknown;
    try {
      manifest = JSON.parse(text);
    } catch {
      // allow-fallback: a manifest that does not parse is a damaged checkpoint, counted as one.
      return { status: 'damaged', place };
    }
    return agreesWithPlace(manifest, place, sessionId)
      ? { status: 'open', place, manifest, sealed }
      : { status: 'damaged', place };
  }

  /**
   * A pre-image of checkpoint `checkpointId` at `path`, read as its manifest says — opened under a
   * sealed manifest, as stored under a plain one — or `undefined` when it is missing. Locked keys
   * refuse as locked; anything else that does not open or cannot be read refuses as a damaged (or
   * newer) pre-image of that checkpoint. A plain file under a sealed manifest is a migration left
   * unfinished only when its staged sealed copy opens, which a rerun swaps in; otherwise nothing
   * vouches for it, and it is damaged like any other.
   */
  private readPreimage(
    checkpointId: string,
    path: string,
    sealedManifest: boolean,
  ): Uint8Array | undefined {
    try {
      const stored = this.state.readStoredBytes(path, 'load checkpoint file preimage');
      if (stored === undefined || !sealedManifest) return stored;
      if (!isSealedArtifactBytes(stored)) {
        throw new EditCheckpointUnreadableError(checkpointId, 'damaged', {
          part: 'pre-image',
          refused: true,
          unfinishedMigration: this.stagedCopyOpens(path),
        });
      }
      return this.state.openStoredBytes(path, stored);
    } catch (error) {
      const outcome = unopened(error);
      if (outcome.status === 'locked') throw new EditCheckpointsLockedError(outcome.reason);
      throw new EditCheckpointUnreadableError(checkpointId, outcome.status, {
        part: 'pre-image',
        refused: true,
      });
    }
  }

  /** Whether the sealed copy a migration stages beside the pre-image at `path` opens for its place. */
  private stagedCopyOpens(path: string): boolean {
    try {
      const staged = this.state.readStoredBytes(
        `${path}${STAGED_PREIMAGE_SUFFIX}`,
        'load staged checkpoint file preimage',
      );
      if (staged === undefined) return false;
      this.state.openStoredBytes(path, staged).fill(0);
      return true;
    } catch {
      // allow-fallback: a staged copy that cannot be read or opened vouches for nothing.
      return false;
    }
  }
}
