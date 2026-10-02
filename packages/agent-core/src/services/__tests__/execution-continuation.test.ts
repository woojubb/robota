import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import type { IAgentConfig } from '../../interfaces/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { FunctionTool } from '../../tool-registry';
import { createScriptedProvider, type TScriptedTurn } from '../../testing/scripted-provider';
import type { IRunOptions } from '../../interfaces/run-options';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});
const action: TScriptedTurn = { toolCalls: [{ name: 'act', args: {} }] };
function fixture(turns: TScriptedTurn[], config: Partial<IAgentConfig> = {}) {
  const scripted = createScriptedProvider(turns);
  const effect = vi.fn(async () => 'completed effect');
  const agent = new ConversationAgent({
    name: 'continuation',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    tools: [
      new FunctionTool(
        { name: 'act', description: 'Fixture', parameters: { type: 'object', properties: {} } },
        effect,
      ),
    ],
    ...config,
  });
  agents.push(agent);
  return { agent, effect, ...scripted };
}
function journalFixture() {
  const records: TExecutionJournalRecord[] = [];
  const append = vi.fn(async (record: TExecutionJournalRecord) => {
    const previous = records.find((entry) => entry.recordId === record.recordId);
    if (previous) expect(record).toEqual(previous);
    else records.push(structuredClone(record));
  });
  const journal = { append, read: vi.fn(async () => structuredClone(records)) };
  return { records, journal };
}
async function interrupted(
  options: IRunOptions = {},
  turns = [action, { text: 'resumed answer' }],
) {
  const source = fixture(turns);
  const { records, journal } = journalFixture();
  let calls = 0;
  await expect(
    source.agent.run('original input', {
      ...options,
      executionJournal: {
        append: async (record) => {
          if (record.kind === 'model-request' && ++calls === 2)
            throw new Error('stop before next call');
          await journal.append(record);
        },
      },
    }),
  ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
  return { source, records, journal, executionId: records[0].executionId };
}

describe('no-input execution continuation', () => {
  it('keeps a complete recoverable checkpoint when a recovery observer throws', async () => {
    const source = fixture([{ text: 'terminal' }], { systemMessage: 'Fixture instructions' });
    const { records, journal } = journalFixture();
    await source.agent.run('input', { executionJournal: journal });
    const fresh = fixture([{ text: 'must not call' }], { systemMessage: 'Fixture instructions' });
    const options = { executionId: records[0].executionId, journal };
    const observerError = new Error('observer failed');
    await expect(
      fresh.agent.resume({
        ...options,
        onExecutionEvent: () => {
          throw observerError;
        },
      }),
    ).rejects.toBe(observerError);
    await expect(fresh.agent.resume(options)).resolves.toBe('terminal');
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.agent.getHistory().map((message) => message.content)).toEqual(
      source.agent.getHistory().map((message) => message.content),
    );
  });

  it('refuses a new model call if a recovery observer injects unrelated history', async () => {
    const saved = await interrupted();
    const fresh = fixture([{ text: 'must not call' }]);
    let injected = false;
    await expect(
      fresh.agent.resume({
        ...saved,
        onExecutionEvent: () => {
          if (!injected) {
            injected = true;
            fresh.agent.injectMessage('user', 'unrelated input');
          }
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.agent.getHistory().some((message) => message.content === 'unrelated input')).toBe(
      true,
    );
  });

  it('announces restored history exactly once through the ordinary replay contract', async () => {
    const saved = await interrupted();
    const fresh = fixture([{ text: 'resumed answer' }]);
    const onExecutionEvent = vi.fn();
    await fresh.agent.resume({ ...saved, onExecutionEvent });
    const replay = onExecutionEvent.mock.calls
      .filter(([event]) => event === 'history_mutation')
      .map(([, data]) => data.message);
    expect(replay).toEqual(fresh.agent.getHistory());
    const emitted = onExecutionEvent.mock.calls.length;
    await fresh.agent.resume({ ...saved, onExecutionEvent });
    expect(onExecutionEvent).toHaveBeenCalledTimes(emitted);
  });

  it.each(['provider', 'model'] as const)(
    'rejects a different active %s before recovery changes history or dispatches',
    async (changed) => {
      const saved = await interrupted();
      const original = createScriptedProvider([{ text: 'must not call original' }]);
      const other = createScriptedProvider([{ text: 'must not call other' }]);
      const otherProvider = { ...other.provider, name: 'other-provider' };
      const fresh = fixture([], {
        aiProviders: [original.provider, otherProvider],
        defaultModel: {
          provider: changed === 'provider' ? otherProvider.name : original.provider.name,
          model: changed === 'model' ? 'different-model' : 'test-model',
        },
      });
      const before = fresh.agent.getHistory();
      await expect(fresh.agent.resume(saved)).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_INVALID',
      });
      expect(original.requests).toHaveLength(0);
      expect(other.requests).toHaveLength(0);
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(fresh.agent.getHistory()).toEqual(before);
    },
  );

  it('continues the next model round without repeating input, response or tool effect', async () => {
    const saved = await interrupted({
      maxTokens: 123,
      temperature: 0.2,
      ephemeralSystemContext: 'ephemeral',
      maxExecutionRounds: 3,
    });
    const fresh = fixture([{ text: 'resumed answer' }]);
    await expect(fresh.agent.resume(saved)).resolves.toBe('resumed answer');
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.requests).toHaveLength(1);
    expect(fresh.chatOptions[0]).toMatchObject({ maxTokens: 123, temperature: 0.2 });
    expect(fresh.requests[0].filter((message) => message.role === 'tool')).toHaveLength(1);
    expect(
      fresh.agent
        .getHistory()
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ).toEqual(['original input']);
    expect(
      fresh.agent.getHistory().filter((message) => message.content === 'ephemeral'),
    ).toHaveLength(0);
    expect(fresh.requests[0].some((message) => message.content === 'ephemeral')).toBe(true);
    const requests = saved.records.filter((record) => record.kind === 'model-request');
    expect(requests.at(-1)).toMatchObject({
      executionId: saved.executionId,
      checkpoint: { round: 2 },
    });
  });

  it('preserves an exhausted round cap and makes only the ordinary terminal summary', async () => {
    const saved = await interrupted({ maxExecutionRounds: 1 });
    const fresh = fixture([{ text: 'summary' }]);
    await expect(fresh.agent.resume(saved)).resolves.toBe('summary');
    expect(fresh.requests).toHaveLength(1);
    expect(fresh.chatOptions[0]?.toolChoice).toBe('none');
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('preserves repeated-tool counts into the next round', async () => {
    const saved = await interrupted({ maxSameToolInputs: 1 });
    const fresh = fixture([action, { text: 'must not reach this' }]);
    await expect(fresh.agent.resume(saved)).rejects.toThrow(/same.*tool|tool.*input/i);
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.requests).toHaveLength(1);
  });

  it.each([false, true])(
    'restores a settled terminal response without calling a provider (summary=%s)',
    async (summary) => {
      const source = fixture(summary ? [action, { text: 'terminal' }] : [{ text: 'terminal' }]);
      const { records, journal } = journalFixture();
      await expect(
        source.agent.run('original input', {
          maxExecutionRounds: 1,
          executionJournal: {
            append: async (record) => {
              await journal.append(record);
              if (record.kind === 'model-response' && record.response.content === 'terminal')
                throw new Error('lost acknowledgement');
            },
          },
        }),
      ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
      const fresh = fixture([{ text: 'must not call' }]);
      const options = { executionId: records[0].executionId, journal };
      await expect(fresh.agent.resume(options)).resolves.toBe('terminal');
      await expect(fresh.agent.resume(options)).resolves.toBe('terminal');
      expect(fresh.requests).toHaveLength(0);
      expect(fresh.effect).not.toHaveBeenCalled();
      expect(
        fresh.agent.getHistory().filter((message) => message.content === 'terminal'),
      ).toHaveLength(1);
    },
  );

  it('does not repeat an admitted model invocation whose response is unknown', async () => {
    const saved = await interrupted();
    const request = saved.records.find((record) => record.kind === 'model-request')!;
    if (request.kind !== 'model-request') throw new Error('Missing request');
    saved.records.push({ ...request, recordId: 'unknown:request', callId: 'unknown' });
    const fresh = fixture([{ text: 'must not call' }]);
    await expect(fresh.agent.resume(saved)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.effect).not.toHaveBeenCalled();
  });
  it('restores loaded deferred tools from a settled search and refuses one no longer registered', async () => {
    const search = vi.fn(async (_parameters, context) => {
      context.deferredTools.loadDeferredTools(['Hidden']);
      return 'loaded Hidden';
    });
    const hidden = vi.fn(async () => 'hidden result');
    const tools = () => [
      new FunctionTool(
        {
          name: 'ToolSearch',
          description: 'Load tools',
          parameters: { type: 'object', properties: {} },
        },
        search,
      ),
      new FunctionTool(
        {
          name: 'Hidden',
          description: 'Deferred fixture',
          deferLoading: true,
          parameters: { type: 'object', properties: {} },
        },
        hidden,
      ),
    ];
    const source = fixture(
      [{ toolCalls: [{ name: 'ToolSearch', args: {} }] }, { text: 'unreached' }],
      { tools: tools(), toolSearch: 'on' },
    );
    const { records, journal } = journalFixture();
    let count = 0;
    await expect(
      source.agent.run('load tools', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'model-request' && ++count === 2)
              throw new Error('stop before next call');
            await journal.append(record);
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const fresh = fixture([{ toolCalls: [{ name: 'Hidden', args: {} }] }, { text: 'done' }], {
      tools: tools(),
      toolSearch: 'on',
    });
    await expect(
      fresh.agent.resume({ executionId: records[0].executionId, journal }),
    ).resolves.toBe('done');
    expect(search).toHaveBeenCalledOnce();
    expect(hidden).toHaveBeenCalledOnce();
    expect(fresh.chatOptions[0]?.tools?.map((tool) => tool.name)).toContain('Hidden');
    const missing = fixture([{ text: 'must not call' }], {
      tools: tools().filter((tool) => tool.schema.name !== 'Hidden'),
      toolSearch: 'on',
    });
    await expect(
      missing.agent.resume({ executionId: records[0].executionId, journal }),
    ).rejects.toMatchObject({ name: 'ExecutionRecoveryError', code: 'EXECUTION_RECOVERY_INVALID' });
    expect(missing.requests).toHaveLength(0);
  });

  it('restores a recorded cache hit without invoking a provider or lifecycle hooks', async () => {
    class Hooks extends AbstractPlugin {
      override readonly name = 'resume-hooks';
      override readonly version = '1';
      override afterRun = vi.fn(async () => {});
      override afterProviderCall = vi.fn(async () => {});
    }
    const source = fixture([{ text: 'cached answer' }], {
      retainHistory: false,
      cache: { enabled: true, maxEntries: 10, ttlMs: 60_000 },
    });
    await source.agent.run('same input');
    const { records, journal } = journalFixture();
    await expect(
      source.agent.run('same input', {
        executionJournal: {
          append: async (record) => {
            await journal.append(record);
            if (record.kind === 'model-cache-hit') throw new Error('lost cached acknowledgement');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(source.requests).toHaveLength(1);
    expect(records[0].kind).toBe('model-cache-hit');
    const plugin = new Hooks();
    const fresh = fixture([{ text: 'must not call' }], { plugins: [plugin] });
    await expect(
      fresh.agent.resume({ executionId: records[0].executionId, journal }),
    ).resolves.toBe('cached answer');
    expect(fresh.requests).toHaveLength(0);
    expect(plugin.afterRun).not.toHaveBeenCalled();
    expect(plugin.afterProviderCall).not.toHaveBeenCalled();
  });

  it('keeps the consecutive unknown-tool stop when restoring the second failed round', async () => {
    const unknown: TScriptedTurn = { toolCalls: [{ name: 'Missing', args: {} }] };
    const source = fixture([unknown, unknown, { text: 'summary' }]);
    const { records, journal } = journalFixture();
    let count = 0;
    await expect(
      source.agent.run('try unavailable tool', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'model-request' && ++count === 3)
              throw new Error('stop before summary');
            await journal.append(record);
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const fresh = fixture([{ text: 'summary' }]);
    await expect(
      fresh.agent.resume({ executionId: records[0].executionId, journal }),
    ).resolves.toBe('summary');
    expect(fresh.requests).toHaveLength(1);
    expect(fresh.chatOptions[0]?.toolChoice).toBe('none');
  });

  it('keeps tool-only completion after its original round cap is exhausted', async () => {
    const source = fixture([action, { text: 'must not call' }]);
    const { records, journal } = journalFixture();
    await expect(
      source.agent.run('one action', {
        maxExecutionRounds: 1,
        allowToolOnlyCompletion: true,
        executionJournal: {
          append: async (record) => {
            await journal.append(record);
            if (record.kind === 'tool-result') throw new Error('lost result acknowledgement');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    const fresh = fixture([{ text: 'must not call' }]);
    await expect(
      fresh.agent.resume({ executionId: records[0].executionId, journal }),
    ).resolves.toBe('');
    expect(fresh.requests).toHaveLength(0);
    expect(fresh.effect).not.toHaveBeenCalled();
  });

  it('idempotently restores the fallback text of an empty forced summary', async () => {
    const source = fixture([action, { text: '' }]);
    const { records, journal } = journalFixture();
    const original = await source.agent.run('one action', {
      maxExecutionRounds: 1,
      executionJournal: journal,
    });
    expect(original).toContain('Maximum rounds reached');
    await expect(
      source.agent.resume({ executionId: records[0].executionId, journal }),
    ).resolves.toBe(original);
    const fresh = fixture([{ text: 'must not call' }]);
    const options = { executionId: records[0].executionId, journal };
    await expect(fresh.agent.resume(options)).resolves.toBe(original);
    await expect(fresh.agent.resume(options)).resolves.toBe(original);
    expect(fresh.requests).toHaveLength(0);
  });

  it('preserves unrelated history when recovery is refused on a stateless agent', async () => {
    const fresh = fixture([{ text: 'must not call' }], { retainHistory: false });
    fresh.agent.injectMessage('user', 'unrelated existing input');
    const before = fresh.agent.getHistory();
    const { journal } = journalFixture();
    await expect(fresh.agent.resume({ executionId: 'missing', journal })).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(fresh.agent.getHistory()).toEqual(before);
    expect(fresh.requests).toHaveLength(0);
  });
});
