import { existsSync, mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDirectoryEditCheckpointState } from '../../checkpoints/edit-checkpoint-state-storage.js';
import { EditCheckpointStore } from '../../checkpoints/edit-checkpoint-store.js';
import { createTrustedProjectAccessFixture } from '../../testing/trusted-project-state-fixture.js';
import { createWorkspaceProjectMutation } from '../../workspace-trust/index.js';
import { InteractiveSession } from '../interactive-session.js';

import type { IAIProvider, IAssistantMessage } from '@robota-sdk/agent-core';

/**
 * Rolling back through a session's first checkpoint clears the branch head on purpose: the next turn
 * starts a fresh root line instead of continuing the line that was rolled back. That choice is part
 * of the saved session, so a resumed session makes it again; a record without it would continue from
 * the latest checkpoint, the line the person rolled back.
 *
 * The checkpoint state lives outside the project (a directory the test owns) and no turn edits a
 * file, so nothing here needs a project write host and the test runs on every platform.
 */
const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'agent-rollback-resume-')));
const ORIGINAL_HOME = process.env.HOME;

beforeEach(() => {
  const home = join(TMP_BASE, 'home');
  mkdirSync(home, { recursive: true });
  process.env.HOME = home;
});

afterEach(() => {
  process.env.HOME = ORIGINAL_HOME;
  if (existsSync(TMP_BASE)) rmSync(TMP_BASE, { recursive: true, force: true });
});

let replies = 0;

function reply(content: string): IAssistantMessage {
  replies += 1;
  return {
    id: `reply-${replies}`,
    role: 'assistant',
    content,
    state: 'complete',
    timestamp: new Date('2026-11-04T00:00:00.000Z'),
  };
}

function createProvider(): IAIProvider {
  return {
    name: 'mock',
    version: 'test',
    chat: vi.fn(async () => reply('done')),
    generateResponse: vi.fn(),
    supportsTools: () => true,
    validateConfig: () => true,
  } as unknown as IAIProvider;
}

async function checkpointStore(project: string, state: string): Promise<EditCheckpointStore> {
  const access = await createTrustedProjectAccessFixture(project);
  if (access.status !== 'trusted') throw new Error('expected trusted project fixture');
  return new EditCheckpointStore({
    authority: access.authority,
    mutation: createWorkspaceProjectMutation(access.authority, {
      status: 'approved',
      purpose: 'rollback resume test',
    }),
    stateStorage: createDirectoryEditCheckpointState(state),
    sealing: 'plain',
  });
}

describe('a rollback through the first checkpoint, then a resume', () => {
  it('starts the next turn on a fresh root line, as it did before the resume', async () => {
    const project = join(TMP_BASE, 'project');
    const state = join(TMP_BASE, 'checkpoint-state');
    mkdirSync(project, { recursive: true });
    const sessions = new NodeSessionStore(join(TMP_BASE, 'sessions'), { sealing: 'plain' });

    const first = new InteractiveSession({
      cwd: project,
      provider: createProvider(),
      bare: true,
      sessionStore: sessions,
      editCheckpointStore: await checkpointStore(project, state),
    });
    await first.submit('first turn');
    const [root] = first.listEditCheckpoints();
    await first.rollbackEditCheckpoint(root!.id);
    const sessionId = root!.sessionId;

    // The saved record says the head was cleared, not that there was no head.
    const saved = sessions.load(sessionId);
    expect(saved.status).toBe('valid');
    expect(saved.status === 'valid' ? saved.record.activeBranch : undefined).toEqual({
      branchId: expect.any(String),
      checkpointId: null,
    });

    const resumedStore = await checkpointStore(project, state);
    const resumed = new InteractiveSession({
      cwd: project,
      provider: createProvider(),
      bare: true,
      sessionStore: sessions,
      resumeSessionId: sessionId,
      editCheckpointStore: resumedStore,
    });
    await resumed.submit('second turn');

    const [rolledBack, next] = resumed.listEditCheckpoints();
    expect(next?.id).not.toBe(rolledBack?.id);
    // A new root: its line starts and ends with itself, so the rolled-back line stays a line of its own.
    expect(resumedStore.checkpointAncestors(sessionId, next!.id)).toEqual([next!.id]);
    expect([...resumed.listCheckpointBranches()].sort()).toEqual([rolledBack!.id, next!.id].sort());
  });
});
