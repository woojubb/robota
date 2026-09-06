import { mkdtempSync, rmSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { createScriptedProvider } from '@robota-sdk/agent-core/testing';

import type { IMemoryBudget, IMemoryStore, IPerTurnRecallConfig } from '../src/index.js';
import { InteractiveSession } from '../src/index.js';

const PROMPT = 'MEM-2055 how do I rotate the deploy key?';
const RECALL_BODY = '### deploy\nThe staging deploy key rotates every 30 days.';
const BUDGET: IMemoryBudget = { maxTopics: 4, maxTopicChars: 2000 };
const RECALL_MEMORY: IPerTurnRecallConfig = { budget: BUDGET };
const REFERENCE = { topic: 'deploy', path: 'deploy.md', score: 5, truncated: false };

function assertCondition(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}

function createFakeMemoryStore(): IMemoryStore {
  return {
    loadStartupMemory: async () => ({ content: '', path: '', lineCount: 0, truncated: false }),
    list: async () => ({ indexPath: '', topicsPath: '', topics: [] }),
    readTopic: async () => '',
    append: async () => ({ indexPath: '', topicPath: '', topic: 'x', deduplicated: false }),
    recall: async () => ({ content: RECALL_BODY, references: [REFERENCE], truncated: false }),
    getPending: async () => undefined,
    listPending: async () => [],
    markPending: async () => {
      throw new Error('markPending is not exercised by this scenario');
    },
    upsertPending: async () => {
      throw new Error('upsertPending is not exercised by this scenario');
    },
  };
}

async function main(): Promise<void> {
  const cwd = mkdtempSync(join(tmpdir(), 'mem-2055-example-'));
  let session: InteractiveSession | undefined;
  let result: { usedMemoryReferences: unknown; emittedMemoryEventTypes: string[] } | undefined;

  try {
    const { provider } = createScriptedProvider([{ text: 'ok' }]);
    session = new InteractiveSession({
      cwd,
      provider,
      bare: true,
      memoryStore: createFakeMemoryStore(),
      recallMemory: RECALL_MEMORY,
    });
    const emitted: string[] = [];
    session.on('memory_event', (event) => emitted.push((event as { type: string }).type));

    await session.submit(PROMPT);

    const usedMemoryReferences = session.getUsedMemoryReferences();
    assertCondition(
      usedMemoryReferences.length === 1,
      '/memory used did not record the recalled reference',
    );
    assertCondition(
      emitted.length === 1 && emitted[0] === 'memory_retrieved',
      'no memory_retrieved event was emitted for the recall',
    );

    result = { usedMemoryReferences, emittedMemoryEventTypes: emitted };
  } finally {
    await session?.shutdown();
    rmSync(cwd, { recursive: true, force: true });
  }

  assertCondition(result !== undefined, 'scenario did not produce a result');
  assertCondition(!existsSync(cwd), 'scenario cleanup did not remove its temporary directory');
  process.stdout.write(
    `${JSON.stringify({ scenario: 'MEM-2055', ...result, cleanupRemoved: true })}\n`,
  );
}

await main();
