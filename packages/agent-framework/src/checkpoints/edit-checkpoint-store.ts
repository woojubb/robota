import { join, relative, resolve, sep } from 'node:path';

import { CheckpointTree, assertSessionSealing } from '@robota-sdk/agent-session';

import { EditCheckpointAuthorityIO } from './edit-checkpoint-authority-io.js';
import { PlainEditCheckpointCatalog } from './edit-checkpoint-catalog.js';
import {
  EditCheckpointUnreadableError,
  EditCheckpointsLockedError,
} from './edit-checkpoint-errors.js';
import { buildEditCheckpointInspection } from './edit-checkpoint-inspection.js';
import { SealedEditCheckpointCatalog } from './edit-checkpoint-sealed-catalog.js';
import {
  SealedEditCheckpointState,
  createSealedEditCheckpointState,
} from './edit-checkpoint-sealed-state.js';
import {
  DEFAULT_BRANCH_ID,
  MANIFEST_FILE,
  SNAPSHOT_DIR,
  checkpointIdOf,
  checkpointTreeNodesOf,
  resolveContainedSnapshotPath,
  safePathSegment,
  toEditCheckpointSummary as toSummary,
} from './edit-checkpoint-store-helpers.js';
import { getWorkspaceProjectStateStorage } from '../workspace-trust/index.js';

import type {
  IEditCheckpointCatalog,
  IReadableCheckpoints,
  IRestorePlanEntry,
} from './edit-checkpoint-catalog.js';
import type { IEditCheckpointStateStorage } from './edit-checkpoint-state-storage.js';
import type {
  IEditCheckpointInspection,
  IEditCheckpointListing,
  IEditCheckpointManifest,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
  IEditCheckpointUnreadableCounts,
} from './edit-checkpoint-types.js';
import type {
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutation,
} from '../workspace-trust/index.js';
import type { TArtifactSealing } from '@robota-sdk/agent-core';
import type { IActiveBranchPointer } from '@robota-sdk/agent-interface-session';

const SNAPSHOT_PAD = 6;
/** SELFHOST-007: the default branch a session's checkpoints belong to. */
interface IActiveEditCheckpointTurn {
  manifest: IEditCheckpointManifest;
  dir: string;
  capturedPaths: Set<string>;
}

interface IEditCheckpointStoreOptions {
  authority: IWorkspaceProjectAuthority;
  mutation: IWorkspaceProjectMutation;
  /**
   * How the store keeps what it writes, required: `{ sealer }` seals every manifest and pre-image
   * bound to its session, turn and pre-image number, so one moved elsewhere does not open there, and
   * `'plain'` keeps them as they are. A host that seals states it for every store it builds.
   */
  sealing: TArtifactSealing;
  /**
   * Where manifests and file pre-images are kept, as a location only: state that does not seal by
   * itself. Absent, they live in the project's trusted checkpoint directory; a host that must leave
   * nothing in the project supplies state held elsewhere.
   */
  stateStorage?: IEditCheckpointStateStorage;
  /**
   * With a sealer: `stateStorage` never held a plain checkpoint (state made for one process), so a
   * plain manifest found in it can only have been planted and none is believed. Without it, a plain
   * manifest is believed only where it is numbered below every sealed one.
   */
  sealedOnly?: boolean;
  /**
   * Asked before each read a person makes of the checkpoints — listing, inspecting, restoring,
   * branching — which `true` refuses as locked. A host whose checkpoints seal passes its keys' lock
   * state, so locked means one thing for every store it reads conversations from, whichever key a
   * store seals with. Writes and the store's own bookkeeping are never refused.
   */
  keysLocked?: () => boolean;
  now?: () => Date;
}

export class EditCheckpointStore {
  private readonly cwd: string;
  private readonly authorityIO: EditCheckpointAuthorityIO;
  /** Sealed exactly when the state seals; every rule for sealed checkpoints goes through it. */
  private readonly catalog: IEditCheckpointCatalog;
  private readonly keysLocked: (() => boolean) | undefined;
  private readonly now: () => Date;
  private activeTurn: IActiveEditCheckpointTurn | null = null;
  /**
   * SELFHOST-007: per-session active branch HEAD (checkpoint id the next turn forks from). `null`
   * after a rollback through the root, so the next turn starts a fresh root line; no entry means
   * the session has no head yet and continues its latest checkpoint.
   */
  private readonly activeHead = new Map<string, string | null>();
  /** SELFHOST-007: per-session active branch id (default `'main'`; a fresh id after a fork). */
  private readonly activeBranch = new Map<string, string>();
  /** SELFHOST-007: monotonic fork counter for minting distinct branch ids. */
  private forkCounter = 0;

  constructor(options: IEditCheckpointStoreOptions) {
    assertSessionSealing(options.sealing);
    if (options.stateStorage?.seals === true) {
      throw new RangeError(
        'The store seals its checkpoint state itself; give it state that does not.',
      );
    }
    const state = createSealedEditCheckpointState(
      options.stateStorage ?? getWorkspaceProjectStateStorage(options.authority, 'checkpoints'),
      options.sealing,
      options.sealedOnly === true ? { sealedOnly: true } : {},
    );
    this.authorityIO = new EditCheckpointAuthorityIO(options.authority, options.mutation, state);
    this.catalog =
      state instanceof SealedEditCheckpointState
        ? new SealedEditCheckpointCatalog(state, this.authorityIO)
        : new PlainEditCheckpointCatalog(this.authorityIO);
    this.keysLocked = options.keysLocked;
    this.cwd = this.authorityIO.cwd;
    this.now = options.now ?? (() => new Date());
  }

  async beginTurn(input: IEditCheckpointTurnInput): Promise<IEditCheckpointSummary> {
    if (this.activeTurn) {
      await this.finalizeTurn();
    }

    // SELFHOST-007: the new checkpoint's parent is the active branch HEAD (the checkpoint the last
    // restore/rollback forked from, or the previous head). Falls back to the last checkpoint by
    // sequence for a fresh store. branchId groups the line (default 'main', a fresh id after a fork).
    const { nextSequence, parentId } = this.nextCheckpoint(input.sessionId);
    const id = checkpointIdOf(nextSequence);
    const dir = join(this.sessionDir(input.sessionId), id);
    const branchId = this.activeBranch.get(input.sessionId) ?? DEFAULT_BRANCH_ID;

    const manifest: IEditCheckpointManifest = {
      version: 2,
      id,
      sessionId: input.sessionId,
      sequence: nextSequence,
      prompt: input.prompt,
      createdAt: this.now().toISOString(),
      fileCount: 0,
      files: [],
      ...(parentId !== undefined ? { parentId } : {}),
      branchId,
    };

    this.activeTurn = {
      manifest,
      dir,
      capturedPaths: new Set<string>(),
    };

    return toSummary(manifest);
  }

  async captureFile(filePath: string): Promise<void> {
    if (!this.activeTurn) return;

    const originalPath = resolve(this.cwd, filePath);
    if (this.activeTurn.capturedPaths.has(originalPath)) return;
    const relativePath = relative(this.cwd, originalPath);
    const checkpointRoot = this.authorityIO.checkpointRootRelativePath;
    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      resolve(this.cwd, relativePath) !== originalPath ||
      (checkpointRoot !== undefined &&
        (relativePath === checkpointRoot || relativePath.startsWith(`${checkpointRoot}${sep}`)))
    ) {
      return;
    }

    const kind = this.authorityIO.inspectKind(relativePath);
    if (kind === 'link' || kind === 'directory' || kind === 'other') return;

    const snapshotFile = join(
      SNAPSHOT_DIR,
      `${String(this.activeTurn.manifest.files.length + 1).padStart(SNAPSHOT_PAD, '0')}.content`,
    );
    const record =
      kind === 'file'
        ? this.authorityIO.captureFile(
            originalPath,
            relativePath,
            join(this.activeTurn.dir, snapshotFile),
            snapshotFile,
          )
        : { originalPath, existed: false };
    this.activeTurn.manifest.files.push(record);
    this.activeTurn.manifest.fileCount = this.activeTurn.manifest.files.length;
    this.activeTurn.capturedPaths.add(originalPath);
  }

  /**
   * Writes the turn's manifest. Only then is the checkpoint the branch HEAD: a manifest that was
   * never written leaves the HEAD where it was, so the next turn, which takes the unwritten
   * checkpoint's number, never becomes its own parent.
   */
  async finalizeTurn(): Promise<IEditCheckpointSummary | undefined> {
    if (!this.activeTurn) return undefined;
    const active = this.activeTurn;
    this.activeTurn = null;
    this.writeManifest(active.dir, active.manifest);
    this.activeHead.set(active.manifest.sessionId, active.manifest.id);
    return toSummary(active.manifest);
  }

  list(sessionId: string): IEditCheckpointSummary[] {
    return this.listing(sessionId).checkpoints;
  }

  /** How many of the session's checkpoints `list` leaves out because they do not open. */
  countUnreadable(sessionId: string): IEditCheckpointUnreadableCounts {
    return this.listing(sessionId).unreadable;
  }

  /** What `list` and `countUnreadable` answer, from one read of the session's checkpoints. */
  listing(sessionId: string): IEditCheckpointListing {
    const { manifests, unreadable } = this.readable(sessionId);
    return {
      checkpoints: manifests.map(toSummary),
      unreadable: {
        damaged: unreadable.filter((checkpoint) => checkpoint.reason === 'damaged').length,
        newer: unreadable.filter((checkpoint) => checkpoint.reason === 'newer').length,
      },
    };
  }

  inspect(sessionId: string, checkpointId: string): IEditCheckpointInspection {
    const checkpoints = this.readable(sessionId);
    const target = this.requireTarget(checkpoints, checkpointId);

    return buildEditCheckpointInspection({
      cwd: this.cwd,
      target,
      manifests: checkpoints.manifests,
      unreadable: checkpoints.unreadable,
      inspectSnapshot: this.catalog.inspector(
        target,
        this.checkpointDir(sessionId, target.id),
        checkpoints,
      ),
    });
  }

  async restoreToCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<IEditCheckpointRestoreResult> {
    const checkpoints = this.readable(sessionId);
    const target = this.requireTarget(checkpoints, checkpointId);

    const later = checkpoints.manifests
      .filter((manifest) => manifest.sequence > target.sequence)
      .sort((a, b) => b.sequence - a.sequence);

    const restoredFileCount = this.catalog.restore(
      this.planRestore(sessionId, later),
      checkpoints,
      target,
    );

    // SELFHOST-007: NON-DESTRUCTIVE — the later checkpoints are NOT removed; they stay on disk as a
    // sibling branch (the abandoned future), reachable via the checkpoint tree. Instead of `rm`, we
    // fork: the active HEAD moves to the target and a fresh branch id is minted, so the NEXT turn
    // diverges from the target while the old line remains listable.
    this.forkFrom(sessionId, target.id);

    return {
      target: toSummary(target),
      restoredCheckpointCount: later.length,
      restoredFileCount,
      removedCheckpointCount: 0,
    };
  }

  /**
   * SELFHOST-007: move the active HEAD to `checkpointId` and start a fresh branch so the next turn
   * diverges (a sibling branch) instead of overwriting the abandoned future.
   */
  private forkFrom(sessionId: string, checkpointId: string | null): void {
    this.activeHead.set(sessionId, checkpointId);
    this.forkCounter += 1;
    this.activeBranch.set(sessionId, `branch-${this.forkCounter}`);
  }

  async rollbackThroughCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<IEditCheckpointRestoreResult> {
    const checkpoints = this.readable(sessionId);
    const target = this.requireTarget(checkpoints, checkpointId);

    const rollbackRange = checkpoints.manifests
      .filter((manifest) => manifest.sequence >= target.sequence)
      .sort((a, b) => b.sequence - a.sequence);

    const restoredFileCount = this.catalog.restore(
      this.planRestore(sessionId, rollbackRange),
      checkpoints,
      target,
    );

    // SELFHOST-007: NON-DESTRUCTIVE — rollback reverts THROUGH the target (inclusive) but keeps those
    // checkpoints on disk as a sibling branch. The active HEAD forks from the target's PARENT (the
    // point before the rolled-back range); an absent parent (target was the root) clears the head on
    // purpose, so the next turn starts a fresh root line instead of continuing the rolled-back one.
    this.forkFrom(sessionId, target.parentId ?? null);

    return {
      target: toSummary(target),
      restoredCheckpointCount: rollbackRange.length,
      restoredFileCount,
      removedCheckpointCount: 0,
    };
  }

  /**
   * Issue #2076: a manifest is mutable bytes on disk, so restore re-establishes containment for
   * EVERY entry — the target inside the project, the snapshot inside its checkpoint directory —
   * before the first mutation. One invalid entry throws here and nothing is restored; the
   * alternative (validate as you go) is a partial restore with an error at the end.
   */
  private planRestore(
    sessionId: string,
    manifests: readonly IEditCheckpointManifest[],
  ): IRestorePlanEntry[] {
    const plan: IRestorePlanEntry[] = [];
    for (const manifest of manifests) {
      const checkpointDir = this.checkpointDir(sessionId, manifest.id);
      for (const record of manifest.files) {
        plan.push({
          checkpointId: manifest.id,
          projectPath: this.authorityIO.toProjectRelativePath(record.originalPath),
          record,
          snapshotPath:
            record.snapshotFile === undefined
              ? undefined
              : resolveContainedSnapshotPath(checkpointDir, record.snapshotFile),
        });
      }
    }
    return plan;
  }

  /**
   * The checkpoints a person's read can use: refused as locked while the host's gate says so, and
   * otherwise as the catalog reads them.
   */
  private readable(sessionId: string): IReadableCheckpoints {
    if (this.keysLocked?.() === true) throw new EditCheckpointsLockedError('locked');
    return this.catalog.read(sessionId, this.sessionDir(sessionId));
  }

  /** The checkpoint a read names; one that does not open is refused as such, never as unknown. */
  private requireTarget(
    checkpoints: IReadableCheckpoints,
    checkpointId: string,
  ): IEditCheckpointManifest {
    const target = checkpoints.manifests.find((manifest) => manifest.id === checkpointId);
    if (target !== undefined) return target;
    const unreadable = checkpoints.unreadable.find((checkpoint) => checkpoint.id === checkpointId);
    if (unreadable !== undefined) {
      throw new EditCheckpointUnreadableError(unreadable.id, unreadable.reason);
    }
    throw new Error(`Unknown edit checkpoint: ${checkpointId}`);
  }

  /**
   * The next checkpoint's sequence and parent: the parent is the active branch HEAD, or — for a
   * session with none yet — the latest checkpoint; a HEAD cleared on purpose starts a fresh root.
   */
  private nextCheckpoint(sessionId: string): {
    nextSequence: number;
    parentId: string | undefined;
  } {
    const { sequence, latestId } = this.catalog.next(this.sessionDir(sessionId));
    const tracked = this.activeHead.get(sessionId);
    return {
      nextSequence: sequence,
      parentId: tracked === undefined ? latestId : (tracked ?? undefined),
    };
  }

  /**
   * SELFHOST-007: navigation delegates to the neutral `CheckpointTree` (agent-session). Build the tree
   * from the session's persisted manifest edges and return its branch tips (leaf checkpoints).
   */
  listCheckpointBranches(sessionId: string): string[] {
    return this.buildTree(sessionId, this.readable(sessionId).manifests).listBranches();
  }

  /** SELFHOST-007: the ancestors of a checkpoint (nearest-first to the root) via the neutral tree. */
  checkpointAncestors(sessionId: string, checkpointId: string): string[] {
    return this.buildTree(sessionId, this.readable(sessionId).manifests).ancestors(checkpointId);
  }

  /**
   * SELFHOST-007: switch the active branch to an existing checkpoint (typically a branch tip), so the
   * next turn continues that line. Non-destructive; throws on an unknown checkpoint.
   */
  switchToCheckpoint(sessionId: string, checkpointId: string): void {
    if (!this.buildTree(sessionId, this.readable(sessionId).manifests).has(checkpointId)) {
      throw new Error(`Unknown edit checkpoint: ${checkpointId}`);
    }
    this.forkFrom(sessionId, checkpointId);
  }

  /**
   * SELFHOST-007: the active-branch pointer to persist on the session record (so a branch survives
   * `--resume`). Undefined when there is no active head yet (a fresh/empty session); a head cleared
   * by a rollback through the first checkpoint is a pointer with a `null` `checkpointId`, so a resume
   * starts the next turn on a fresh root line too.
   */
  getActiveBranchPointer(sessionId: string): IActiveBranchPointer | undefined {
    const checkpointId = this.activeHead.get(sessionId);
    if (checkpointId === undefined) return undefined;
    return { branchId: this.activeBranch.get(sessionId) ?? DEFAULT_BRANCH_ID, checkpointId };
  }

  /**
   * Restore a persisted pointer; absent checkpoint-tree state degrades to the linear HEAD. Sealed
   * state applies it when the checkpoint it names holds a manifest file, which a listing tells
   * without opening anything, so the answer is the same whether or not the keys are locked. A head
   * cleared on purpose names no checkpoint, so there is nothing to find and it always applies.
   */
  restoreActiveBranch(sessionId: string, pointer: IActiveBranchPointer | undefined): void {
    if (pointer === undefined) return;
    // drift → keep linear HEAD
    if (
      pointer.checkpointId !== null &&
      !this.catalog.pointsAt(this.sessionDir(sessionId), pointer.checkpointId)
    ) {
      return;
    }
    this.activeHead.set(sessionId, pointer.checkpointId);
    this.activeBranch.set(sessionId, pointer.branchId);
  }

  /** Build the neutral checkpoint tree from this session's persisted manifest edges. */
  private buildTree(
    sessionId: string,
    manifests: readonly IEditCheckpointManifest[],
  ): CheckpointTree {
    return CheckpointTree.fromNodes(
      checkpointTreeNodesOf(manifests),
      this.activeHead.get(sessionId) ?? undefined,
    );
  }

  private writeManifest(dir: string, manifest: IEditCheckpointManifest): void {
    this.authorityIO.writeManifest(join(dir, MANIFEST_FILE), manifest);
  }

  private sessionDir(sessionId: string): string {
    return safePathSegment(sessionId);
  }

  private checkpointDir(sessionId: string, checkpointId: string): string {
    return join(this.sessionDir(sessionId), safePathSegment(checkpointId));
  }
}
