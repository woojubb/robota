import { join, relative, resolve } from 'node:path';

import { CheckpointTree } from '@robota-sdk/agent-session';

import { EditCheckpointAuthorityIO } from './edit-checkpoint-authority-io.js';
import { buildEditCheckpointInspection } from './edit-checkpoint-inspection.js';
import {
  DEFAULT_BRANCH_ID,
  migrateManifestsToTree,
  safePathSegment,
} from './edit-checkpoint-store-helpers.js';

import type {
  IEditCheckpointFileRecord,
  IEditCheckpointInspection,
  IEditCheckpointManifest,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
} from './edit-checkpoint-types.js';
import type {
  IWorkspaceProjectAuthority,
  IWorkspaceProjectMutation,
} from '../workspace-trust/index.js';
import type { IActiveBranchPointer } from '@robota-sdk/agent-interface-transport';

const MANIFEST_FILE = 'manifest.json';
const SNAPSHOT_DIR = 'files';
const ID_PAD = 4;
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
  now?: () => Date;
}
export class EditCheckpointStore {
  private readonly cwd: string;
  private readonly authorityIO: EditCheckpointAuthorityIO;
  private readonly now: () => Date;
  private activeTurn: IActiveEditCheckpointTurn | null = null;
  /** SELFHOST-007: per-session active branch HEAD (checkpoint id the next turn forks from). */
  private readonly activeHead = new Map<string, string>();
  /** SELFHOST-007: per-session active branch id (default `'main'`; a fresh id after a fork). */
  private readonly activeBranch = new Map<string, string>();
  /** SELFHOST-007: monotonic fork counter for minting distinct branch ids. */
  private forkCounter = 0;

  constructor(options: IEditCheckpointStoreOptions) {
    this.authorityIO = new EditCheckpointAuthorityIO(options.authority, options.mutation);
    this.cwd = this.authorityIO.cwd;
    this.now = options.now ?? (() => new Date());
  }

  async beginTurn(input: IEditCheckpointTurnInput): Promise<IEditCheckpointSummary> {
    if (this.activeTurn) {
      await this.finalizeTurn();
    }

    const nextSequence = this.nextSequence(input.sessionId);
    const id = `turn-${String(nextSequence).padStart(ID_PAD, '0')}`;
    const dir = join(this.sessionDir(input.sessionId), id);

    // SELFHOST-007: the new checkpoint's parent is the active branch HEAD (the checkpoint the last
    // restore/rollback forked from, or the previous head). Falls back to the last checkpoint by
    // sequence for a fresh store. branchId groups the line (default 'main', a fresh id after a fork).
    const parentId = this.resolveActiveHead(input.sessionId);
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
    // This checkpoint is now the branch HEAD.
    this.activeHead.set(input.sessionId, id);

    return toSummary(manifest);
  }

  async captureFile(filePath: string): Promise<void> {
    if (!this.activeTurn) return;

    const originalPath = resolve(this.cwd, filePath);
    if (this.activeTurn.capturedPaths.has(originalPath)) return;
    const relativePath = relative(this.cwd, originalPath);
    if (
      relativePath.length === 0 ||
      relativePath.startsWith('..') ||
      resolve(this.cwd, relativePath) !== originalPath ||
      relativePath === join('.robota', 'checkpoints') ||
      relativePath.startsWith(`${join('.robota', 'checkpoints')}/`)
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

  async finalizeTurn(): Promise<IEditCheckpointSummary | undefined> {
    if (!this.activeTurn) return undefined;
    const active = this.activeTurn;
    this.activeTurn = null;
    this.writeManifest(active.dir, active.manifest);
    return toSummary(active.manifest);
  }

  list(sessionId: string): IEditCheckpointSummary[] {
    return this.loadManifests(sessionId).map(toSummary);
  }

  inspect(sessionId: string, checkpointId: string): IEditCheckpointInspection {
    const manifests = this.loadManifests(sessionId);
    const target = manifests.find((manifest) => manifest.id === checkpointId);
    if (!target) {
      throw new Error(`Unknown edit checkpoint: ${checkpointId}`);
    }

    return buildEditCheckpointInspection({
      cwd: this.cwd,
      sessionId,
      target,
      manifests,
      readSnapshotBytes: (inputSessionId, inputCheckpointId, snapshotFile) =>
        this.authorityIO.readSnapshotBytes(
          join(this.checkpointDir(inputSessionId, inputCheckpointId), snapshotFile),
        ),
    });
  }

  async restoreToCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<IEditCheckpointRestoreResult> {
    const manifests = this.loadManifests(sessionId);
    const target = manifests.find((manifest) => manifest.id === checkpointId);
    if (!target) {
      throw new Error(`Unknown edit checkpoint: ${checkpointId}`);
    }

    const later = manifests
      .filter((manifest) => manifest.sequence > target.sequence)
      .sort((a, b) => b.sequence - a.sequence);

    let restoredFileCount = 0;
    for (const manifest of later) {
      for (const file of manifest.files) {
        await this.restoreFile(sessionId, manifest.id, file);
        restoredFileCount += 1;
      }
    }

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
  private forkFrom(sessionId: string, checkpointId: string): void {
    this.activeHead.set(sessionId, checkpointId);
    this.forkCounter += 1;
    this.activeBranch.set(sessionId, `branch-${this.forkCounter}`);
  }

  async rollbackThroughCheckpoint(
    sessionId: string,
    checkpointId: string,
  ): Promise<IEditCheckpointRestoreResult> {
    const manifests = this.loadManifests(sessionId);
    const target = manifests.find((manifest) => manifest.id === checkpointId);
    if (!target) {
      throw new Error(`Unknown edit checkpoint: ${checkpointId}`);
    }

    const rollbackRange = manifests
      .filter((manifest) => manifest.sequence >= target.sequence)
      .sort((a, b) => b.sequence - a.sequence);

    let restoredFileCount = 0;
    for (const manifest of rollbackRange) {
      for (const file of manifest.files) {
        await this.restoreFile(sessionId, manifest.id, file);
        restoredFileCount += 1;
      }
    }

    // SELFHOST-007: NON-DESTRUCTIVE — rollback reverts THROUGH the target (inclusive) but keeps those
    // checkpoints on disk as a sibling branch. The active HEAD forks from the target's PARENT (the
    // point before the rolled-back range); an absent parent (target was the root) clears the head so
    // the next turn starts a fresh root line.
    if (target.parentId !== undefined) {
      this.forkFrom(sessionId, target.parentId);
    } else {
      this.activeHead.delete(sessionId);
      this.forkCounter += 1;
      this.activeBranch.set(sessionId, `branch-${this.forkCounter}`);
    }

    return {
      target: toSummary(target),
      restoredCheckpointCount: rollbackRange.length,
      restoredFileCount,
      removedCheckpointCount: 0,
    };
  }

  private async restoreFile(
    sessionId: string,
    checkpointId: string,
    record: IEditCheckpointFileRecord,
  ): Promise<void> {
    this.authorityIO.restoreFile(
      record.snapshotFile === undefined
        ? undefined
        : join(this.checkpointDir(sessionId, checkpointId), record.snapshotFile),
      record,
    );
  }

  private loadManifests(sessionId: string): IEditCheckpointManifest[] {
    const dir = this.sessionDir(sessionId);
    const manifests = this.authorityIO
      .listDirectories(dir)
      .map((entry) => join(dir, entry, MANIFEST_FILE))
      .map((manifestPath) => this.authorityIO.readManifest(manifestPath))
      .filter((manifest): manifest is IEditCheckpointManifest => manifest !== undefined)
      .sort((a, b) => a.sequence - b.sequence);
    return migrateManifestsToTree(manifests);
  }

  /**
   * SELFHOST-007: the active branch HEAD for a session — the checkpoint the next turn forks from.
   * Defaults to the last checkpoint by sequence (a fresh store continues the linear line).
   */
  private resolveActiveHead(sessionId: string): string | undefined {
    const tracked = this.activeHead.get(sessionId);
    if (tracked !== undefined) return tracked;
    const manifests = this.loadManifests(sessionId);
    return manifests.length > 0 ? manifests[manifests.length - 1]!.id : undefined;
  }

  /**
   * SELFHOST-007: navigation delegates to the neutral `CheckpointTree` (agent-session). Build the tree
   * from the session's persisted manifest edges and return its branch tips (leaf checkpoints).
   */
  listCheckpointBranches(sessionId: string): string[] {
    return this.buildTree(sessionId).listBranches();
  }

  /** SELFHOST-007: the ancestors of a checkpoint (nearest-first to the root) via the neutral tree. */
  checkpointAncestors(sessionId: string, checkpointId: string): string[] {
    return this.buildTree(sessionId).ancestors(checkpointId);
  }

  /**
   * SELFHOST-007: switch the active branch to an existing checkpoint (typically a branch tip), so the
   * next turn continues that line. Non-destructive; throws on an unknown checkpoint.
   */
  switchToCheckpoint(sessionId: string, checkpointId: string): void {
    if (!this.buildTree(sessionId).has(checkpointId)) {
      throw new Error(`Unknown edit checkpoint: ${checkpointId}`);
    }
    this.forkFrom(sessionId, checkpointId);
  }

  /**
   * SELFHOST-007: the active-branch pointer to persist on the session record (so a branch survives
   * `--resume`). Undefined when there is no active head (a fresh/empty session).
   */
  getActiveBranchPointer(sessionId: string): IActiveBranchPointer | undefined {
    const checkpointId = this.activeHead.get(sessionId);
    if (checkpointId === undefined) return undefined;
    return { branchId: this.activeBranch.get(sessionId) ?? DEFAULT_BRANCH_ID, checkpointId };
  }

  /** Restore a persisted pointer; absent checkpoint-tree state degrades to the linear HEAD. */
  restoreActiveBranch(sessionId: string, pointer: IActiveBranchPointer | undefined): void {
    if (pointer === undefined) return;
    if (!this.buildTree(sessionId).has(pointer.checkpointId)) return; // drift → keep linear HEAD
    this.activeHead.set(sessionId, pointer.checkpointId);
    this.activeBranch.set(sessionId, pointer.branchId);
  }

  /** Build the neutral checkpoint tree from this session's persisted manifest edges. */
  private buildTree(sessionId: string): CheckpointTree {
    const nodes = this.loadManifests(sessionId).map((manifest) => ({
      id: manifest.id,
      ...(manifest.parentId !== undefined ? { parentId: manifest.parentId } : {}),
    }));
    return CheckpointTree.fromNodes(nodes, this.activeHead.get(sessionId));
  }
  private nextSequence(sessionId: string): number {
    const last = this.list(sessionId).at(-1);
    return (last?.sequence ?? 0) + 1;
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

function toSummary(manifest: IEditCheckpointManifest): IEditCheckpointSummary {
  return {
    id: manifest.id,
    sessionId: manifest.sessionId,
    sequence: manifest.sequence,
    prompt: manifest.prompt,
    createdAt: manifest.createdAt,
    fileCount: manifest.fileCount,
  };
}
