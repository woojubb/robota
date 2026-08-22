import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

import {
  NodeSessionStore,
  deserializeSessionArtifact,
  serializeSessionArtifact,
} from '@robota-sdk/agent-session';
import { describe, expect, it } from 'vitest';

import { loadSessionRecord } from '../interactive-session-restore.js';

import type { ISessionRecord } from '@robota-sdk/agent-session';
import type { IInteractiveSessionStore } from '../session-persistence.js';

/**
 * SELFHOST-014 TC-03 — an imported artifact resumes through the EXISTING `loadSessionRecord` path (no new resume
 * machinery): export → deserialize → store.save → loadSessionRecord rehydrates history/goal identically.
 */

function record(id: string): ISessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T01:00:00.000Z',
    messages: [{ role: 'user', content: 'resume me' }],
    history: [{ type: 'chat', text: 'resume me' }],
    goal: { objective: 'finish', status: 'active' },
  } as unknown as ISessionRecord;
}

function newStore(): NodeSessionStore {
  return new NodeSessionStore(mkdtempSync(path.join(tmpdir(), 'artifact-resume-')));
}

describe('imported session artifact resumes via loadSessionRecord (TC-03)', () => {
  it('rehydrates history + goal from an imported artifact through the existing resume path', () => {
    const source = record('sess_resume');
    const artifact = serializeSessionArtifact(source);

    // Import into a store and resume through the SAME loadSessionRecord path a local --resume uses.
    const store = newStore();
    store.save(deserializeSessionArtifact(artifact));

    const resumed = loadSessionRecord(
      store as unknown as IInteractiveSessionStore,
      'sess_resume',
      null,
    );

    expect(resumed.history).toEqual(source.history);
    expect(resumed.goal).toEqual(source.goal);
  });
});
