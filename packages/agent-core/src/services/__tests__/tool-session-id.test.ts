import { afterEach, describe, expect, it } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';
import type { IToolExecutionContext } from '../../interfaces/tool';

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});

function fixture(seen: Array<string | undefined>, calls = 1, rounds = 1) {
  const scripted = createScriptedProvider([
    ...Array.from({ length: rounds }, (_, round) => ({
      toolCalls: Array.from({ length: calls }, (_, n) => ({
        name: 'probe',
        args: { n: round * calls + n },
      })),
    })),
    { text: 'done' },
  ]);
  const agent = new ConversationAgent({
    name: 'session-id-test',
    toolExecutionPolicy: (batch) => ({
      scheduling: new Map(batch.map((call) => [call.id, { resources: [] }])),
    }),
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    tools: [
      new FunctionTool(
        {
          name: 'probe',
          description: 'Records the session id its context carries',
          parameters: { type: 'object', properties: { n: { type: 'number' } } },
        },
        async (_parameters, context?: IToolExecutionContext) => {
          seen.push(context?.sessionId);
          return 'ok';
        },
      ),
    ],
  });
  agents.push(agent);
  return agent;
}

describe('tool context session id', () => {
  it('gives a tool the session id of the run, not the conversation id', async () => {
    const seen: Array<string | undefined> = [];
    await fixture(seen).run('go', { sessionId: 'session-A' });
    expect(seen).toEqual(['session-A']);
  });

  it('gives every call of a parallel batch the same session id', async () => {
    const seen: Array<string | undefined> = [];
    await fixture(seen, 3).run('go', { sessionId: 'session-A' });
    expect(seen).toEqual(['session-A', 'session-A', 'session-A']);
  });

  it('leaves the id absent when the run has none', async () => {
    const seen: Array<string | undefined> = [];
    await fixture(seen).run('go');
    expect(seen).toEqual([undefined]);
  });

  it('keeps an id a direct caller set explicitly', async () => {
    const seen: Array<string | undefined> = [];
    const agent = fixture(seen);
    await agent.invokeRuntimeTool(
      'probe',
      {},
      { toolName: 'probe', parameters: {}, executionId: 'direct', sessionId: 'caller-set' },
    );
    expect(seen).toEqual(['caller-set']);
  });

  it('gives recovered tool batches the session id they are resumed under', async () => {
    const records: TExecutionJournalRecord[] = [];
    await expect(
      fixture([], 2).run('go', {
        sessionId: 'session-A',
        executionJournal: {
          append: async (record) => {
            records.push(structuredClone(record));
            if (record.kind === 'model-response') throw new Error('lost acknowledgement');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const response = records.find((record) => record.kind === 'model-response');
    if (!response || response.kind !== 'model-response') throw new Error('missing fixture');
    const journal = {
      read: async () => structuredClone(records),
      append: async (record: TExecutionJournalRecord) => {
        if (!records.some((entry) => entry.recordId === record.recordId))
          records.push(structuredClone(record));
      },
    };
    const seen: Array<string | undefined> = [];
    await fixture(seen, 2).resumeToolCalls({
      executionId: response.executionId,
      callId: response.callId,
      journal,
      sessionId: 'session-A',
    });
    expect(seen).toEqual(['session-A', 'session-A']);
  });

  it('gives a round dispatched after a continuation the session id it continues under', async () => {
    const records: TExecutionJournalRecord[] = [];
    const first: Array<string | undefined> = [];
    let requests = 0;
    await expect(
      fixture(first, 1, 2).run('go', {
        sessionId: 'session-A',
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'model-request' && ++requests === 2)
              throw new Error('stop before next call');
            records.push(structuredClone(record));
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(first).toEqual(['session-A']);
    const journal = {
      read: async () => structuredClone(records),
      append: async (record: TExecutionJournalRecord) => {
        if (!records.some((entry) => entry.recordId === record.recordId))
          records.push(structuredClone(record));
      },
    };
    const seen: Array<string | undefined> = [];
    await fixture(seen, 1, 1).resume({
      executionId: records[0]!.executionId,
      journal,
      sessionId: 'session-A',
    });
    expect(seen).toEqual(['session-A']);
  });
});
