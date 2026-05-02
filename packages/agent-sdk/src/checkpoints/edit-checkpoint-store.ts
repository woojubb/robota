import { access, copyFile, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { constants, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { projectPaths } from '../paths.js';
import type {
  IEditCheckpointFileRecord,
  IEditCheckpointManifest,
  IEditCheckpointRestoreResult,
  IEditCheckpointSummary,
  IEditCheckpointTurnInput,
} from './edit-checkpoint-types.js';

const MANIFEST_FILE = 'manifest.json';
const SNAPSHOT_DIR = 'files';
const ID_PAD = 4;
const SNAPSHOT_PAD = 6;

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

  constructor(options: IEditCheckpointStoreOptions) {
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
    await mkdir(join(dir, SNAPSHOT_DIR), { recursive: true });

    const manifest: IEditCheckpointManifest = {
      version: 1,
      id,
      sessionId: input.sessionId,
      sequence: nextSequence,
      prompt: input.prompt,
      createdAt: this.now().toISOString(),
      fileCount: 0,
      files: [],
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

    for (const manifest of later) {
      await rm(this.checkpointDir(sessionId, manifest.id), { recursive: true, force: true });
    }

    return {
      target: toSummary(target),
      restoredCheckpointCount: later.length,
      restoredFileCount,
      removedCheckpointCount: later.length,
    };
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

    for (const manifest of rollbackRange) {
      await rm(this.checkpointDir(sessionId, manifest.id), { recursive: true, force: true });
    }

    return {
      target: toSummary(target),
      restoredCheckpointCount: rollbackRange.length,
      restoredFileCount,
      removedCheckpointCount: rollbackRange.length,
    };
  }

  private async createFileRecord(
    originalPath: string,
    active: IActiveEditCheckpointTurn,
  ): Promise<IEditCheckpointFileRecord> {
    const existed = await pathExists(originalPath);
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
    await copyFile(originalPath, join(active.dir, snapshotFile));
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
      await rm(record.originalPath, { force: true });
      return;
    }
    if (!record.snapshotFile) {
      throw new Error(`Checkpoint file record is missing a snapshot: ${record.originalPath}`);
    }
    await mkdir(dirname(record.originalPath), { recursive: true });
    await copyFile(
      join(this.checkpointDir(sessionId, checkpointId), record.snapshotFile),
      record.originalPath,
    );
  }

  private loadManifests(sessionId: string): IEditCheckpointManifest[] {
    const dir = this.sessionDir(sessionId);
    return readDirSyncSafe(dir)
      .map((entry) => join(dir, entry, MANIFEST_FILE))
      .map((manifestPath) => readJsonManifest(manifestPath))
      .filter((manifest): manifest is IEditCheckpointManifest => manifest !== undefined)
      .sort((a, b) => a.sequence - b.sequence);
  }

  private nextSequence(sessionId: string): number {
    const last = this.list(sessionId).at(-1);
    return (last?.sequence ?? 0) + 1;
  }

  private async writeManifest(dir: string, manifest: IEditCheckpointManifest): Promise<void> {
    await mkdir(dir, { recursive: true });
    const path = join(dir, MANIFEST_FILE);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(manifest, null, 2), 'utf8');
    await rename(tmp, path);
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

function safePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, '_');
}

function isInside(parent: string, child: string): boolean {
  const rel = relative(parent, child);
  return rel.length === 0 || (!rel.startsWith('..') && !rel.startsWith('/'));
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

function readDirSyncSafe(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

function readJsonManifest(path: string): IEditCheckpointManifest | undefined {
  try {
    const raw = readFileSync(path, 'utf8');
    return JSON.parse(raw) as IEditCheckpointManifest;
  } catch {
    return undefined;
  }
}
