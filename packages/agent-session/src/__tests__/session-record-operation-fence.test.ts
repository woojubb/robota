import { createProcessOperationLock } from '@robota-sdk/agent-node-lock';

import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProcessMarkers, writeOwnerOnlyFile } from '@robota-sdk/agent-core/node';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it } from 'vitest';

import { NodeSessionStore } from '../session-store.js';
import { StoredSessionRecords } from '../stored-session-record.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';
import type { TProcessMarkerRemoveResult } from '@robota-sdk/agent-core';

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function record(id: string, name: string): IInteractiveSessionRecord {
  return {
    id,
    name,
    cwd: '/work',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [],
  };
}

describe('record replacement and forced release', () => {
  it('excludes forced release from a second OS process while a save is replacing a record', () => {
    const root = mkdtempSync(join(tmpdir(), 'session-process-guard-'));
    roots.push(root);
    const id = 'session_guard';
    const directory = join(root, 'claims');
    const require = createRequire(import.meta.url);
    const markerModule = pathToFileURL(require.resolve('@robota-sdk/agent-core/node')).href;
    const lockModule = pathToFileURL(require.resolve('@robota-sdk/agent-session/node')).href;
    const child = `import { createProcessMarkers } from ${JSON.stringify(markerModule)}; import session from ${JSON.stringify(lockModule)}; const { createProcessOperationLock } = session; const directory = process.argv[1]; console.log(JSON.stringify(createProcessMarkers(directory, { operationLock: createProcessOperationLock(directory), lockWaitMs: 0 }).remove('session_guard', { force: true })));`;
    let result: string | undefined;
    const store = new StoredSessionRecords(
      'plain',
      {
        load: () => ({ file: { kind: 'absent' }, unreadable: { status: 'missing' } }),
        current: () => ({ kind: 'absent' }),
        replace: (_id, bytes) => {
          const run = spawnSync(process.execPath, ['--input-type=module', '-e', child, directory], {
            encoding: 'utf8',
            timeout: 10_000,
          });
          expect(run.status, run.stderr).toBe(0);
          result = JSON.parse(run.stdout).status as string;
          writeOwnerOnlyFile(join(root, `${id}.json`), bytes);
        },
      },
      createProcessMarkers(directory, { operationLock: createProcessOperationLock(directory) }),
    );
    const claim = store.claim(id, { fresh: true });
    try {
      store.save(record(id, 'first'), { claim });
      expect(result).toBe('busy');
    } finally {
      claim.release();
    }
  });

  for (const sealed of [false, true]) {
    it(`does not force-release during an in-flight ${sealed ? 'sealed' : 'plain'} replacement`, () => {
      const root = mkdtempSync(join(tmpdir(), 'session-operation-guard-'));
      roots.push(root);
      const id = 'session_guard';
      const file = join(root, `${id}.json`);
      const sealer = createTestArtifactSealer({ key: Buffer.alloc(32, 7) });
      const sealing = sealed ? { sealer } : 'plain';
      const breaker = createProcessMarkers(join(root, 'claims'), {
        lockWaitMs: 0,
        operationLock: createProcessOperationLock(join(root, 'claims')),
      });
      let forced: TProcessMarkerRemoveResult | undefined;
      const stale = new StoredSessionRecords(
        sealing,
        {
          load: () => ({ file: { kind: 'absent' }, unreadable: { status: 'missing' } }),
          current: () => ({ kind: 'absent' }),
          replace: (_id, bytes) => {
            forced = breaker.remove(id, { force: true });
            if (forced.status === 'removed') {
              const newer = new NodeSessionStore(root, { sealing });
              const newerClaim = newer.claim(id, { fresh: true });
              newer.save(record(id, 'newer-writer'), { claim: newerClaim });
              newerClaim.release();
            }
            writeOwnerOnlyFile(file, bytes);
          },
        },
        createProcessMarkers(join(root, 'claims'), {
          operationLock: createProcessOperationLock(join(root, 'claims')),
        }),
      );
      const oldClaim = stale.claim(id, { fresh: true });
      stale.save(record(id, 'current-writer'), { claim: oldClaim });
      expect(forced).toEqual({ status: 'busy' });
      expect(breaker.inspect(id).status).toBe('held');
      expect(existsSync(file)).toBe(true);
      const verifier = new NodeSessionStore(root, { sealing });
      const loaded = verifier.load(id);
      expect(loaded.status).toBe('valid');
      if (loaded.status === 'valid') expect(loaded.record.name).toBe('current-writer');
      expect(readFileSync(file).length).toBeGreaterThan(0);
      oldClaim.release();
    });
  }
});
