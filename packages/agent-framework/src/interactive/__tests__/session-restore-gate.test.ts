/**
 * Restoring a record into a session a runner already built.
 *
 * Every path that turns a stored record into a conversation passes the same gate: a record a store
 * that seals calls unverified is refused, and the helper never reads the store on its own behalf, so
 * no caller can restore from a read nobody gated.
 */

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { isSessionAuthorshipRefusedError } from '../session-authorship-gate.js';
import { restoreSessionRecordIntoSession } from '../interactive-session-restore.js';
import {
  cleanUpSealedSessionFixtures,
  directory,
  forgeRecord,
  record,
  sealedStore,
  writeOwnerRecord,
} from './helpers/sealed-session-fixtures.js';

const FORGED_TEXT = 'CANARY-restore-gate-forged-4d1a';

function builtSession() {
  return {
    injectRawMessage: vi.fn(),
    restoreConversation: vi.fn(),
    updateSystemMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
}

afterEach(cleanUpSealedSessionFixtures);

describe('restoring a record into a session a runner built', () => {
  it('refuses a record nobody vouched for, and restores nothing of it', () => {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    forgeRecord(dir, sealer, record('sess_planted', '/work', FORGED_TEXT));
    const store = sealedStore(dir, sealer);
    const session = builtSession();

    let refusal: unknown;
    try {
      restoreSessionRecordIntoSession(
        store,
        'sess_planted',
        session as never,
        store.load('sess_planted', { hold: true }),
      );
    } catch (error) {
      refusal = error;
    }

    expect(isSessionAuthorshipRefusedError(refusal)).toBe(true);
    expect((refusal as Error).message).not.toContain(FORGED_TEXT);
    expect(session.injectRawMessage).not.toHaveBeenCalled();
  });

  it('restores a record the owner wrote', () => {
    const dir = directory();
    const sealer = createTestArtifactSealer();
    writeOwnerRecord(dir, sealer, record('sess_owner', '/work', 'the owner wrote this'));
    const store = sealedStore(dir, sealer);
    const session = builtSession();

    restoreSessionRecordIntoSession(
      store,
      'sess_owner',
      session as never,
      store.load('sess_owner', { hold: true }),
    );

    expect(session.injectRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: 'the owner wrote this' }),
    );
  });
});
