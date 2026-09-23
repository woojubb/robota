import { mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import { createAgentRuntime, createNodeHostSessionStore } from '../src/index.js';

const RESUME_SESSION_ID = 'fork-record-persistence-example';
const PROMPT = 'Continue the copied fork record.';
const RESPONSE = 'The fork record was updated.';

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

async function main(): Promise<void> {
  const cwd = realpathSync(mkdtempSync(join(tmpdir(), 'robota-fork-record-')));
  const sessionStore = createNodeHostSessionStore(join(cwd, 'sessions'));
  sessionStore.save({
    id: RESUME_SESSION_ID,
    name: 'parent (fork)',
    cwd,
    createdAt: '2026-08-01T00:00:00.000Z',
    updatedAt: '2026-08-01T00:00:00.000Z',
    messages: [
      {
        id: 'copied-user',
        role: 'user',
        content: 'The parent conversation was copied.',
        timestamp: new Date('2026-08-01T00:00:00.000Z'),
        state: 'complete',
      },
    ],
    systemPrompt: 'The copied parent prompt.',
  });

  try {
    const scripted = createScriptedProvider([{ text: RESPONSE }]);
    const runtime = createAgentRuntime({
      cwd,
      provider: scripted.provider,
      sessionStore,
      commandModules: [{ name: 'agent-runtime-example', sessionRequirements: ['agent-runtime'] }],
    });
    const session = runtime.createSession({});
    const job = await session.spawnAgentJob({
      agentType: 'general-purpose',
      label: 'Fork record persistence',
      mode: 'background',
      prompt: PROMPT,
      resumeSessionId: RESUME_SESSION_ID,
    });
    const result = await session.waitAgentJob(job.id);
    const loaded = sessionStore.load(RESUME_SESSION_ID);
    assertCondition(
      loaded.status === 'valid',
      'the fork record could not be loaded after the turn',
    );
    const contents =
      loaded.status === 'valid'
        ? loaded.record.messages.map((message) => String(message.content))
        : [];

    assertCondition(result.output === RESPONSE, 'the fork provider response was not returned');
    assertCondition(contents.includes(PROMPT), 'the fork prompt was not persisted');
    assertCondition(contents.includes(RESPONSE), 'the fork response was not persisted');
    await session.shutdown();
    process.stdout.write('FORK_RECORD_PERSISTENCE_PASS\n');
  } finally {
    rmSync(cwd, { recursive: true, force: true });
  }
}

await main();
