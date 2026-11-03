/**
 * How the resume listings treat records a store that seals does not verify as the owner's (#3679):
 * whose each record is rides on its summary, unverified records come after every verified one — a
 * time a record gives itself never ranks it among the owner's — a name such a record gives itself
 * answers for nothing, and an empty one is never reused. A plain store lists with no authorship. A
 * host that must judge the record a session actually restores from is handed the claim's own read.
 */
import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

import {
  listResumableSessions,
  resolveReusableEmptySessionId,
  resolveSessionIdByIdOrName,
} from '../session-persistence.js';
import {
  claimable,
  cleanUpSealedSessionFixtures,
  construct,
  directory,
  forgeRecord,
  record,
  sealedStore,
  sessionOptions,
  writeOwnerRecord,
} from './helpers/sealed-session-fixtures.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface-session';

afterEach(cleanUpSealedSessionFixtures);

function at(
  id: string,
  cwd: string,
  updatedAt: string,
  extra: Partial<IInteractiveSessionRecord> = {},
): IInteractiveSessionRecord {
  return record(id, cwd, `the request of ${id}`, { updatedAt, ...extra });
}

describe('the resume listing over a store that seals', () => {
  it('says whose each record is, and lists unverified ones after every verified one', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, at('sess_old', cwd, '2026-11-01T01:00:00.000Z'));
    writeOwnerRecord(dir, sealer, at('sess_new', cwd, '2026-11-01T02:00:00.000Z'));
    forgeRecord(dir, sealer, at('sess_future', cwd, '2999-01-01T00:00:00.000Z'));
    forgeRecord(dir, sealer, at('sess_planted', cwd, '2026-11-01T00:30:00.000Z'));

    const listed = listResumableSessions(sealedStore(dir, sealer), cwd).sessions;

    expect(listed.map((session) => [session.id, session.authorship])).toEqual([
      ['sess_new', 'verified'],
      ['sess_old', 'verified'],
      ['sess_future', 'unverified'],
      ['sess_planted', 'unverified'],
    ]);
  });

  it('answers a name only from a verified record; an unverified one is reached by its id', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(
      dir,
      sealer,
      at('sess_planted', cwd, '2026-11-01T01:00:00.000Z', { name: 'deploy' }),
    );
    writeOwnerRecord(
      dir,
      sealer,
      at('sess_mine', cwd, '2026-11-01T00:00:00.000Z', { name: 'mine' }),
    );
    const store = sealedStore(dir, sealer);

    expect(resolveSessionIdByIdOrName(store, 'deploy')).toMatchObject({ status: 'not-found' });
    expect(resolveSessionIdByIdOrName(store, 'sess_planted')).toEqual({
      status: 'found',
      id: 'sess_planted',
    });
    expect(resolveSessionIdByIdOrName(store, 'mine')).toEqual({ status: 'found', id: 'sess_mine' });
  });

  it('never reuses an empty record nobody vouched for', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, {
      ...at('sess_planted', cwd, '2026-11-01T05:00:00.000Z'),
      messages: [],
    });
    const store = sealedStore(dir, sealer);

    expect(resolveReusableEmptySessionId(store, cwd)).toBeUndefined();
    writeOwnerRecord(dir, sealer, {
      ...at('sess_mine', cwd, '2026-11-01T01:00:00.000Z'),
      messages: [],
    });
    expect(resolveReusableEmptySessionId(store, cwd)).toBe('sess_mine');
  });
});

describe('the resume listing over a store that never seals', () => {
  it('lists a plain store newest first with no authorship, and matches names and empty sessions', () => {
    const cwd = directory();
    const dir = directory();
    const plain = new NodeSessionStore(dir, { sealing: 'plain' });
    plain.save(at('sess_old', cwd, '2026-11-01T01:00:00.000Z', { name: 'old' }));
    plain.save({ ...at('sess_new', cwd, '2026-11-01T02:00:00.000Z'), messages: [] });

    const listed = listResumableSessions(plain, cwd).sessions;

    expect(listed).toEqual([
      {
        id: 'sess_new',
        cwd,
        updatedAt: '2026-11-01T02:00:00.000Z',
        messageCount: 0,
        preview: '',
      },
      {
        id: 'sess_old',
        name: 'old',
        cwd,
        updatedAt: '2026-11-01T01:00:00.000Z',
        messageCount: 2,
        preview: 'an answer to the request of sess_old',
        title: 'the request of sess old',
      },
    ]);
    expect(resolveSessionIdByIdOrName(plain, 'old')).toEqual({ status: 'found', id: 'sess_old' });
    expect(resolveReusableEmptySessionId(plain, cwd)).toBe('sess_new');
  });
});

describe('a host’s check of the record a session restores from', () => {
  it('is handed the claim’s own read, and a refusal there lets the claim go', () => {
    const cwd = directory();
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, at('sess_mine', cwd, '2026-11-01T01:00:00.000Z'));
    const store = sealedStore(dir, sealer);
    const seen: string[] = [];

    const refused = construct(
      sessionOptions(cwd, store, {
        resumeSessionId: 'sess_mine',
        checkRestoredRecord: (restored) => {
          seen.push(JSON.stringify(restored.messages));
          throw new Error('the host refuses this record');
        },
      }),
    );

    expect((refused.error as Error).message).toBe('the host refuses this record');
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain('the request of sess_mine');
    expect(claimable(store, 'sess_mine')).toBe(true);
  });
});
