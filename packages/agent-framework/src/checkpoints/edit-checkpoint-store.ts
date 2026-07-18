import { dirname, join, relative, resolve } from 'node:path';

import { NodeFileSystem, NodeFileSystemAsync } from '../adapters/node-file-system.js';
import { projectPaths } from '../paths.js';
import { buildEditCheckpointInspection } from './edit-checkpoint-inspection.js';

import type {
  IEditCheckpointFileRecord,
  IEditCheckpointInspection,
  IEditCheckpointManifest,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
} from './edit-checkpoint-types.js';
import type { IFileSystem, IFileSystemAsync } from '@robota-sdk/agent-core';

const MANIFEST_FILE = 'manifest.json';
const SNAPSHOT_DIR = 'files';
const ID_PAD = 4;
const SNAPSHOT_PAD = 6;
/** SELFHOST-007: the default branch a session's checkpoints belong to. */
const DEFAULT_BRANCH_ID = 'main';
interface IActiveEditCheckpointTurn {
  manifest: IEditCheckpointManifest;
  dir: string;
  capturedPaths: Set<string>;
}

interface IEditCheckpointStoreOptions {
  cwd: string;
  now?: () => Date;
}
export class EditCheckpointStore {
  private readonly cwd: string;
  private readonly rootDir: string;
  private readonly now: () => Date;
  private activeTurn: IActiveEditCheckpointTurn | null = null;
  /** SELFHOST-007: per-session active branch HEAD (checkpoint id the next turn forks from). */
  private readonly activeHead = new Map<string, string>();
  /** SELFHOST-007: per-session active branch id (default `'main'`; a fresh id after a fork). */
  private readonly activeBranch = new Map<string, string>();
  /** SELFHOST-007: monotonic fork counter for minting distinct branch ids. */
  private forkCounter = 0;

  constructor(
    options: IEditCheckpointStoreOptions,
    private readonly fs: IFileSystem = new NodeFileSystem(),
    private readonly fsAsync: IFileSystemAsync = new NodeFileSystemAsync(),
  ) {
    this.cwd = resolve(options.cwd);
    this.rootDir = projectPaths(this.cwd).checkpoints;
    this.now = options.now ?? (() => new Date());
  }

  async beginTurn(input: IEditCheckpointTurnInput): Promise<IEditCheckpointSummary> {
    if (this.activeTurn) {
      await this.finalizeTurn();
    }

    const nextSequence = this.nextSequence(input.sessionId);
    const id = `turn-${String(nextSequence).padStart(ID_PAD, '0')}`;
    const dir = join(this.sessionDir(input.sessionId), id);
    await this.fsAsync.mkdir(join(dir, SNAPSHOT_DIR), { recursive: true });

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
    if (isInside(this.rootDir, originalPath)) return;

    const record = await this.createFileRecord(originalPath, this.activeTurn);
    this.activeTurn.manifest.files.push(record);
    this.activeTurn.manifest.fileCount = this.activeTurn.manifest.files.length;
    this.activeTurn.capturedPaths.add(originalPath);
  }

  async finalizeTurn(): Promise<IEditCheckpointSummary | undefined> {
    if (!this.activeTurn) return undefined;
    const active = this.activeTurn;
    this.activeTurn = null;
    await this.writeManifest(active.dir, active.manifest);
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
      checkpointDir: (inputSessionId, inputCheckpointId) =>
        this.checkpointDir(inputSessionId, inputCheckpointId),
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

  private async createFileRecord(
    originalPath: string,
    active: IActiveEditCheckpointTurn,
  ): Promise<IEditCheckpointFileRecord> {
    const existed = await pathExists(this.fsAsync, this.fs, originalPath);
    if (!existed) {
      return {
        originalPath,
        existed: false,
      };
    }

    const snapshotFile = join(
      SNAPSHOT_DIR,
      `${String(active.manifest.files.length + 1).padStart(SNAPSHOT_PAD, '0')}.content`,
    );
    await this.fsAsync.copyFile(originalPath, join(active.dir, snapshotFile));
    return {
      originalPath,
      existed: true,
      snapshotFile,
    };
  }

  private async restoreFile(
    sessionId: string,
    checkpointId: string,
    record: IEditCheckpointFileRecord,
  ): Promise<void> {
    if (!record.existed) {
      await this.fsAsync.rm(record.originalPath, { force: true });
      return;
    }
    if (!record.snapshotFile) {
      throw new Error(`Checkpoint file record is missing a snapshot: ${record.originalPath}`);
    }
    await this.fsAsync.mkdir(dirname(record.originalPath), { recursive: true });
    await this.fsAsync.copyFile(
      join(this.checkpointDir(sessionId, checkpointId), record.snapshotFile),
      record.originalPath,
    );
  }

  private loadManifests(sessionId: string): IEditCheckpointManifest[] {
    const dir = this.sessionDir(sessionId);
    const manifests = readDirSyncSafe(this.fs, dir)
      .map((entry) => join(dir, entry, MANIFEST_FILE))
      .map((manifestPath) => readJsonManifest(this.fs, manifestPath))
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

  private nextSequence(sessionId: string): number {
    const last = this.list(sessionId).at(-1);
    return (last?.sequence ?? 0) + 1;
  }

  private async writeManifest(dir: string, manifest: IEditCheckpointManifest): Promise<void> {
    await this.fsAsync.mkdir(dir, { recursive: true });
    const path = join(dir, MANIFEST_FILE);
    const tmp = `${path}.tmp`;
    await this.fsAsync.writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
    await this.fsAsync.rename(tmp, path);
  }

  private sessionDir(sessionId: string): string {
    return join(this.rootDir, safePathSegment(sessionId));
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

/**
 * SELFHOST-007 migration: reconstruct the branch tree for legacy (v1) manifests. A v1 manifest has no
 * `parentId`/`branchId`, so — sorted by sequence — it is treated as a LINEAR chain: each node's parent
 * is the previous node, all on the `'main'` branch. v2 manifests keep their stored branch fields. Pure;
 * does not mutate the inputs.
 */
function migrateManifestsToTree(manifests: IEditCheckpointManifest[]): IEditCheckpointManifest[] {
  return manifests.map((manifest, index) => {
    if (manifest.version === 2 && manifest.branchId !== undefined) return manifest;
    const previous = index > 0 ? manifests[index - 1] : undefined;
    return {
      ...manifest,
      version: 2,
      branchId: DEFAULT_BRANCH_ID,
      ...(previous ? { parentId: previous.id } : {}),
    };
  });
}

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.length === 0 || (!rel.startsWith('..') && !rel.startsWith('/'));
}

async function pathExists(
  fsAsync: IFileSystemAsync,
  fs: IFileSystem,
  path: string,
): Promise<boolean> {
  try {
    await fsAsync.access(path, fs.constants.F_OK);
    return true;
  } catch {
    // allow-fallback: access failure means file absent, false is the correct result
    return false;
  }
}

function readDirSyncSafe(fs: IFileSystem, dir: string): string[] {
  try {
    return fs.readdirSync(dir);
  } catch {
    // allow-fallback: missing directory returns empty list, not an error
    return [];
  }
}

function readJsonManifest(fs: IFileSystem, path: string): IEditCheckpointManifest | undefined {
  try {
    const raw = fs.readFileSync(path, 'utf8');
    return JSON.parse(raw) as IEditCheckpointManifest;
  } catch {
    // allow-fallback: corrupted/missing manifest is filtered out by caller
    return undefined;
  }
}
