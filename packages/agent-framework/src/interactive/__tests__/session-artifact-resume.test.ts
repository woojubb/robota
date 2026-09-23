import { mkdtempSync, realpathSync } from 'node:fs';
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

/**
 * A record that actually satisfies the contract.
 *
 * TRANS-006: this was a stub cast through `as unknown as ISessionRecord` — a message with no `id`,
 * `timestamp` or `state`, and a history entry carrying a `text` member the contract does not
 * declare. It passed because the import path validated the envelope and one field. Now that the
 * importer decodes, a fixture that is not a record cannot pretend to be one, and the cast that let
 * it is gone.
 */
function record(id: string): ISessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T01:00:00.000Z',
    messages: [
      {
        id: 'm-0',
        role: 'user',
        content: 'resume me',
        timestamp: new Date('2026-07-19T00:30:00.000Z'),
        state: 'complete',
      },
    ],
    history: [
      {
        id: 'h-0',
        timestamp: new Date('2026-07-19T00:30:00.000Z'),
        category: 'chat',
        type: 'user',
        data: { text: 'resume me' },
      },
    ],
    goal: {
      id: 'g-0',
      objective: 'finish',
      status: 'active',
      iterations: 0,
      maxIterations: 5,
      startedAt: '2026-07-19T00:10:00.000Z',
      progress: [],
    },
  };
}

function newStore(): NodeSessionStore {
  return new NodeSessionStore(realpathSync(mkdtempSync(path.join(tmpdir(), 'artifact-resume-'))));
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

    // TRANS-006 recorded an asymmetry here — the import decoded and the store did not, so a record
    // that came back through the store carried ISO strings. TRANS-007 made the store decode too, so
    // the expectation is now the in-memory fixture, and this line is the evidence the gap closed.
    expect(resumed.history).toEqual(source.history);
    expect(resumed.goal).toEqual(source.goal);
    expect(deserializeSessionArtifact(artifact).history?.[0]?.timestamp).toBeInstanceOf(Date);
  });
});
