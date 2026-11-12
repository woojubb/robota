/**
 * A fork job run in this process while the keys are locked (secure conversation).
 *
 * `/fork` writes the copy sealed — sealing needs no unlock — and the in-process runner restores it
 * through the same store instance. The restore used to ask `load` alone, which says `locked`, so the
 * fork job failed although this very store had just written the record. The fork write is kept apart
 * from the sessions the store runs, so a busy store does not push it out before the job starts, and
 * the fork does not push out a running session either.
 */

import { mkdtempSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createTestArtifactSealer } from '@robota-sdk/agent-core/testing';
import { loadSessionForUpdate } from '@robota-sdk/agent-session';
import { NodeSessionStore } from '@robota-sdk/agent-session/node';
import { describe, expect, it, vi } from 'vitest';

import { writeForkedSessionRecord } from '../interactive-session-fork-record.js';
import { restoreSessionRecordIntoSession } from '../interactive-session-restore.js';

import type { IInteractiveSessionRecord } from '@robota-sdk/agent-interface/session';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

const CANARY = 'CANARY-in-process-fork-9b31-conversation';

function message(content: string): TUniversalMessage {
  return {
    id: `m-${content.length}`,
    role: 'user',
    content,
    timestamp: new Date('2026-09-01T00:00:00.000Z'),
    state: 'complete',
  } as TUniversalMessage;
}

function record(id: string): IInteractiveSessionRecord {
  return {
    id,
    cwd: '/work',
    createdAt: '2026-09-01T00:00:00.000Z',
    updatedAt: '2026-09-01T00:00:00.000Z',
    messages: [message(`a running session ${id}`)],
  };
}

function lockedSealedStore() {
  const dir = realpathSync(mkdtempSync(join(tmpdir(), 'framework-fork-locked-')));
  const sealer = createTestArtifactSealer({ locked: true });
  return { sealer, store: new NodeSessionStore(dir, { sealing: { sealer } }) };
}

/** `/fork`'s write, from a live session holding the canary. */
function forkFrom(store: NodeSessionStore): string {
  return writeForkedSessionRecord({
    source: {
      getHistory: () => [message(CANARY)],
      getSystemMessage: () => 'the parent prompt',
      getSystemPromptManifest: () => undefined,
      getToolSchemas: () => [],
    },
    fullHistory: () => [],
    sessionStore: store,
    requestedName: undefined,
    sourceName: 'parent',
    sourceId: 'sess_parent',
    cwd: '/work',
  }).sessionId;
}

function childSession() {
  return {
    injectRawMessage: vi.fn(),
    restoreConversation: vi.fn(),
    updateSystemMessage: vi.fn(),
    syncContextFromHistory: vi.fn(),
  };
}

describe('a fork job in this process while the keys are locked', () => {
  it('restores the fork this store just wrote', () => {
    const { store } = lockedSealedStore();
    const forkId = forkFrom(store);
    const session = childSession();

    restoreSessionRecordIntoSession(
      store,
      forkId,
      session as never,
      loadSessionForUpdate(store, forkId),
    );

    expect(session.injectRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: CANARY }),
    );
    // The parent's sections travel with its prompt; this parent knew none, so the copy claims none.
    expect(session.updateSystemMessage).toHaveBeenCalledWith('the parent prompt', undefined);
  });

  it('still restores it after many other sessions were saved through the store', () => {
    const { store } = lockedSealedStore();
    const forkId = forkFrom(store);
    for (let index = 0; index < 40; index += 1) store.save(record(`sess_other_${index}`));
    const session = childSession();

    restoreSessionRecordIntoSession(
      store,
      forkId,
      session as never,
      loadSessionForUpdate(store, forkId),
    );

    expect(session.injectRawMessage).toHaveBeenCalledWith(
      expect.objectContaining({ content: CANARY }),
    );
  });

  it('does not push a running session out of what the store holds', () => {
    const { store } = lockedSealedStore();
    const running = Array.from({ length: 32 }, (_, index) => `sess_running_${index}`);
    for (const id of running) store.save(record(id));

    forkFrom(store);

    for (const id of running) expect(store.loadHeld?.(id)?.status, id).toBe('valid');
  });
});
