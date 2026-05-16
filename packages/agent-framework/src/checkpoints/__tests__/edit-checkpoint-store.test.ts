import { describe, expect, it, afterEach } from 'vitest';
import { existsSync, mkdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';

const TMP_BASE = join(tmpdir(), `robota-edit-checkpoint-store-${process.pid}`);

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('EditCheckpointStore', () => {
  it('Given two edited turns When restoring to the first turn Then later file changes are reverted in reverse order', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'src', 'example.ts');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(filePath, 'version 1', 'utf8');
    const store = new EditCheckpointStore({ cwd });

    const first = await store.beginTurn({ sessionId: 'session_1', prompt: 'first edit' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'version 2', 'utf8');
    await store.finalizeTurn();

    await store.beginTurn({ sessionId: 'session_1', prompt: 'second edit' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'version 3', 'utf8');
    await store.finalizeTurn();

    const result = await store.restoreToCheckpoint('session_1', first.id);

    expect(readFileSync(filePath, 'utf8')).toBe('version 2');
    expect(result.restoredCheckpointCount).toBe(1);
    expect(result.restoredFileCount).toBe(1);
    expect(store.list('session_1').map((checkpoint) => checkpoint.id)).toEqual([first.id]);
  });

  it('Given a file created after a checkpoint When restoring to that checkpoint Then the created file is removed', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'created.txt');
    const store = new EditCheckpointStore({ cwd });

    const first = await store.beginTurn({ sessionId: 'session_1', prompt: 'baseline' });
    await store.finalizeTurn();

    await store.beginTurn({ sessionId: 'session_1', prompt: 'create file' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'new content', 'utf8');
    await store.finalizeTurn();

    const result = await store.restoreToCheckpoint('session_1', first.id);

    expect(existsSync(filePath)).toBe(false);
    expect(result.restoredFileCount).toBe(1);
  });

  it('Given checkpoints When inspecting a checkpoint Then captured files and restore plans are returned', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'src', 'example.ts');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(filePath, 'version 1', 'utf8');
    const store = new EditCheckpointStore({ cwd });

    const first = await store.beginTurn({ sessionId: 'session_1', prompt: 'first edit' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'version 2', 'utf8');
    await store.finalizeTurn();

    await store.beginTurn({ sessionId: 'session_1', prompt: 'second edit' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'version 3', 'utf8');
    await store.finalizeTurn();

    const inspection = store.inspect('session_1', first.id);

    expect(inspection.target.id).toBe(first.id);
    expect(inspection.capturedFiles).toEqual([
      {
        originalPath: filePath,
        relativePath: 'src/example.ts',
        existed: true,
        restoreAction: 'restore-preimage',
        snapshotAvailable: true,
        snapshotSizeBytes: 'version 1'.length,
      },
    ]);
    expect(inspection.restoreToCheckpoint).toEqual({
      checkpointIds: ['turn-0002'],
      fileCount: 1,
    });
    expect(inspection.rollbackThroughCheckpoint).toEqual({
      checkpointIds: ['turn-0001', 'turn-0002'],
      fileCount: 2,
    });
  });

  it('Given edited turns When rolling back through a checkpoint Then the selected turn and later turns are reverted', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'src', 'example.ts');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(filePath, 'version 1', 'utf8');
    const store = new EditCheckpointStore({ cwd });

    const first = await store.beginTurn({ sessionId: 'session_1', prompt: 'first edit' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'version 2', 'utf8');
    await store.finalizeTurn();

    await store.beginTurn({ sessionId: 'session_1', prompt: 'second edit' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'version 3', 'utf8');
    await store.finalizeTurn();

    const result = await store.rollbackThroughCheckpoint('session_1', first.id);

    expect(readFileSync(filePath, 'utf8')).toBe('version 1');
    expect(result.restoredCheckpointCount).toBe(2);
    expect(result.restoredFileCount).toBe(2);
    expect(store.list('session_1')).toEqual([]);
  });

  it('Given a missing snapshot file When rollback fails Then checkpoint directories are preserved', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'src', 'example.ts');
    mkdirSync(join(cwd, 'src'), { recursive: true });
    writeFileSync(filePath, 'version 1', 'utf8');
    const store = new EditCheckpointStore({ cwd });

    const first = await store.beginTurn({ sessionId: 'session_1', prompt: 'first edit' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'version 2', 'utf8');
    await store.finalizeTurn();

    const inspection = store.inspect('session_1', first.id);
    expect(inspection.capturedFiles[0]?.snapshotAvailable).toBe(true);
    unlinkSync(
      join(cwd, '.robota', 'checkpoints', 'session_1', first.id, 'files', '000001.content'),
    );

    await expect(store.rollbackThroughCheckpoint('session_1', first.id)).rejects.toThrow();

    expect(store.list('session_1').map((checkpoint) => checkpoint.id)).toEqual([first.id]);
    expect(readFileSync(filePath, 'utf8')).toBe('version 2');
    expect(store.inspect('session_1', first.id).capturedFiles[0]?.snapshotAvailable).toBe(false);
  });

  it('Given the same file is captured twice in one turn When finalizing Then only the first pre-image is stored', async () => {
    const cwd = makeProject();
    const filePath = join(cwd, 'same.txt');
    writeFileSync(filePath, 'before', 'utf8');
    const store = new EditCheckpointStore({ cwd });

    await store.beginTurn({ sessionId: 'session_1', prompt: 'duplicate capture' });
    await store.captureFile(filePath);
    writeFileSync(filePath, 'during', 'utf8');
    await store.captureFile(filePath);
    const summary = await store.finalizeTurn();

    expect(summary?.fileCount).toBe(1);
    expect(store.list('session_1')[0]?.fileCount).toBe(1);
  });
});
