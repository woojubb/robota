/**
 * Sealing in place the edit checkpoints a trusted project kept in plaintext, for a host migrating its
 * state once it seals. Read and written through the project's runtime-minted `checkpoints`
 * storage, so only as the store itself would.
 *
 * A sealing store reads a plain checkpoint only below every sealed one (a plain manifest numbered
 * above a sealed one is damaged), so each session is migrated newest turn first: a turn still plain
 * mid-run is always below the sealed ones and stays readable. The descent stops at the first turn that
 * must stay plain — a pre-image that would be past the read limit once sealed, one kept under a name
 * that is not a checkpoint pre-image's, or one with another hard link (replacing it would leave the
 * plaintext under that name) — and that turn and every older one are left plain and reported. A plain
 * manifest that does not parse, names another place, or is numbered above the session's lowest sealed
 * one, is damaged either way, as the store reads it: it is reported, never sealed, and the descent goes
 * on below it.
 *
 * One turn, with the plain manifest as the authority that its pre-images are plain:
 *
 * 1. each pre-image is sealed to `files/NNNNNN.content.sealing` (replaced whole and flushed);
 * 2. the manifest is replaced sealed, recording each pre-image's size — the commit;
 * 3. each original is replaced with its staged file, which is then removed.
 *
 * A rerun decides from what opens: under a sealed manifest a pre-image that opens is done, and a plain
 * one is replaced by its staged file when that opens for its place. Nothing else vouches for plain
 * bytes found under a sealed manifest — the store reads them as damaged, and sealing them would make
 * whatever put them there restorable — so without a staged file that opens such a pre-image is
 * reported and left as it is. Under a plain manifest staged files are removed and the turn is redone.
 * Until a crashed turn is finished, a rewind that meets its plain pre-image says to run the migration
 * again.
 */
import { basename, dirname } from 'node:path';

import {
  isArtifactLockedError,
  isCurrentSealedArtifactBytes,
  isSealedArtifactBytes,
} from '@robota-sdk/agent-core';

import { SEALED_PREIMAGE_MAX_BYTES } from './edit-checkpoint-authority-io.js';
import { artifactContextOf } from './edit-checkpoint-sealed-state.js';
import {
  MANIFEST_FILE,
  SNAPSHOT_DIR,
  STAGED_PREIMAGE_SUFFIX,
  resolveContainedSnapshotPath,
  safePathSegment,
  sequenceOfDirectory,
} from './edit-checkpoint-store-helpers.js';
import { assertWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import { MAX_PROJECT_READ_BYTES } from '../workspace-trust/project-reader-path.js';
import {
  projectStateFileHardLinked,
  readCappedProjectStateFile,
} from '../workspace-trust/project-state-replacement.js';
import { sweepWorkspaceProjectStateTemporaries } from '../workspace-trust/project-state-storage.js';

import type { IEditCheckpointManifest } from './edit-checkpoint-types.js';
import type { IWorkspaceProjectStateStorage } from '../workspace-trust/index.js';
import type { IArtifactContext, IArtifactSealer } from '@robota-sdk/agent-core';

const PURPOSE = 'migrate project edit checkpoints';
const PREIMAGE_NAME = /^\d+\.content$/u;

export interface IMigrateEditCheckpointsOptions {
  /** Seals what is plain and opens what is sealed; the keys must be unlocked. */
  readonly sealer: IArtifactSealer;
  /** `false` plans: everything is read and counted exactly as a run would, and nothing is written. */
  readonly apply: boolean;
  /** Runs before each manifest replace (a turn's commit); throwing stops the migration there. */
  readonly beforeCommit?: () => void;
  /**
   * Also removes the temp files crashed replaces left; leave it off while another writer may be running.
   * Off, they are still counted in `staleTemporaries` and left where they are.
   */
  readonly sweepTemporaries?: boolean;
  /**
   * When the migration started, in milliseconds by the filesystem's clock (its marker's time): a temp
   * file is also judged stale against it, so one in a directory nothing changed in since is found.
   */
  readonly migrationStartedAt?: number;
}

/** Why a turn, and every older turn of its session, was left plain. */
export type TEditCheckpointKeptPlainReason =
  /** A pre-image or the manifest would be past the read limit once sealed. */
  | 'over-cap'
  /** A pre-image is kept under a name that is not a checkpoint pre-image's, or as a link. */
  | 'snapshot-name'
  /** The manifest or a pre-image has another hard link, which a replace would leave plain. */
  | 'hard-linked';

/** What a migration of a project's edit checkpoints did, or (planning) would do. Paths are project-relative. */
export interface IEditCheckpointMigration {
  /** Plain turns sealed with their pre-images. */
  readonly turnsSealed: number;
  /** Pre-images sealed, those of finished turns included. */
  readonly preimagesSealed: number;
  /** Sealed turns a stopped migration left unfinished, finished. */
  readonly turnsFinished: number;
  /** Turns already sealed with every pre-image. */
  readonly alreadySealed: number;
  /** Where a session's descent stopped, why, and how many older turns stayed plain with it. */
  readonly keptPlain: readonly {
    readonly turn: string;
    readonly reason: TEditCheckpointKeptPlainReason;
    readonly olderTurns: number;
  }[];
  /**
   * Plain manifests that do not parse, name another place, are past the read limit or are numbered
   * above a sealed one; turns that never wrote one; and plain pre-images under a sealed manifest with
   * no staged file that opens: damaged either way, left as they are.
   */
  readonly damaged: readonly string[];
  /** Sealed manifests or pre-images that do not open here, or that a newer build sealed. */
  readonly unopenable: readonly string[];
  /** Entries that are links or not what a checkpoint holds: never followed, left as they are. */
  readonly refused: readonly string[];
  /** Turns whose manifest changed while being sealed: left for the next run. */
  readonly changed: readonly string[];
  /** Stale temp files found: removed (or to remove) with `sweepTemporaries`, else left where they are. */
  readonly staleTemporaries: number;
}

interface IMutableCheckpointMigration {
  turnsSealed: number;
  preimagesSealed: number;
  turnsFinished: number;
  alreadySealed: number;
  keptPlain: { turn: string; reason: TEditCheckpointKeptPlainReason; olderTurns: number }[];
  damaged: string[];
  unopenable: string[];
  refused: string[];
  changed: string[];
  staleTemporaries: number;
}

/** What one turn came to: done one way or another (`next`), or the end of the session's descent. */
type TTurnOutcome =
  | { readonly kind: 'next' }
  | { readonly kind: 'stop'; readonly reason: TEditCheckpointKeptPlainReason }
  | { readonly kind: 'changed' };

const NEXT: TTurnOutcome = Object.freeze({ kind: 'next' });

class CheckpointMigration {
  readonly result: IMutableCheckpointMigration = {
    turnsSealed: 0,
    preimagesSealed: 0,
    turnsFinished: 0,
    alreadySealed: 0,
    keptPlain: [],
    damaged: [],
    unopenable: [],
    refused: [],
    changed: [],
    staleTemporaries: 0,
  };

  constructor(
    private readonly storage: IWorkspaceProjectStateStorage,
    private readonly options: IMigrateEditCheckpointsOptions,
  ) {}

  run(): IEditCheckpointMigration {
    for (const entry of this.storage.listDirectory('', PURPOSE)) {
      if (entry.kind === 'directory') this.migrateSession(entry.name);
      else if (entry.kind !== 'file') this.result.refused.push(this.path(entry.name));
    }
    return this.result;
  }

  private path(relative: string): string {
    return this.storage.projectRelativePath(relative);
  }

  /** The bytes at `name`, `'over-cap'` past the read limit, `undefined` when it is gone. */
  private read(name: string): Uint8Array | 'over-cap' | undefined {
    return readCappedProjectStateFile(this.storage, name, PURPOSE);
  }

  private replace(name: string, content: Uint8Array): void {
    this.storage.replaceBytes(name, content, PURPOSE);
  }

  private opens(stored: Uint8Array, context: IArtifactContext): boolean {
    if (!isSealedArtifactBytes(stored) || !isCurrentSealedArtifactBytes(stored)) return false;
    try {
      this.options.sealer.openBytes(stored, context).fill(0);
      return true;
    } catch (error) {
      if (isArtifactLockedError(error)) throw error;
      return false;
    }
  }

  private sweep(directory: string): void {
    this.result.staleTemporaries += sweepWorkspaceProjectStateTemporaries(
      this.storage,
      directory,
      this.options.apply && this.options.sweepTemporaries === true,
      this.options.migrationStartedAt,
    );
  }

  /** Whether the regular file at `name` has another hard link. */
  private hardLinked(name: string): boolean {
    return projectStateFileHardLinked(this.storage, name);
  }

  /** Newest turn first, as the module documentation describes. */
  private migrateSession(session: string): void {
    const turns = this.storage
      .listDirectory(session, PURPOSE)
      .filter((entry) => entry.kind === 'directory')
      .map((entry) => ({ name: entry.name, sequence: sequenceOfDirectory(entry.name) }))
      .filter((turn): turn is { name: string; sequence: number } => turn.sequence !== undefined)
      .sort((left, right) => right.sequence - left.sequence);
    const lowestSealed = this.lowestSealedSequence(session, turns);
    let stopped: IMutableCheckpointMigration['keptPlain'][number] | undefined;
    for (const turn of turns) {
      if (stopped !== undefined) {
        stopped.olderTurns += 1;
        continue;
      }
      const outcome = this.migrateTurn(session, turn.name, turn.sequence, lowestSealed);
      if (outcome.kind === 'next') continue;
      if (outcome.kind === 'changed') return;
      stopped = {
        turn: this.path(`${session}/${turn.name}`),
        reason: outcome.reason,
        olderTurns: 0,
      };
      this.result.keptPlain.push(stopped);
    }
  }

  /**
   * The lowest number among the session's sealed manifests, as a sealing store finds it (framing
   * alone, whether or not it opens); infinity when none is sealed.
   */
  private lowestSealedSequence(
    session: string,
    turns: readonly { readonly name: string; readonly sequence: number }[],
  ): number {
    let lowest = Number.POSITIVE_INFINITY;
    for (const turn of turns) {
      const manifestName = `${session}/${turn.name}/${MANIFEST_FILE}`;
      const isFile = this.storage
        .listDirectory(`${session}/${turn.name}`, PURPOSE)
        .some((entry) => entry.name === MANIFEST_FILE && entry.kind === 'file');
      if (!isFile) continue;
      const stored = this.read(manifestName);
      if (stored instanceof Uint8Array && isSealedArtifactBytes(stored)) {
        lowest = Math.min(lowest, turn.sequence);
      }
    }
    return lowest;
  }

  private migrateTurn(
    session: string,
    turn: string,
    sequence: number,
    lowestSealed: number,
  ): TTurnOutcome {
    const turnDirectory = `${session}/${turn}`;
    const manifestName = `${turnDirectory}/${MANIFEST_FILE}`;
    const entries = this.storage.listDirectory(turnDirectory, PURPOSE);
    const manifestEntry = entries.find((entry) => entry.name === MANIFEST_FILE);
    if (manifestEntry === undefined) {
      // A turn that never wrote its manifest is no checkpoint, and what it captured is never read.
      if (entries.length > 0) this.result.damaged.push(this.path(turnDirectory));
      return NEXT;
    }
    const manifestContext = artifactContextOf(manifestName);
    if (manifestEntry.kind !== 'file' || manifestContext === undefined) {
      this.result.refused.push(this.path(manifestName));
      return NEXT;
    }
    const stored = this.read(manifestName);
    if (stored === undefined) return NEXT;
    if (stored === 'over-cap') {
      this.result.damaged.push(this.path(manifestName));
      return NEXT;
    }
    if (!isSealedArtifactBytes(stored) && sequence > lowestSealed) {
      // Read as damaged by a sealing store: a store that seals never writes a plain manifest there.
      this.result.damaged.push(this.path(manifestName));
      return NEXT;
    }
    const outcome = isSealedArtifactBytes(stored)
      ? this.finishSealedTurn(turnDirectory, manifestName, stored, manifestContext)
      : this.sealPlainTurn(session, turn, sequence, manifestName, stored, manifestContext);
    this.sweep(turnDirectory);
    this.sweep(`${turnDirectory}/${SNAPSHOT_DIR}`);
    return outcome;
  }

  /**
   * The pre-image and staged names in a turn's `files/` directory, and the pre-image names that are
   * links or not regular files (refused, never read).
   */
  private snapshotFiles(turnDirectory: string): {
    readonly preimages: Set<string>;
    readonly staged: Set<string>;
    readonly refused: Set<string>;
  } {
    const directory = `${turnDirectory}/${SNAPSHOT_DIR}`;
    const preimages = new Set<string>();
    const staged = new Set<string>();
    const refused = new Set<string>();
    for (const entry of this.storage.listDirectory(directory, PURPOSE)) {
      const base = entry.name.endsWith(STAGED_PREIMAGE_SUFFIX)
        ? entry.name.slice(0, -STAGED_PREIMAGE_SUFFIX.length)
        : entry.name;
      if (!PREIMAGE_NAME.test(base)) continue;
      if (entry.kind !== 'file') {
        this.result.refused.push(this.path(`${directory}/${entry.name}`));
        if (base === entry.name) refused.add(base);
        continue;
      }
      (base === entry.name ? preimages : staged).add(base);
    }
    return { preimages, staged, refused };
  }

  /** A sealed manifest: finishes what a stopped migration left of its turn. */
  private finishSealedTurn(
    turnDirectory: string,
    manifestName: string,
    stored: Uint8Array,
    manifestContext: IArtifactContext,
  ): TTurnOutcome {
    if (!this.opens(stored, manifestContext)) {
      this.result.unopenable.push(this.path(manifestName));
      return NEXT;
    }
    const { preimages, staged } = this.snapshotFiles(turnDirectory);
    let finished = 0;
    for (const name of new Set([...preimages, ...staged])) {
      const preimageName = `${turnDirectory}/${SNAPSHOT_DIR}/${name}`;
      const stagedName = `${preimageName}${STAGED_PREIMAGE_SUFFIX}`;
      const context = artifactContextOf(preimageName) as IArtifactContext;
      const original = this.read(preimageName);
      if (original instanceof Uint8Array && isSealedArtifactBytes(original)) {
        if (!this.opens(original, context)) this.result.unopenable.push(this.path(preimageName));
        else if (staged.has(name) && this.options.apply) {
          this.storage.deleteFile(stagedName, PURPOSE);
        }
        continue;
      }
      if (original === 'over-cap') {
        this.result.unopenable.push(this.path(preimageName));
        continue;
      }
      const stagedBytes = staged.has(name) ? this.read(stagedName) : undefined;
      if (!(stagedBytes instanceof Uint8Array && this.opens(stagedBytes, context))) {
        if (original instanceof Uint8Array) {
          // Plain bytes under a sealed manifest that no staged file vouches for: damaged, as the store reads them.
          this.result.damaged.push(this.path(preimageName));
        } else if (staged.has(name) && this.options.apply) {
          // Nothing to finish and nothing that opens: a staged file left torn by a crash goes.
          this.storage.deleteFile(stagedName, PURPOSE);
        }
        continue;
      }
      if (original instanceof Uint8Array && this.hardLinked(preimageName)) {
        this.result.refused.push(this.path(preimageName));
        continue;
      }
      finished += 1;
      if (!this.options.apply) continue;
      this.replace(preimageName, stagedBytes);
      this.storage.deleteFile(stagedName, PURPOSE);
    }
    if (finished === 0) {
      this.result.alreadySealed += 1;
    } else {
      this.result.turnsFinished += 1;
      this.result.preimagesSealed += finished;
    }
    return NEXT;
  }

  /** A plain manifest: seals the turn in the three steps the module documentation lists. */
  private sealPlainTurn(
    session: string,
    turn: string,
    sequence: number,
    manifestName: string,
    stored: Uint8Array,
    manifestContext: IArtifactContext,
  ): TTurnOutcome {
    const manifest = parseManifest(stored, session, turn, sequence);
    if (manifest === undefined) {
      this.result.damaged.push(this.path(manifestName));
      return NEXT;
    }
    if (this.hardLinked(manifestName)) {
      this.result.refused.push(this.path(manifestName));
      return { kind: 'stop', reason: 'hard-linked' };
    }
    const turnDirectory = `${session}/${turn}`;
    const filesDirectory = `${turnDirectory}/${SNAPSHOT_DIR}`;
    const { preimages, staged, refused } = this.snapshotFiles(turnDirectory);
    // Every pre-image the manifest names must be one this turn's place can seal.
    const named = new Set<string>();
    for (const record of manifest.files) {
      if (!record.existed || record.snapshotFile === undefined) continue;
      let snapshotPath: string;
      try {
        snapshotPath = resolveContainedSnapshotPath(turnDirectory, record.snapshotFile);
      } catch {
        // allow-fallback: a name that leaves the turn is no pre-image a sealed place can hold.
        return { kind: 'stop', reason: 'snapshot-name' };
      }
      const name = basename(snapshotPath);
      if (
        dirname(snapshotPath) !== filesDirectory ||
        !PREIMAGE_NAME.test(name) ||
        refused.has(name)
      ) {
        return { kind: 'stop', reason: 'snapshot-name' };
      }
      named.add(name);
    }
    const plain = new Map<string, Uint8Array>();
    for (const name of new Set([...named, ...preimages])) {
      const bytes = this.read(`${filesDirectory}/${name}`);
      if (bytes === 'over-cap') return { kind: 'stop', reason: 'over-cap' };
      if (bytes === undefined) continue;
      if (bytes.byteLength > SEALED_PREIMAGE_MAX_BYTES) return { kind: 'stop', reason: 'over-cap' };
      if (this.hardLinked(`${filesDirectory}/${name}`)) {
        this.result.refused.push(this.path(`${filesDirectory}/${name}`));
        return { kind: 'stop', reason: 'hard-linked' };
      }
      plain.set(name, bytes);
    }
    const files = manifest.files.map((record) => {
      const name = record.snapshotFile === undefined ? undefined : basename(record.snapshotFile);
      const bytes = name === undefined ? undefined : plain.get(name);
      return record.existed && bytes !== undefined && named.has(name as string)
        ? { ...record, byteLength: bytes.byteLength }
        : record;
    });
    const sealedManifest = this.options.sealer.sealBytes(
      Buffer.from(JSON.stringify({ ...manifest, files }, null, 2), 'utf8'),
      manifestContext,
    );
    if (sealedManifest.byteLength > MAX_PROJECT_READ_BYTES) {
      return { kind: 'stop', reason: 'over-cap' };
    }
    if (!this.options.apply) {
      this.result.turnsSealed += 1;
      this.result.preimagesSealed += plain.size;
      return NEXT;
    }
    // Staged files under a plain manifest are a stopped run's, never this one's: they go first.
    for (const name of staged) {
      this.storage.deleteFile(`${filesDirectory}/${name}${STAGED_PREIMAGE_SUFFIX}`, PURPOSE);
    }
    const sealed = new Map<string, Uint8Array>();
    for (const [name, bytes] of plain) {
      const preimageName = `${filesDirectory}/${name}`;
      const content = this.options.sealer.sealBytes(
        bytes,
        artifactContextOf(preimageName) as IArtifactContext,
      );
      this.replace(`${preimageName}${STAGED_PREIMAGE_SUFFIX}`, content);
      sealed.set(name, content);
    }
    this.options.beforeCommit?.();
    const now = this.read(manifestName);
    if (!(now instanceof Uint8Array) || !Buffer.from(now).equals(Buffer.from(stored))) {
      this.result.changed.push(this.path(manifestName));
      return { kind: 'changed' };
    }
    this.replace(manifestName, sealedManifest);
    for (const [name, content] of sealed) {
      const preimageName = `${filesDirectory}/${name}`;
      this.replace(preimageName, content);
      this.storage.deleteFile(`${preimageName}${STAGED_PREIMAGE_SUFFIX}`, PURPOSE);
    }
    this.result.turnsSealed += 1;
    this.result.preimagesSealed += sealed.size;
    return NEXT;
  }
}

/** A plain manifest that parses and names the place it was read from; `undefined` otherwise. */
function parseManifest(
  stored: Uint8Array,
  session: string,
  turn: string,
  sequence: number,
): IEditCheckpointManifest | undefined {
  let value: unknown;
  try {
    value = JSON.parse(Buffer.from(stored).toString('utf8'));
  } catch {
    // allow-fallback: a manifest that does not parse is a damaged checkpoint, reported as one.
    return undefined;
  }
  if (typeof value !== 'object' || value === null) return undefined;
  const manifest = value as Partial<IEditCheckpointManifest>;
  return manifest.id === turn &&
    manifest.sequence === sequence &&
    typeof manifest.sessionId === 'string' &&
    safePathSegment(manifest.sessionId) === session &&
    Array.isArray(manifest.files)
    ? (manifest as IEditCheckpointManifest)
    : undefined;
}

/**
 * Seals the plain edit checkpoints of a project's `checkpoints` storage as the module documentation
 * describes.
 */
export function migrateWorkspaceEditCheckpoints(
  storage: IWorkspaceProjectStateStorage,
  options: IMigrateEditCheckpointsOptions,
): IEditCheckpointMigration {
  const accepted = assertWorkspaceProjectStateStorage(storage);
  if (accepted.namespace !== 'checkpoints') {
    throw new Error('Migrating edit checkpoints requires the checkpoints state namespace.');
  }
  return new CheckpointMigration(accepted, options).run();
}
