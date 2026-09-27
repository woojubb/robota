import { afterEach, describe, expect, it, vi } from 'vitest';
import { Robota } from '../../core/robota';
import { createScriptedProvider } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';

const agents: Robota[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});

function fixture() {
  const scripted = createScriptedProvider([
    {
      toolCalls: [
        { name: 'act', args: { n: 1 } },
        { name: 'act', args: { n: 2 } },
      ],
    },
    { text: 'done' },
  ]);
  const effect = vi.fn(async (parameters: { n?: unknown }) => `result ${parameters.n}`);
  const agent = new Robota({
    name: 'resume-test',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    tools: [
      new FunctionTool(
        {
          name: 'act',
          description: 'Test action',
          parameters: {
            type: 'object',
            properties: { n: { type: 'number' } },
          },
        },
        effect,
      ),
    ],
  });
  agents.push(agent);
  return { agent, effect, ...scripted };
}

async function stoppedAt(kind: TExecutionJournalRecord['kind'], afterWrite = false) {
  const source = fixture();
  const records: TExecutionJournalRecord[] = [];
  const append = async (record: TExecutionJournalRecord) => {
    if (record.kind === kind && !afterWrite) throw new Error('crash boundary');
    records.push(structuredClone(record));
    if (record.kind === kind) throw new Error('lost acknowledgement');
  };
  await expect(
    source.agent.run('perform actions', {
      executionJournal: { append },
      ephemeralSystemContext: 'Only this invocation sees this instruction',
    }),
  ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
  const response = records.find((record) => record.kind === 'model-response');
  if (!response || response.kind !== 'model-response') throw new Error('Missing response fixture');
  const journal = {
    read: vi.fn(async () => structuredClone(records)),
    append: vi.fn(async (record: TExecutionJournalRecord) => {
      const existing = records.find((entry) => entry.recordId === record.recordId);
      if (existing) expect(record).toEqual(existing);
      else records.push(structuredClone(record));
    }),
  };
  return { source, records, journal, executionId: response.executionId, callId: response.callId };
}

describe('provider-free journal continuation', () => {
  it('restores a saved response without another provider call or ephemeral instructions', async () => {
    const saved = await stoppedAt('model-response', true);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    expect(fresh.agent.getHistory().map((m) => m.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
    ]);
    expect(JSON.stringify(fresh.agent.getHistory())).not.toContain('Only this invocation');
    const ids = fresh.agent.getHistory().map((m) => m.id);
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.agent.getHistory().map((m) => m.id)).toEqual(ids);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('uses existing action ids when a dispatch stopped before body entry', async () => {
    const saved = await stoppedAt('tool-effect-start');
    const ids = saved.records.filter((r) => r.kind === 'tool-intent').map((r) => r.actionId);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(saved);
    expect(
      saved.records.filter((r) => r.kind === 'tool-effect-start').map((r) => r.actionId),
    ).toEqual(ids);
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
  });

  it('refuses ambiguous effects before dispatching a safe sibling or changing history', async () => {
    const saved = await stoppedAt('tool-result');
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.agent.getHistory()).toEqual([]);
    expect(saved.journal.append).not.toHaveBeenCalled();
  });

  it('reuses committed results after result acknowledgement was lost', async () => {
    const saved = await stoppedAt('tool-result', true);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(saved);
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(
      fresh.agent
        .getHistory()
        .filter((m) => m.role === 'tool')
        .map((m) => m.content),
    ).toEqual(['result 1', 'result 2']);
    expect(fresh.requests).toHaveLength(0);
  });

  it('rejects mismatched result linkage and unsupported checkpoints before effects', async () => {
    const saved = await stoppedAt('tool-result', true);
    const result = saved.records.find((r) => r.kind === 'tool-result');
    if (!result || result.kind !== 'tool-result') throw new Error('Missing result');
    result.result.executionId = 'a-different-call';
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.agent.getHistory()).toEqual([]);
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('refuses to append an old batch into unrelated live history', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    fresh.agent.injectMessage('user', 'another turn');
    const before = fresh.agent.getHistory();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(fresh.agent.getHistory()).toEqual(before);
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('reuses a matching assistant already committed by the original run', async () => {
    const saved = await stoppedAt('tool-effect-start');
    const assistant = saved.source.agent.getHistory().find((m) => m.role === 'assistant');
    await saved.source.agent.resumeToolCalls(saved);
    expect(
      saved.source.agent
        .getHistory()
        .filter((m) => m.role === 'assistant')
        .map((m) => m.id),
    ).toEqual([assistant!.id]);
    expect(saved.source.requests).toHaveLength(1);
  });

  it('preserves fatal persistence errors and commits no partial restored history', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    saved.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-result') throw new Error('offline');
    });
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
    });
    expect(fresh.agent.getHistory()).toEqual([]);
    expect(fresh.requests).toHaveLength(0);
  });
  it('reuses a completed sibling while executing only the member stopped before effect admission', async () => {
    const source = fixture();
    const records: TExecutionJournalRecord[] = [];
    let firstSettled!: () => void;
    const settled = new Promise<void>((resolve) => {
      firstSettled = resolve;
    });
    await expect(
      source.agent.run('perform actions', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-effect-start' && record.parameters.n === 2) {
              await settled;
              throw new Error('crash before second effect');
            }
            records.push(structuredClone(record));
            if (record.kind === 'tool-result') firstSettled();
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const response = records.find((r) => r.kind === 'model-response')!;
    if (response.kind !== 'model-response') throw new Error('Missing response');
    const fresh = fixture();
    await fresh.agent.resumeToolCalls({
      executionId: response.executionId,
      callId: response.callId,
      journal: {
        read: async () => records,
        append: async (record) => {
          records.push(record);
        },
      },
    });
    expect(fresh.effect).toHaveBeenCalledTimes(1);
    expect(fresh.effect.mock.calls[0][0]).toEqual({ n: 2 });
    expect(
      fresh.agent
        .getHistory()
        .filter((m) => m.role === 'tool')
        .map((m) => m.content),
    ).toEqual(['result 1', 'result 2']);
  });

  it('rejects a superseded batch even if the newer provider request has no response', async () => {
    const saved = await stoppedAt('tool-intent');
    const request = saved.records.find((r) => r.kind === 'model-request')!;
    if (request.kind !== 'model-request') throw new Error('Missing request');
    saved.records.push({ ...structuredClone(request), recordId: 'next:request', callId: 'next' });
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it.each(['version', 'toolChoice', 'repeatLimit', 'duplicateId', 'duplicateRecord'])(
    'preserves replay admission constraints (%s)',
    async (variant) => {
      const saved = await stoppedAt('tool-intent');
      const request = saved.records.find((r) => r.kind === 'model-request')!;
      const response = saved.records.find((r) => r.kind === 'model-response')!;
      if (
        request.kind !== 'model-request' ||
        response.kind !== 'model-response' ||
        response.response.role !== 'assistant'
      )
        throw new Error('Missing fixture');
      if (variant === 'version') Object.assign(request.checkpoint!, { version: 2 });
      if (variant === 'toolChoice') request.options.toolChoice = 'none';
      if (variant === 'repeatLimit') {
        request.checkpoint!.maxSameToolInputs = 1;
        request.checkpoint!.sameToolInputCounts = [['act::{"n":1}', 1]];
      }
      if (variant === 'duplicateId')
        response.response.toolCalls![1].id = response.response.toolCalls![0].id;
      if (variant === 'duplicateRecord') saved.records.push({ ...request, callId: 'conflict' });
      const fresh = fixture();
      await expect(fresh.agent.resumeToolCalls(saved)).rejects.toThrow();
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(saved.journal.append).not.toHaveBeenCalled();
      expect(fresh.agent.getHistory()).toEqual([]);
    },
  );

  it('preserves injected input while an effect is awaiting settlement', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let enter!: () => void;
    const entered = new Promise<void>((resolve) => {
      enter = resolve;
    });
    fresh.effect.mockImplementation(async () => {
      enter();
      await gate;
      return 'settled';
    });
    const resuming = fresh.agent.resumeToolCalls(saved);
    await entered;
    fresh.agent.injectMessage('user', 'input received during recovery');
    release();
    await expect(resuming).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(fresh.agent.getHistory().map((m) => m.content)).toEqual([
      'input received during recovery',
    ]);
    expect(saved.records.filter((r) => r.kind === 'tool-result')).toHaveLength(2);
  });

  it('serializes concurrent recovery and re-reads settlement before the second operation', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    await Promise.all([fresh.agent.resumeToolCalls(saved), fresh.agent.resumeToolCalls(saved)]);
    expect(fresh.effect).toHaveBeenCalledTimes(2);
    expect(saved.journal.read).toHaveBeenCalledTimes(2);
    expect(fresh.agent.getHistory()).toHaveLength(4);
  });

  it('rejects an older response arriving after a newer invocation began', async () => {
    const saved = await stoppedAt('tool-intent');
    const request = saved.records.find((r) => r.kind === 'model-request')!;
    if (request.kind !== 'model-request') throw new Error('Missing request');
    saved.records.splice(1, 0, {
      ...structuredClone(request),
      recordId: 'next:request',
      callId: 'next',
    });
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('rejects two tool calls claiming the same durable action identity', async () => {
    const saved = await stoppedAt('tool-effect-start');
    const first = saved.records.find((r) => r.kind === 'tool-intent')!;
    if (first.kind !== 'tool-intent') throw new Error('Missing intent');
    for (const record of saved.records) {
      if ('actionId' in record) record.actionId = first.actionId;
    }
    const fresh = fixture();
    await expect(fresh.agent.resumeToolCalls(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.effect).not.toHaveBeenCalled();
  });
  it('reports cancellation after preserving durable settlements and recovered history', async () => {
    const saved = await stoppedAt('tool-intent');
    const fresh = fixture();
    const abort = new AbortController();
    fresh.effect.mockImplementation(async () => {
      abort.abort();
      return 'settled before cancellation';
    });
    await expect(
      fresh.agent.resumeToolCalls({ ...saved, signal: abort.signal }),
    ).rejects.toMatchObject({ name: 'AbortError' });
    expect(saved.records.filter((r) => r.kind === 'tool-result')).toHaveLength(2);
    expect(fresh.agent.getHistory()).toHaveLength(4);
    expect(fresh.requests).toHaveLength(0);
  });

  it('reproduces the original whole-batch context-overflow projection after restart', async () => {
    const source = fixture();
    source.effect.mockImplementation(async (args) =>
      args.n === 1 ? 'x'.repeat(680_000) : 'second result',
    );
    const records: TExecutionJournalRecord[] = [];
    let requests = 0;
    await expect(
      source.agent.run('large results', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'model-request' && ++requests === 2)
              throw new Error('stop before next invocation');
            records.push(structuredClone(record));
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const response = records.find((r) => r.kind === 'model-response')!;
    if (response.kind !== 'model-response') throw new Error('Missing response');
    const options = {
      executionId: response.executionId,
      callId: response.callId,
      journal: {
        read: async () => records,
        append: async (record: TExecutionJournalRecord) => {
          records.push(record);
        },
      },
    };
    const before = source.agent
      .getHistory()
      .filter((m) => m.role === 'tool')
      .map((m) => m.content);
    expect(before[1]).toContain('Context window near capacity');
    await source.agent.resumeToolCalls(options);
    expect(source.effect).toHaveBeenCalledTimes(2);
    const fresh = fixture();
    await fresh.agent.resumeToolCalls(options);
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(
      fresh.agent
        .getHistory()
        .filter((m) => m.role === 'tool')
        .map((m) => m.content),
    ).toEqual(before);
  });
});
