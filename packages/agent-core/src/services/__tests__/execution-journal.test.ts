import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { createScriptedProvider, type TScriptedTurn } from '../../testing/scripted-provider';
import { FunctionTool } from '../../tool-registry';
import type { IRunOptions } from '../../interfaces/run-options';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});

function fixture(turns: TScriptedTurn[], effect = vi.fn(async () => 'tool answer'), cache = false) {
  const scripted = createScriptedProvider(turns);
  const agent = new ConversationAgent({
    // These fixtures exercise independent calls settling concurrently.
    toolExecutionPolicy: (calls) => ({
      scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
    }),
    name: 'journal-test',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    ...(cache ? { cache: { enabled: true, maxEntries: 10, ttlMs: 60_000 } } : {}),
    tools: [
      new FunctionTool(
        { name: 'act', description: 'Test action', parameters: { type: 'object', properties: {} } },
        effect,
      ),
    ],
  });
  agents.push(agent);
  return { agent, effect, ...scripted };
}

async function execute(agent: ConversationAgent, options: IRunOptions, streaming: boolean) {
  if (!streaming) return agent.run('test', options);
  for await (const _text of agent.runStream('test', options)) {
    /* Drive the same runtime through streaming. */
  }
  return undefined;
}

describe('awaited execution journal through public ConversationAgent runs', () => {
  it('applies effect admission to custom replacement tools without relying on a base class', async () => {
    const { agent } = fixture([
      { text: 'ready' },
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'done' },
    ]);
    await agent.run('initialize');
    const execute = vi.fn(async () => ({ success: true, data: 'custom result' }));
    await agent.updateTools([
      {
        schema: {
          name: 'act',
          description: 'Custom',
          parameters: { type: 'object', properties: {} },
        },
        getName: () => 'act',
        getDescription: () => 'Custom',
        validate: () => true,
        validateParameters: () => ({ isValid: true, errors: [] }),
        setEventService: () => {},
        execute,
      },
    ]);
    await expect(
      agent.run('act', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-effect-start') throw new Error('refused');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(execute).not.toHaveBeenCalled();
  });

  it('awaits effect-start persistence immediately before entering a raw tool', async () => {
    const { agent, effect } = fixture([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'done' },
    ]);
    const entered = deferred<void>();
    const gate = deferred<void>();
    const records: TExecutionJournalRecord[] = [];
    const running = agent.run('act', {
      executionJournal: {
        append: async (record) => {
          records.push(record);
          if (record.kind === 'tool-effect-start') {
            entered.resolve();
            await gate.promise;
          }
        },
      },
    });
    await Promise.race([entered.promise, running]);
    expect(effect).not.toHaveBeenCalled();
    gate.resolve();
    await running;
    expect(effect).toHaveBeenCalledOnce();
    expect(records.filter((record) => record.kind === 'tool-effect-start')).toMatchObject([
      { actionId: expect.any(String), toolName: 'act', parameters: {} },
    ]);
  });

  it('never converts effect-start journal failure into an ordinary tool result', async () => {
    const { agent, effect, requests } = fixture([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'done' },
    ]);
    await expect(
      agent.run('act', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-effect-start')
              throw new Error('effect admission unavailable');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-effect-start' });
    expect(effect).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it.each([false, true])(
    'waits for request admission before calling the provider (streaming=%s)',
    async (streaming) => {
      const { agent, requests } = fixture([{ text: 'done' }]);
      const gate = deferred<void>();
      const entered = deferred<void>();
      const running = execute(
        agent,
        {
          executionJournal: {
            append: async (record) => {
              if (record.kind === 'model-request') {
                entered.resolve();
                await gate.promise;
              }
            },
          },
        },
        streaming,
      );
      // A bounded observation avoids a hung test when the baseline never invokes the port.
      await Promise.race([entered.promise, running]);
      expect(requests).toHaveLength(0);
      gate.resolve();
      await running;
      expect(requests).toHaveLength(1);
    },
  );

  it('stops before dispatch when request persistence fails', async () => {
    const { agent, requests } = fixture([{ text: 'done' }]);
    await expect(
      agent.run('test', {
        executionJournal: {
          append: async () => {
            throw new Error('store offline');
          },
        },
      }),
    ).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
      cause: { message: 'store offline' },
    });
    expect(requests).toHaveLength(0);
  });

  it('persists the complete response before assistant history or tools', async () => {
    const { agent, effect, requests } = fixture([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'done' },
    ]);
    const gate = deferred<void>();
    const entered = deferred<void>();
    const records: TExecutionJournalRecord[] = [];
    const running = agent.run('test', {
      executionJournal: {
        append: async (record) => {
          records.push(record);
          if (record.kind === 'model-response') {
            entered.resolve();
            await gate.promise;
          }
        },
      },
    });
    await Promise.race([entered.promise, running]);
    expect(effect).not.toHaveBeenCalled();
    expect(agent.getHistory().filter((message) => message.role === 'assistant')).toHaveLength(0);
    expect(records.at(-1)).toMatchObject({
      kind: 'model-response',
      response: { toolCalls: [{ id: 'scripted-call-1-0' }] },
    });
    gate.resolve();
    await running;
    expect(effect).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(2);
  });

  it('does not execute tools or a next model call after response persistence fails', async () => {
    const { agent, effect, requests } = fixture([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'done' },
    ]);
    await expect(
      agent.run('test', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'model-response') throw new Error('response write failed');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(effect).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it('admits every tool intent before starting any tool in a parallel batch', async () => {
    const { agent, effect } = fixture([
      {
        toolCalls: [
          { name: 'act', args: {} },
          { name: 'act', args: {} },
        ],
      },
    ]);
    let intents = 0;
    await expect(
      agent.run('test', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-intent' && ++intents === 2)
              throw new Error('second intent refused');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(effect).not.toHaveBeenCalled();
  });

  it('records each parallel tool result as it settles, before a slow sibling finishes', async () => {
    const slow = deferred<string>();
    const bothStarted = deferred<void>();
    let calls = 0;
    const { agent, requests } = fixture(
      [
        {
          toolCalls: [
            { name: 'act', args: {} },
            { name: 'act', args: {} },
          ],
        },
        { text: 'done' },
      ],
      vi.fn(async () => {
        if (++calls === 1) return 'first';
        bothStarted.resolve();
        return slow.promise;
      }),
    );
    const recorded = deferred<void>();
    const records: TExecutionJournalRecord[] = [];
    const running = agent.run('test', {
      executionJournal: {
        append: async (record) => {
          records.push(record);
          if (record.kind === 'tool-result') recorded.resolve();
        },
      },
    });
    await bothStarted.promise;
    await recorded.promise;
    const saved = records.filter((record) => record.kind === 'tool-result');
    expect(requests).toHaveLength(1);
    slow.resolve('second');
    await running;
    expect(saved).toHaveLength(1);
    expect(requests).toHaveLength(2);
    expect(
      new Set(records.filter((r) => r.kind === 'tool-intent').map((r) => r.actionId)).size,
    ).toBe(2);
  });

  it('treats a tool-result write failure as fatal even with continueOnError and drains running siblings', async () => {
    const slow = deferred<string>();
    const bothStarted = deferred<void>();
    let calls = 0;
    const { agent, requests } = fixture(
      [
        {
          toolCalls: [
            { name: 'act', args: {} },
            { name: 'act', args: {} },
          ],
        },
        { text: 'done' },
      ],
      vi.fn(async () => {
        if (++calls === 1) return 'first';
        bothStarted.resolve();
        return slow.promise;
      }),
    );
    const recorded = deferred<void>();
    const running = agent.run('test', {
      executionJournal: {
        append: async (record) => {
          if (record.kind === 'tool-result') {
            recorded.resolve();
            throw new Error('result write failed');
          }
        },
      },
    });
    let settled = false;
    const result = running
      .catch((error: unknown) => error)
      .finally(() => {
        settled = true;
      });
    await bothStarted.promise;
    await recorded.promise;
    expect(settled).toBe(false);
    slow.resolve('second');
    expect(await result).toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(requests).toHaveLength(1);
  });

  it('includes the forced summary in the same awaited journal', async () => {
    const { agent } = fixture([{ toolCalls: [{ name: 'act', args: {} }] }, { text: 'summary' }]);
    const records: TExecutionJournalRecord[] = [];
    await agent.run('test', {
      maxExecutionRounds: 1,
      executionJournal: {
        append: async (record) => {
          records.push(record);
        },
      },
    });
    expect(records.filter((r) => r.kind === 'model-request')).toHaveLength(2);
    expect(records.filter((r) => r.kind === 'model-response').at(-1)).toMatchObject({
      response: { content: 'summary' },
    });
  });

  it('does not dispatch after cancellation while request admission was pending', async () => {
    const { agent, requests } = fixture([{ text: 'done' }]);
    const entered = deferred<void>();
    const gate = deferred<void>();
    const abort = new AbortController();
    const running = agent.run('test', {
      signal: abort.signal,
      executionJournal: {
        append: async (record) => {
          if (record.kind === 'model-request') {
            entered.resolve();
            await gate.promise;
          }
        },
      },
    });
    await entered.promise;
    abort.abort();
    gate.resolve();
    await running;
    expect(requests).toHaveLength(0);
  });

  it('surfaces a failed response write even if cancellation raced the provider response', async () => {
    const { agent, provider, requests } = fixture([{ text: 'done' }]);
    const abort = new AbortController();
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      abort.abort();
      return response;
    };
    await expect(
      agent.run('test', {
        signal: abort.signal,
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'model-response')
              throw new Error('cannot persist charged response');
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(requests).toHaveLength(1);
  });

  it.each([false, true])(
    'preserves a journal failure across cancellation and a throwing completion observer (forced summary=%s)',
    async (forcedSummary) => {
      const { agent, requests } = fixture(
        forcedSummary
          ? [{ toolCalls: [{ name: 'act', args: {} }] }, { text: 'unpersisted answer' }]
          : [{ text: 'unpersisted answer' }],
      );
      const abort = new AbortController();
      await expect(
        agent.run('test', {
          signal: abort.signal,
          ...(forcedSummary && { maxExecutionRounds: 1 }),
          executionJournal: {
            append: async (record) => {
              if (
                record.kind === 'model-response' &&
                record.response.content === 'unpersisted answer'
              ) {
                abort.abort();
                throw new Error('response write failed');
              }
            },
          },
          onExecutionEvent: (event) => {
            if (event === 'provider_call_completed' && abort.signal.aborted)
              throw new Error('observer failed');
          },
        }),
      ).rejects.toMatchObject({
        code: 'EXECUTION_JOURNAL_FAILED',
        cause: { message: 'response write failed' },
      });
      expect(requests).toHaveLength(forcedSummary ? 2 : 1);
      expect(agent.getHistory().some((message) => message.content === 'unpersisted answer')).toBe(
        false,
      );
    },
  );

  it('assigns distinct action ids when a provider reuses a tool-call id across model rounds', async () => {
    const { agent, provider } = fixture([
      { toolCalls: [{ name: 'act', args: {} }] },
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'done' },
    ]);
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      if (response.role === 'assistant')
        for (const call of response.toolCalls ?? []) call.id = 'reused';
      return response;
    };
    const records: TExecutionJournalRecord[] = [];
    await agent.run('test', {
      executionJournal: {
        append: async (record) => {
          records.push(record);
        },
      },
    });
    const intents = records.filter((r) => r.kind === 'tool-intent');
    expect(intents.map((r) => r.toolCallId)).toEqual(['reused', 'reused']);
    expect(new Set(intents.map((r) => r.actionId)).size).toBe(2);
    expect(new Set(intents.map((r) => r.parentCallId)).size).toBe(2);
    expect(intents.map((r) => r.parentCallId)).toEqual(
      records
        .filter((r) => r.kind === 'model-response')
        .slice(0, 2)
        .map((r) => r.callId),
    );
  });

  it.each([
    { journaled: false, streaming: false },
    { journaled: true, streaming: false },
    { journaled: false, streaming: true },
    { journaled: true, streaming: true },
  ])(
    'refuses a batch with conflicting call identities before any tool runs ($journaled, $streaming)',
    async ({ journaled, streaming }) => {
      const { agent, effect, provider, requests } = fixture([
        {
          toolCalls: [
            { name: 'act', args: { value: 'first' } },
            { name: 'act', args: { value: 'second' } },
          ],
        },
        { text: 'done' },
      ]);
      const chat = provider.chat.bind(provider);
      provider.chat = async (messages, options) => {
        const response = await chat(messages, options);
        if (response.role === 'assistant') {
          for (const call of response.toolCalls ?? []) call.id = 'same-call';
        }
        return response;
      };
      const records: TExecutionJournalRecord[] = [];
      const options: IRunOptions = journaled
        ? { executionJournal: { append: async (record) => void records.push(record) } }
        : {};

      await expect(execute(agent, options, streaming)).rejects.toThrow(
        'Duplicate tool call identity',
      );
      expect(effect).not.toHaveBeenCalled();
      expect(requests).toHaveLength(1);
      expect(records.some((record) => record.kind.startsWith('tool-'))).toBe(false);
      expect(agent.getHistory().some((message) => message.role === 'tool')).toBe(false);
    },
  );

  it.each([
    { ids: ['same-call', 'same-call'], error: 'Duplicate tool call identity' },
    { ids: ['valid-call', '  '], error: 'Tool call identity must be a non-empty string' },
  ])('refuses ambiguous or empty call identities before dispatch', async ({ ids, error }) => {
    const { agent, effect, provider } = fixture([
      {
        toolCalls: [
          { name: 'act', args: {} },
          { name: 'act', args: {} },
        ],
      },
    ]);
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      if (response.role === 'assistant') {
        response.toolCalls?.forEach((call, index) => (call.id = ids[index]));
      }
      return response;
    };
    await expect(agent.run('test')).rejects.toThrow(error);
    expect(effect).not.toHaveBeenCalled();
  });

  it.each([false, true])(
    'does not retain rejected assistant text for the next turn (streaming=%s)',
    async (streaming) => {
      const { agent, effect, provider } = fixture([
        {
          toolCalls: [
            { name: 'act', args: {} },
            { name: 'act', args: {} },
          ],
        },
        { text: 'new answer' },
      ]);
      const chat = provider.chat.bind(provider);
      provider.chat = async (messages, options) => {
        const response = await chat(messages, options);
        if (response.role === 'assistant' && response.toolCalls?.length) {
          response.content = 'rejected text';
          options?.onTextDelta?.('rejected text');
          for (const call of response.toolCalls) call.id = 'same-call';
        }
        return response;
      };
      await expect(execute(agent, {}, streaming)).rejects.toThrow('Duplicate tool call identity');
      await expect(agent.run('next input')).resolves.toBe('new answer');
      expect(effect).not.toHaveBeenCalled();
      expect(agent.getHistory().filter((message) => message.role === 'assistant')).toMatchObject([
        { content: 'new answer' },
      ]);
    },
  );

  it('discards a tool-free request violation before the next turn', async () => {
    const { agent, effect, provider } = fixture([
      { toolCalls: [{ name: 'act', args: {} }] },
      { text: 'new answer' },
    ]);
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      if (response.role === 'assistant' && response.toolCalls?.length) {
        response.content = 'rejected text';
      }
      return response;
    };
    await expect(agent.run('test', { toolChoice: 'none' })).rejects.toThrow('toolChoice none');
    await expect(agent.run('next input')).resolves.toBe('new answer');
    expect(effect).not.toHaveBeenCalled();
  });

  it('does not cache the text of a rejected tool batch as a completed answer', async () => {
    const turn: TScriptedTurn = {
      toolCalls: [
        { name: 'act', args: { value: 'first' } },
        { name: 'act', args: { value: 'second' } },
      ],
    };
    const { agent, effect, provider, requests } = fixture([turn, turn], undefined, true);
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      if (response.role === 'assistant') {
        response.content = 'Preparing the actions';
        for (const call of response.toolCalls ?? []) call.id = 'same-call';
      }
      return response;
    };
    await agent.ensureReady();
    agent.clearHistory();

    await expect(agent.run('test', { toolChoice: 'none' })).rejects.toThrow(
      'Duplicate tool call identity',
    );
    agent.clearHistory();
    await expect(agent.run('test', { toolChoice: 'none' })).rejects.toThrow(
      'Duplicate tool call identity',
    );
    expect(requests).toHaveLength(2);
    expect(effect).not.toHaveBeenCalled();
  });

  it('does not replay the text of a tool batch without its actions', async () => {
    const turn: TScriptedTurn = { toolCalls: [{ name: 'act', args: {} }] };
    const { agent, effect, provider } = fixture(
      [turn, { text: 'done' }, turn, { text: 'done' }],
      undefined,
      true,
    );
    const chat = provider.chat.bind(provider);
    provider.chat = async (messages, options) => {
      const response = await chat(messages, options);
      if (response.role === 'assistant' && response.toolCalls?.length) {
        response.content = 'Preparing the action';
      }
      return response;
    };
    await agent.ensureReady();
    agent.clearHistory();

    await expect(agent.run('test')).resolves.toBe('done');
    agent.clearHistory();
    await expect(agent.run('test')).resolves.toBe('done');
    expect(effect).toHaveBeenCalledTimes(2);
  });

  it.each(['none', 'auto'] as const)(
    'does not reuse a cached answer for a tool-enabled turn after tool choice %s',
    async (firstChoice) => {
      const { agent, effect, requests } = fixture(
        [
          { text: 'first answer' },
          { toolCalls: [{ name: 'act', args: {} }] },
          { text: 'action completed' },
        ],
        undefined,
        true,
      );
      await agent.ensureReady();
      agent.clearHistory();

      await expect(agent.run('same input', { toolChoice: firstChoice })).resolves.toBe(
        'first answer',
      );
      agent.clearHistory();
      await expect(agent.run('same input')).resolves.toBe('action completed');
      expect(effect).toHaveBeenCalledOnce();
      expect(requests).toHaveLength(3);
    },
  );

  it('still reuses a tool-free answer when tool use is explicitly disabled', async () => {
    const { agent, effect, requests } = fixture([{ text: 'answer' }], undefined, true);
    await agent.ensureReady();
    agent.clearHistory();

    await expect(agent.run('same input', { toolChoice: 'none' })).resolves.toBe('answer');
    agent.clearHistory();
    await expect(agent.run('same input', { toolChoice: 'none' })).resolves.toBe('answer');
    expect(effect).not.toHaveBeenCalled();
    expect(requests).toHaveLength(1);
  });

  it('does not store a tool-enabled answer for a later tool-free request', async () => {
    const { agent, requests } = fixture(
      [{ text: 'tool-enabled answer' }, { text: 'tool-free answer' }],
      undefined,
      true,
    );
    await agent.ensureReady();
    agent.clearHistory();

    await expect(agent.run('same input')).resolves.toBe('tool-enabled answer');
    agent.clearHistory();
    await expect(agent.run('same input', { toolChoice: 'none' })).resolves.toBe('tool-free answer');
    expect(requests).toHaveLength(2);
  });

  it('runs tools in a streamed turn after a tool-free answer was cached', async () => {
    const { agent, effect, requests } = fixture(
      [
        { text: 'first answer' },
        { toolCalls: [{ name: 'act', args: {} }] },
        { text: 'action completed' },
      ],
      undefined,
      true,
    );
    await agent.ensureReady();
    agent.clearHistory();
    await agent.run('same input', { toolChoice: 'none' });
    agent.clearHistory();

    let streamed = '';
    for await (const chunk of agent.runStream('same input')) streamed += chunk;
    expect(streamed).toContain('action completed');
    expect(effect).toHaveBeenCalledOnce();
    expect(requests).toHaveLength(3);
  });
});
