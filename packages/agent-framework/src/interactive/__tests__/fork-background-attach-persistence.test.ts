/**
 * CLI-1994 / BEHAVIOR-2675 — a background job that resumes a fork updates the record attach opens.
 *
 * This drives the public InteractiveSession job API over a real runtime and NodeSessionStore. The
 * parent record is a separate saved record; only the copied fork record receives the child turn.
 */

import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';
import { NodeSessionStore } from '@robota-sdk/agent-session';
import { afterEach, describe, expect, it } from 'vitest';

import { createAgentRuntime } from '../../runtime/agent-runtime.js';

const PARENT_ID = 'session_cli-1994-parent';
const FORK_ID = 'session_cli-1994-fork';
const PROMPT = 'Continue the forked work.';
const RESPONSE = 'The forked work is current.';

describe('background fork persistence for attach (BEHAVIOR-2675)', () => {
  let cwd: string | undefined;

  afterEach(() => {
    if (cwd !== undefined) rmSync(cwd, { recursive: true, force: true });
    cwd = undefined;
  });

  it('updates the fork record while leaving the parent record separate', async () => {
    cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-2675-')));
    const store = new NodeSessionStore(join(cwd, 'sessions'));
    const copiedMessages = [
      {
        id: 'copied-user',
        role: 'user' as const,
        content: 'The parent work was copied.',
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete' as const,
      },
    ];
    store.save({
      id: PARENT_ID,
      cwd,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      messages: copiedMessages,
    });
    store.save({
      id: FORK_ID,
      name: 'parent (fork)',
      cwd,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-01T00:00:00.000Z',
      messages: copiedMessages,
      systemPrompt: 'The copied parent prompt.',
    });
    const parentBefore = store.load(PARENT_ID);
    const scripted = createScriptedProvider([{ text: RESPONSE }]);
    const runtime = createAgentRuntime({
      cwd,
      provider: scripted.provider,
      sessionStore: store,
      commandModules: [{ name: 'agent-runtime-test', sessionRequirements: ['agent-runtime'] }],
    });
    const session = runtime.createSession({});

    try {
      const task = await session.spawnAgentJob({
        agentType: 'general-purpose',
        label: 'Forked work',
        mode: 'background',
        prompt: PROMPT,
        resumeSessionId: FORK_ID,
      });
      const result = await session.waitAgentJob(task.id);

      expect(result.output).toBe(RESPONSE);
      const forkAfter = store.load(FORK_ID);
      expect(forkAfter.status).toBe('valid');
      if (forkAfter.status !== 'valid') return;
      const forkContents = forkAfter.record.messages.map((message) => String(message.content));
      expect(forkContents).toContain(PROMPT);
      expect(forkContents).toContain(RESPONSE);
      expect(store.load(PARENT_ID)).toEqual(parentBefore);
    } finally {
      await session.shutdown();
    }
  });
});
