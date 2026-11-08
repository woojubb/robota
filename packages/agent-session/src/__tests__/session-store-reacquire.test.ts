import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createProcessMarkers } from '@robota-sdk/agent-core/node';
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { createProcessOperationLock } from '@robota-sdk/agent-os/node-lock';
import { expect, it } from 'vitest';

import { NodeSessionStore } from '../session-store.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

function record(text: string): IInteractiveSessionRecord {
  return {
    id: 'session_a',
    cwd: '/work',
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-01-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

it.each(['plain', 'sealed'] as const)(
  'refuses a stale %s save after forced release and same-process reacquisition',
  (mode) => {
    const root = mkdtempSync(join(tmpdir(), 'session-reacquire-'));
    const sealing = mode === 'plain' ? 'plain' : { sealer: createTestArtifactSealer() };
    const directory = join(root, 'claims');
    const breaker = createProcessMarkers(directory, {
      operationLock: createProcessOperationLock(directory),
      lockWaitMs: 0,
    });
    try {
      const older = new NodeSessionStore(root, { sealing });
      const olderClaim = older.claim('session_a', { fresh: true });
      older.save(record('old'), { claim: olderClaim });
      expect(breaker.remove('session_a', { force: true }).status).toBe('removed');

      const newer = new NodeSessionStore(root, { sealing });
      const newerClaim = newer.claim('session_a');
      newer.save(record('new'), { claim: newerClaim });
      expect(() => older.save(record('stale'), { claim: olderClaim })).toThrow();
      olderClaim.release();
      expect(newer.hasWriter('session_a')).toBe(true);
      expect(newer.load('session_a')).toMatchObject({ status: 'valid', record: record('new') });
      newerClaim.release();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  },
);
