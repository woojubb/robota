import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
  mkdtempSync,
  realpathSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { describe, expect, it, afterEach } from 'vitest';

import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import {
  WorkspaceAuthorityRequiredError,
  createWorkspaceProjectMutation,
} from '../../workspace-trust/index.js';
import { EditCheckpointStore } from '../edit-checkpoint-store.js';
import {
  EditCheckpointManifestEscapeError,
  resolveContainedSnapshotPath,
} from '../edit-checkpoint-store-helpers.js';

describe('resolveContainedSnapshotPath (issue #2076)', () => {
  const checkpointDir = join('session_1', 'cp-0001');

  it('accepts a snapshot that is a strict descendant of the checkpoint directory', () => {
    expect(resolveContainedSnapshotPath(checkpointDir, join('files', '000001.snap'))).toBe(
      join(checkpointDir, 'files', '000001.snap'),
    );
    expect(resolveContainedSnapshotPath(checkpointDir, 'files/../files/x')).toBe(
      join(checkpointDir, 'files', 'x'),
    );
  });

  it('refuses traversal, the directory itself, an absolute path and an empty name', () => {
    for (const snapshotFile of ['../../x', '..', 'files/../../x', '.', '', '/etc/passwd']) {
      expect(() => resolveContainedSnapshotPath(checkpointDir, snapshotFile), snapshotFile).toThrow(
        EditCheckpointManifestEscapeError,
      );
    }
  });

  it('refuses a prefix collision — `../cp-0001-evil/x` is a sibling, not a descendant', () => {
    expect(() => resolveContainedSnapshotPath(checkpointDir, '../cp-0001-evil/x')).toThrow(
      EditCheckpointManifestEscapeError,
    );
  });
});

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'robota-edit-checkpoint-store-')));

function makeProject(): string {
  const dir = join(TMP_BASE, Math.random().toString(36).slice(2));
  mkdirSync(dir, { recursive: true });
  return dir;
}

async function createStore(cwd: string): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(cwd);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'checkpoint test restore',
    }),
  });
}

afterEach(() => {
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('EditCheckpointStore', () => {
  it('rejects a mutation capability minted for a different project authority', async () => {
    const left = makeProject();
    const right = makeProject();
    const leftAccess = await createTrustedProjectAccessFixture(left);
    const rightAccess = await createTrustedProjectAccessFixture(right);
    if (leftAccess.status !== 'trusted' || rightAccess.status !== 'trusted') {
      throw new Error('expected trusted project fixtures');
    }
    const foreignMutation = createWorkspaceProjectMutation(rightAccess.authority, {
      status: 'approved',
      purpose: 'foreign checkpoint mutation',
    });

    expect(
      () =>
        new EditCheckpointStore({
          authority: leftAccess.authority,
          mutation: foreignMutation,
        }),
    ).toThrowError(WorkspaceAuthorityRequiredError);
  });

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given two edited turns When restoring to the first turn Then later file changes are reverted in reverse order',
    async () => {
      const cwd = makeProject();
      const filePath = join(cwd, 'src', 'example.ts');
      mkdirSync(join(cwd, 'src'), { recursive: true });
      writeFileSync(filePath, 'version 1', 'utf8');
      const store = await createStore(cwd);

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
      // SELFHOST-007 TC-03: restore is NON-destructive — the later checkpoint is NOT deleted; it stays
      // reachable (a sibling branch). Nothing is removed.
      expect(result.removedCheckpointCount).toBe(0);
      expect(store.list('session_1')).toHaveLength(2);
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'issue #2076 Given a manifest whose snapshotFile escapes the checkpoint directory When restoring Then the whole restore aborts with a typed error and nothing is restored',
    async () => {
      const cwd = makeProject();
      const filePath = join(cwd, 'src', 'example.ts');
      const otherPath = join(cwd, 'src', 'other.ts');
      mkdirSync(join(cwd, 'src'), { recursive: true });
      writeFileSync(filePath, 'version 1', 'utf8');
      writeFileSync(otherPath, 'other 1', 'utf8');
      const store = await createStore(cwd);

      const first = await store.beginTurn({ sessionId: 'session_1', prompt: 'first edit' });
      await store.finalizeTurn();

      const second = await store.beginTurn({ sessionId: 'session_1', prompt: 'second edit' });
      await store.captureFile(otherPath);
      writeFileSync(otherPath, 'other 2', 'utf8');
      await store.captureFile(filePath);
      writeFileSync(filePath, 'version 2', 'utf8');
      await store.finalizeTurn();

      // Tamper with the persisted manifest: the SECOND record now names a snapshot outside its
      // checkpoint directory. The first record is still valid — a validate-as-you-go restore would
      // restore it before failing, which is the partial restore the issue forbids.
      const manifestPath = join(
        cwd,
        '.robota',
        'checkpoints',
        'session_1',
        second.id,
        'manifest.json',
      );
      const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
        files: { originalPath: string; snapshotFile?: string }[];
      };
      expect(manifest.files).toHaveLength(2);
      manifest.files[1]!.snapshotFile = '../../x';
      writeFileSync(manifestPath, JSON.stringify(manifest), 'utf8');

      await expect(store.restoreToCheckpoint('session_1', first.id)).rejects.toBeInstanceOf(
        EditCheckpointManifestEscapeError,
      );
      expect(readFileSync(otherPath, 'utf8')).toBe('other 2');
      expect(readFileSync(filePath, 'utf8')).toBe('version 2');
      expect(() => store.inspect('session_1', second.id)).toThrowError(
        EditCheckpointManifestEscapeError,
      );
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given a file created after a checkpoint When restoring to that checkpoint Then the created file is removed',
    async () => {
      const cwd = makeProject();
      const filePath = join(cwd, 'created.txt');
      const store = await createStore(cwd);

      const first = await store.beginTurn({ sessionId: 'session_1', prompt: 'baseline' });
      await store.finalizeTurn();

      await store.beginTurn({ sessionId: 'session_1', prompt: 'create file' });
      await store.captureFile(filePath);
      writeFileSync(filePath, 'new content', 'utf8');
      await store.finalizeTurn();

      const result = await store.restoreToCheckpoint('session_1', first.id);

      expect(existsSync(filePath)).toBe(false);
      expect(result.restoredFileCount).toBe(1);
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given checkpoints When inspecting a checkpoint Then captured files and restore plans are returned',
    async () => {
      const cwd = makeProject();
      const filePath = join(cwd, 'src', 'example.ts');
      mkdirSync(join(cwd, 'src'), { recursive: true });
      writeFileSync(filePath, 'version 1', 'utf8');
      const store = await createStore(cwd);

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
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given edited turns When rolling back through a checkpoint Then the selected turn and later turns are reverted',
    async () => {
      const cwd = makeProject();
      const filePath = join(cwd, 'src', 'example.ts');
      mkdirSync(join(cwd, 'src'), { recursive: true });
      writeFileSync(filePath, 'version 1', 'utf8');
      const store = await createStore(cwd);

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
      // SELFHOST-007 TC-03: rollback is NON-destructive — the rolled-back checkpoints stay on disk as a
      // sibling branch rather than being deleted.
      expect(result.removedCheckpointCount).toBe(0);
      expect(store.list('session_1')).toHaveLength(2);
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given a missing snapshot file When rollback fails Then checkpoint directories are preserved',
    async () => {
      const cwd = makeProject();
      const filePath = join(cwd, 'src', 'example.ts');
      mkdirSync(join(cwd, 'src'), { recursive: true });
      writeFileSync(filePath, 'version 1', 'utf8');
      const store = await createStore(cwd);

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
    },
  );

  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'Given the same file is captured twice in one turn When finalizing Then only the first pre-image is stored',
    async () => {
      const cwd = makeProject();
      const filePath = join(cwd, 'same.txt');
      writeFileSync(filePath, 'before', 'utf8');
      const store = await createStore(cwd);

      await store.beginTurn({ sessionId: 'session_1', prompt: 'duplicate capture' });
      await store.captureFile(filePath);
      writeFileSync(filePath, 'during', 'utf8');
      await store.captureFile(filePath);
      const summary = await store.finalizeTurn();

      expect(summary?.fileCount).toBe(1);
      expect(store.list('session_1')[0]?.fileCount).toBe(1);
    },
  );

  // SELFHOST-007 TC-03: branching (non-destructive divergence) + v1 back-compat migration.
  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'forking after a restore diverges — the old future AND the new branch are both listed',
    async () => {
      const cwd = makeProject();
      const store = await createStore(cwd);

      const a = await store.beginTurn({ sessionId: 'session_1', prompt: 'a' });
      await store.finalizeTurn();
      await store.beginTurn({ sessionId: 'session_1', prompt: 'b' });
      await store.finalizeTurn();
      await store.beginTurn({ sessionId: 'session_1', prompt: 'c' });
      await store.finalizeTurn(); // line a-b-c

      await store.restoreToCheckpoint('session_1', a.id); // fork point = a (b,c preserved)
      const d = await store.beginTurn({ sessionId: 'session_1', prompt: 'd' });
      await store.finalizeTurn(); // new branch a-d

      // all four checkpoints reachable — nothing deleted
      expect(store.list('session_1')).toHaveLength(4);

      // d diverged from a (its parent is the restore target), NOT from c
      const dManifestPath = join(cwd, '.robota', 'checkpoints', 'session_1', d.id, 'manifest.json');
      const dManifest = JSON.parse(readFileSync(dManifestPath, 'utf8')) as {
        version: number;
        parentId?: string;
        branchId?: string;
      };
      expect(dManifest.version).toBe(2);
      expect(dManifest.parentId).toBe(a.id);
      expect(dManifest.branchId).not.toBe('main'); // a fresh branch after the fork
    },
  );

  it('loads a legacy v1 manifest as a linear chain (back-compat migration)', async () => {
    const cwd = makeProject();
    const sessionDir = join(cwd, '.robota', 'checkpoints', 'session_1');
    // hand-write two legacy v1 manifests (no parentId/branchId)
    for (const [seq, id] of [
      [1, 'turn-0001'],
      [2, 'turn-0002'],
    ] as const) {
      mkdirSync(join(sessionDir, id), { recursive: true });
      writeFileSync(
        join(sessionDir, id, 'manifest.json'),
        JSON.stringify({
          version: 1,
          id,
          sessionId: 'session_1',
          sequence: seq,
          prompt: `legacy ${seq}`,
          createdAt: new Date(1_700_000_000_000 + seq).toISOString(),
          fileCount: 0,
          files: [],
        }),
        'utf8',
      );
    }

    const store = await createStore(cwd);
    // migration does not crash, lists both in sequence order (linear chain)
    expect(store.list('session_1').map((c) => c.id)).toEqual(['turn-0001', 'turn-0002']);
    // restore over a migrated v1 chain is non-destructive
    const result = await store.restoreToCheckpoint('session_1', 'turn-0001');
    expect(result.removedCheckpointCount).toBe(0);
    expect(store.list('session_1')).toHaveLength(2);
  });

  // SELFHOST-007 TC-05: navigation (list-branches / ancestors / switch) delegates to the neutral tree.
  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'lists branch tips and switches the active branch via the neutral checkpoint tree',
    async () => {
      const cwd = makeProject();
      const store = await createStore(cwd);

      const a = await store.beginTurn({ sessionId: 'session_1', prompt: 'a' });
      await store.finalizeTurn();
      await store.beginTurn({ sessionId: 'session_1', prompt: 'b' });
      await store.finalizeTurn();
      const c = await store.beginTurn({ sessionId: 'session_1', prompt: 'c' });
      await store.finalizeTurn(); // a-b-c

      await store.restoreToCheckpoint('session_1', a.id);
      const d = await store.beginTurn({ sessionId: 'session_1', prompt: 'd' });
      await store.finalizeTurn(); // fork a-d

      expect(store.listCheckpointBranches('session_1').sort()).toEqual([c.id, d.id].sort());
      expect(store.checkpointAncestors('session_1', d.id)).toEqual([d.id, a.id]);

      // switch back to the original branch tip
      store.switchToCheckpoint('session_1', c.id);
      const e = await store.beginTurn({ sessionId: 'session_1', prompt: 'e' });
      await store.finalizeTurn(); // continues c -> e
      expect(store.checkpointAncestors('session_1', e.id).slice(0, 2)).toEqual([e.id, c.id]);
      expect(() => store.switchToCheckpoint('session_1', 'nope')).toThrow(/Unknown/);
    },
  );

  // SELFHOST-007 TC-05: the active-branch pointer survives a save→resume round-trip; drift degrades.
  // ARCH-047: project mutation is Linux-only (stable root-anchored host); refused elsewhere.
  it.runIf(process.platform === 'linux')(
    'captures and restores the active-branch pointer (and degrades gracefully on drift)',
    async () => {
      const cwd = makeProject();
      const store = await createStore(cwd);

      const a = await store.beginTurn({ sessionId: 'session_1', prompt: 'a' });
      await store.finalizeTurn();
      await store.beginTurn({ sessionId: 'session_1', prompt: 'b' });
      await store.finalizeTurn();
      await store.restoreToCheckpoint('session_1', a.id); // fork → active head = a, fresh branch

      const pointer = store.getActiveBranchPointer('session_1');
      expect(pointer).toEqual({ branchId: expect.stringMatching(/^branch-/), checkpointId: a.id });

      // A brand-new store (simulating --resume) restores the pointer from the persisted record.
      const resumed = await createStore(cwd);
      resumed.restoreActiveBranch('session_1', pointer);
      const next = await resumed.beginTurn({ sessionId: 'session_1', prompt: 'c' });
      await resumed.finalizeTurn();
      // the new turn diverges from 'a' (the restored branch head), not from 'b'
      expect(resumed.checkpointAncestors('session_1', next.id)).toEqual([next.id, a.id]);

      // Drift: a pointer referencing a checkpoint absent from the manifest store is ignored (no throw),
      // and the store keeps its linear-HEAD default.
      const drifted = await createStore(cwd);
      expect(() =>
        drifted.restoreActiveBranch('session_1', { branchId: 'ghost', checkpointId: 'turn-9999' }),
      ).not.toThrow();
      expect(drifted.getActiveBranchPointer('session_1')).toBeUndefined();
    },
  );
});
