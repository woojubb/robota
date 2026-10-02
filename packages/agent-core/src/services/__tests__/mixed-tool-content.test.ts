import { mkdtempSync, readFileSync, writeFileSync, appendFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { createScriptedProvider } from '../../testing/scripted-provider';
import type { TUniversalMessagePart } from '../../interfaces/messages';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';

const parts: TUniversalMessagePart[] = [
  { type: 'text', text: 'Snapshot description' },
  { type: 'image_inline', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
  { type: 'resource_link', uri: 'fixture://snapshot-1', name: 'snapshot' },
  { type: 'resource_embedded', uri: 'fixture://receipt', text: 'persisted effect' },
  { type: 'resource_embedded', uri: 'fixture://binary', blob: 'YmluYXJ5' },
  { type: 'audio_inline', mimeType: 'audio/wav', data: 'YXVkaW8=' },
];

describe('mixed tool observations through the runtime', () => {
  it.each([true, false])(
    'retains mixed observations in requests and receipts for success=%s',
    async (success) => {
      const scripted = createScriptedProvider([
        { text: 'ready' },
        { toolCalls: [{ name: 'observe', args: {} }] },
        { text: 'done' },
      ]);
      const agent = new ConversationAgent({
        name: 'mixed-content-fixture',
        aiProviders: [scripted.provider],
        defaultModel: { provider: scripted.provider.name, model: 'fixture' },
      });
      const records: TExecutionJournalRecord[] = [];
      try {
        await agent.run('initialize');
        await agent.updateTools([
          {
            schema: {
              name: 'observe',
              description: 'Observe fixture',
              parameters: { type: 'object', properties: {} },
            },
            getName: () => 'observe',
            getDescription: () => 'Observe fixture',
            validate: () => true,
            validateParameters: () => ({ isValid: true, errors: [] }),
            setEventService: () => {},
            execute: async () => ({
              success,
              data: { revision: 'snapshot-1' },
              parts,
              ...(!success ? { error: 'Partial observation failed' } : {}),
            }),
          },
        ]);
        await agent.run('observe', {
          executionJournal: {
            append: async (record) => {
              records.push(record);
            },
          },
        });
        const observation = scripted.requests[2].find((message) => message.role === 'tool');
        expect(observation?.content).toContain('snapshot-1');
        expect(observation?.parts).toEqual(parts);
        expect(agent.getHistory().find((message) => message.role === 'tool')?.parts).toEqual(parts);
        const receipt = records.find((record) => record.kind === 'tool-result');
        expect(receipt).toMatchObject({ result: { result: { revision: 'snapshot-1' }, parts } });
      } finally {
        await agent.destroy();
      }
    },
  );
});

it('restores mixed observations from a durable receipt without repeating the tool effect', async () => {
  const root = mkdtempSync(join(tmpdir(), 'mixed-tool-recovery-'));
  const ledger = join(root, 'journal.jsonl');
  const counter = join(root, 'effects');
  writeFileSync(ledger, '');
  writeFileSync(counter, '0');
  let loseAcknowledgement = true;
  const journal = {
    append: async (record: TExecutionJournalRecord) => {
      appendFileSync(ledger, JSON.stringify(record) + '\n');
      if (record.kind === 'tool-result' && loseAcknowledgement) {
        loseAcknowledgement = false;
        throw new Error('Lost acknowledgement after durable settlement');
      }
    },
    read: async () =>
      readFileSync(ledger, 'utf8')
        .trim()
        .split('\n')
        .map(
          (line) =>
            JSON.parse(line, (key, value: unknown) =>
              key === 'timestamp' && typeof value === 'string' ? new Date(value) : value,
            ) as TExecutionJournalRecord,
        ),
  };
  const tool = {
    schema: {
      name: 'observe',
      description: 'Observe fixture',
      parameters: { type: 'object' as const, properties: {} },
    },
    getName: () => 'observe',
    getDescription: () => 'Observe fixture',
    validate: () => true,
    validateParameters: () => ({ isValid: true, errors: [] }),
    setEventService: () => {},
    execute: async () => {
      writeFileSync(counter, String(Number(readFileSync(counter, 'utf8')) + 1));
      return { success: true, data: { revision: 'snapshot-1' }, parts };
    },
  };
  const source = createScriptedProvider([{ toolCalls: [{ name: 'observe', args: {} }] }]);
  const restored = createScriptedProvider([{ text: 'done' }]);
  const create = (script: typeof source) =>
    new ConversationAgent({
      name: 'mixed-recovery',
      aiProviders: [script.provider],
      defaultModel: { provider: script.provider.name, model: 'fixture' },
      tools: [tool],
    });
  const first = create(source);
  const fresh = create(restored);
  try {
    await expect(first.run('observe', { executionJournal: journal })).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
    });
    await first.destroy();
    const response = (await journal.read()).find((record) => record.kind === 'model-response');
    if (!response) throw new Error('Missing durable model response');
    await fresh.resume({ executionId: response.executionId, journal });
    expect(readFileSync(counter, 'utf8')).toBe('1');
    expect(restored.requests[0].find((message) => message.role === 'tool')).toMatchObject({
      content: '{"revision":"snapshot-1"}',
      parts,
    });
  } finally {
    await first.destroy();
    await fresh.destroy();
    rmSync(root, { recursive: true, force: true });
  }
});
