/**
 * A session a peer pushed here is a peer's record: a store that seals never tags it as
 * this owner's, not even over an id this store holds as the owner's, so its first resume asks.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { afterEach, describe, expect, it } from 'vitest';

import { saveReceivedSession } from '../handoff-receiving.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';

const directories: string[] = [];

afterEach(() => {
  for (const directory of directories.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function directory(): string {
  const value = realpathSync(mkdtempSync(join(tmpdir(), 'handoff-authorship-')));
  directories.push(value);
  return value;
}

function record(id: string, text: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/the/sender',
    createdAt: '2026-11-01T00:00:00.000Z',
    updatedAt: '2026-11-01T00:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: text,
        timestamp: new Date('2026-11-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
  };
}

describe('saving a session a peer pushed here', () => {
  it('never tags it, even over an id this store holds as the owner’s', () => {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });
    store.save(record('sess_shared', 'the owner wrote this'), { provenance: 'owner' });

    expect(saveReceivedSession(store, record('sess_shared', 'a peer sent this'), '/here')).toBe(
      true,
    );

    const stored = new NodeSessionStore(dir, { sealing: { sealer } }).load('sess_shared');
    if (stored.status !== 'valid') throw new Error(`expected valid, got ${stored.status}`);
    expect(stored.authorship).toBe('unverified');
    expect(stored.record.cwd).toBe('/here');
    expect(JSON.stringify(stored.record.messages)).toContain('a peer sent this');
  });

  it('never tags an id this store has not seen either', () => {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    const store = new NodeSessionStore(dir, { sealing: { sealer } });

    saveReceivedSession(store, record('sess_new', 'a peer sent this'), '/here');

    const stored = new NodeSessionStore(dir, { sealing: { sealer } }).load('sess_new');
    expect(stored.status === 'valid' ? stored.authorship : stored.status).toBe('unverified');
  });
});
