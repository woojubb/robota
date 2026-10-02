import { AbstractPlugin } from '../../abstracts/abstract-plugin';
import type { IAgentConfig } from '../../interfaces/agent';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConversationAgent } from '../../core/conversation-agent';
import { FunctionTool } from '../../tool-registry';
import { createScriptedProvider, type TScriptedTurn } from '../../testing/scripted-provider';
import type {
  IToolExecutionContext,
  TToolEffectAdmission,
  TToolParameters,
} from '../../interfaces/tool';
import type { IToolWaitRequest } from '../../interfaces/tool-continuation';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';

const agents: ConversationAgent[] = [];
afterEach(async () => {
  await Promise.all(agents.splice(0).map((agent) => agent.destroy()));
});
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}
function journalFixture() {
  const records: TExecutionJournalRecord[] = [];
  const journal = {
    append: vi.fn(async (record: TExecutionJournalRecord) => {
      const previous = records.find((value) => value.recordId === record.recordId);
      if (previous) expect(record).toEqual(previous);
      else records.push(structuredClone(record));
    }),
    read: vi.fn(async () => structuredClone(records)),
  };
  return { records, journal };
}
function fixture(
  turns: TScriptedTurn[],
  options: {
    plugins?: IAgentConfig['plugins'];
    beforeAsk?: () => Promise<void>;
    swallowWait?: boolean;
    parallelPrompts?: boolean;
    skipAsk?: boolean;
    effect?: (parameters: TToolParameters, context?: IToolExecutionContext) => Promise<string>;
  } = {},
) {
  const scripted = createScriptedProvider(turns);
  const effect = vi.fn(options.effect ?? (async () => 'effect completed'));
  const base = new FunctionTool(
    {
      name: 'act',
      description: 'Fixture action',
      parameters: { type: 'object', properties: { index: { type: 'number' } } },
    },
    effect,
  );
  const tool = Object.assign(base, {
    executeWithAdmission: async (
      parameters: TToolParameters,
      context: IToolExecutionContext,
      admit: TToolEffectAdmission,
    ) => {
      if (!options.skipAsk && (parameters.index ?? 0) === 0 && context.continuation) {
        await options.beforeAsk?.();
        let answer: TToolParameters;
        try {
          answer = options.parallelPrompts
            ? (
                await Promise.all(
                  ['first', 'second'].map((stage) =>
                    context.continuation!.request({
                      kind: 'fixture/approval',
                      data: { stage, arguments: parameters },
                    }),
                  ),
                )
              )[0]
            : await context.continuation.request({
                kind: 'fixture/approval',
                data: { arguments: parameters },
              });
        } catch (error) {
          if (options.swallowWait) return { success: false, error: 'Normalized approval failure' };
          throw error;
        }
        if (answer.approved !== true) return { success: false, error: 'Denied by host' };
      }
      await admit(parameters);
      return base.execute(parameters, context);
    },
  });
  const agent = new ConversationAgent({
    // These fixtures exercise independent calls settling concurrently.
    toolExecutionPolicy: (calls) => ({
      scheduling: new Map(calls.map((call) => [call.id, { resources: [] }])),
    }),
    name: 'suspension',
    aiProviders: [scripted.provider],
    defaultModel: { provider: scripted.provider.name, model: 'test-model' },
    tools: [tool],
    plugins: options.plugins,
  });
  agents.push(agent);
  return { agent, effect, ...scripted };
}
const action: TScriptedTurn = { toolCalls: [{ name: 'act', args: {} }] };
async function suspended() {
  const source = fixture([action, { text: 'must not run' }]);
  const saved = journalFixture();
  const result = await source.agent.run('original input', { executionJournal: saved.journal }).then(
    () => {
      throw new Error('Expected suspension');
    },
    (error: unknown) => error,
  );
  expect(result).toMatchObject({ code: 'EXECUTION_SUSPENDED', requests: [expect.any(Object)] });
  const request = (result as { requests: IToolWaitRequest[] }).requests[0];
  return { ...saved, source, request, executionId: request.executionId };
}

describe('journaled tool suspension', () => {
  it('fires each call hook once across repeated suspension, resume and recovered results', async () => {
    class Recorder extends AbstractPlugin {
      readonly name = 'per-call-recorder';
      readonly version = '1';
      before = vi.fn();
      execution = vi.fn();
      after = vi.fn();
      override async beforeToolCall(): Promise<void> {
        this.before();
      }
      override async beforeToolExecution(): Promise<void> {
        this.execution();
      }
      override async afterToolCall(): Promise<void> {
        this.after();
      }
    }
    const plugin = new Recorder();
    const source = fixture([action, { text: 'done' }], { plugins: [plugin] });
    const saved = journalFixture();
    const error = await source.agent
      .run('input', { executionJournal: saved.journal })
      .catch((e: unknown) => e);
    expect(error).toMatchObject({ code: 'EXECUTION_SUSPENDED' });
    const request = (error as { requests: IToolWaitRequest[] }).requests[0];
    expect(plugin.before).toHaveBeenCalledTimes(1);
    expect(plugin.execution).toHaveBeenCalledTimes(1);
    expect(plugin.after).not.toHaveBeenCalled();
    const options = { executionId: request.executionId, journal: saved.journal };
    await expect(source.agent.resume(options)).rejects.toMatchObject({
      code: 'EXECUTION_SUSPENDED',
    });
    expect(plugin.before).toHaveBeenCalledTimes(1);
    expect(plugin.execution).toHaveBeenCalledTimes(1);
    await source.agent.resume({
      ...options,
      toolResponses: [
        { requestId: request.requestId, responseId: 'response', response: { approved: true } },
      ],
    });
    expect(plugin.after).toHaveBeenCalledTimes(1);
    await source.agent.resume(options);
    expect(plugin.before).toHaveBeenCalledTimes(1);
    expect(plugin.execution).toHaveBeenCalledTimes(1);
    expect(plugin.after).toHaveBeenCalledTimes(1);
    expect(source.effect).toHaveBeenCalledTimes(1);
  });

  it('refuses effect admission when a restored wrapper skips an unanswered request', async () => {
    const f = await suspended();
    const fresh = fixture([{ text: 'must not run' }], { skipAsk: true });
    await expect(fresh.agent.resume(f)).rejects.toMatchObject({
      code: 'EXECUTION_SUSPENDED',
      requests: [f.request],
    });
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.requests).toHaveLength(0);
  });

  it('requires reconciliation when a started effect attempts to become a wait', async () => {
    const f = fixture(
      [{ toolCalls: [{ name: 'act', args: { index: 1 } }] }, { text: 'must not run' }],
      {
        effect: async (_parameters, context) => {
          await context!.continuation!.request({ kind: 'fixture/late', data: {} });
          return 'must not return';
        },
      },
    );
    const saved = journalFixture();
    await expect(f.agent.run('input', { executionJournal: saved.journal })).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(saved.records.some((record) => record.kind === 'tool-effect-start')).toBe(true);
    expect(
      saved.records.some((record) => record.kind === 'tool-wait' || record.kind === 'tool-result'),
    ).toBe(false);
    expect(f.requests).toHaveLength(1);
  });

  it.each([false, true])(
    'drains concurrent continuation requests before returning (late failure=%s)',
    async (writeFailure) => {
      const f = fixture([action, { text: 'must not run' }], { parallelPrompts: true });
      const saved = journalFixture();
      const entered = deferred();
      const release = deferred();
      let settled = false;
      const running = f.agent
        .run('input', {
          executionJournal: {
            append: async (record) => {
              if (record.kind === 'tool-wait' && record.request.data.stage === 'second') {
                entered.resolve();
                await release.promise;
                if (writeFailure) throw new Error('late request write failed');
              }
              await saved.journal.append(record);
            },
          },
        })
        .finally(() => {
          settled = true;
        });
      const caught = running.catch((error: unknown) => error);
      await Promise.race([entered.promise, caught]);
      await new Promise<void>((resolve) => setImmediate(resolve));
      const premature = settled;
      release.resolve();
      const result = await caught;
      expect(premature).toBe(false);
      expect(result).toMatchObject({
        code: writeFailure ? 'EXECUTION_JOURNAL_FAILED' : 'EXECUTION_SUSPENDED',
      });
      if (!writeFailure)
        expect(result).toMatchObject({ requests: [expect.any(Object), expect.any(Object)] });
      expect(f.effect).not.toHaveBeenCalled();
      expect(f.requests).toHaveLength(1);
    },
  );

  it('owns response payloads before an asynchronous journal read', async () => {
    const f = await suspended();
    const fresh = fixture([{ text: 'denied' }]);
    const response = {
      requestId: f.request.requestId,
      responseId: 'reply',
      response: { approved: false },
    };
    f.journal.read.mockImplementation(async () => {
      response.response.approved = true;
      return structuredClone(f.records);
    });
    await expect(fresh.agent.resume({ ...f, toolResponses: [response] })).resolves.toBe('denied');
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(f.records.find((record) => record.kind === 'tool-response')).toMatchObject({
      response: { response: { approved: false } },
    });
  });

  it.each([false, true])(
    'preserves continuation control flow even when a tool swallows it (write failure=%s)',
    async (writeFailure) => {
      const f = fixture([action, { text: 'must not run' }], { swallowWait: true });
      const saved = journalFixture();
      await expect(
        f.agent.run('input', {
          executionJournal: {
            append: async (record) => {
              if (writeFailure && record.kind === 'tool-wait') throw new Error('offline');
              await saved.journal.append(record);
            },
          },
        }),
      ).rejects.toMatchObject({
        code: writeFailure ? 'EXECUTION_JOURNAL_FAILED' : 'EXECUTION_SUSPENDED',
      });
      expect(f.effect).not.toHaveBeenCalled();
      expect(f.requests).toHaveLength(1);
      expect(saved.records.some((record) => record.kind === 'tool-result')).toBe(false);
    },
  );

  it('persists a request bound to its exact action before returning a wait', async () => {
    const f = await suspended();
    expect(f.source.effect).not.toHaveBeenCalled();
    expect(f.source.requests).toHaveLength(1);
    expect(f.records.map((record) => record.kind)).toEqual([
      'model-request',
      'model-response',
      'tool-intent',
      'tool-dispatch',
      'tool-wait',
    ]);
    const intent = f.records.find((record) => record.kind === 'tool-intent')!;
    expect(f.request).toMatchObject({
      actionId: intent.actionId,
      parentCallId: intent.parentCallId,
      toolCallId: intent.toolCallId,
      toolName: 'act',
      kind: 'fixture/approval',
      data: { arguments: {} },
    });
    expect(JSON.parse(JSON.stringify(f.request))).toEqual(f.request);
  });

  it('reuses the saved wait without a response or a new provider call', async () => {
    const f = await suspended();
    const fresh = fixture([{ text: 'must not run' }]);
    const before = f.records.length;
    for (let attempt = 0; attempt < 2; attempt++)
      await expect(fresh.agent.resume(f)).rejects.toMatchObject({
        code: 'EXECUTION_SUSPENDED',
        requests: [f.request],
      });
    expect(f.records).toHaveLength(before);
    expect(fresh.effect).not.toHaveBeenCalled();
    expect(fresh.requests).toHaveLength(0);
  });

  it.each([true, false])('continues a correlated response once (approved=%s)', async (approved) => {
    const f = await suspended();
    const fresh = fixture([{ text: 'continued' }]);
    const options = {
      ...f,
      toolResponses: [
        { requestId: f.request.requestId, responseId: 'reply', response: { approved } },
      ],
    };
    await expect(fresh.agent.resume(options)).resolves.toBe('continued');
    expect(fresh.effect).toHaveBeenCalledTimes(approved ? 1 : 0);
    expect(fresh.requests).toHaveLength(1);
    expect(f.records.filter((record) => record.kind === 'tool-response')).toHaveLength(1);
    expect(
      fresh.agent
        .getHistory()
        .filter((message) => message.role === 'user')
        .map((message) => message.content),
    ).toEqual(['original input']);
    await expect(fresh.agent.resume(options)).resolves.toBe('continued');
    expect(fresh.requests).toHaveLength(1);
  });

  it('rejects a competing response after durable acceptance', async () => {
    const f = await suspended();
    const fresh = fixture([{ text: 'continued' }]);
    const response = {
      requestId: f.request.requestId,
      responseId: 'reply',
      response: { approved: true },
    };
    await fresh.agent.resume({ ...f, toolResponses: [response] });
    for (const conflicting of [
      { ...response, responseId: 'other' },
      { ...response, response: { approved: false } },
    ])
      await expect(
        fresh.agent.resume({ ...f, toolResponses: [conflicting] }),
      ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(fresh.effect).toHaveBeenCalledOnce();
    expect(fresh.requests).toHaveLength(1);
  });

  it('does not enter a body or produce a tool result after request persistence fails', async () => {
    const f = fixture([action, { text: 'must not run' }]);
    const saved = journalFixture();
    await expect(
      f.agent.run('input', {
        executionJournal: {
          append: async (record) => {
            if (record.kind === 'tool-wait') throw new Error('offline');
            await saved.journal.append(record);
          },
        },
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-wait' });
    expect(f.effect).not.toHaveBeenCalled();
    expect(f.requests).toHaveLength(1);
    expect(
      saved.records.some(
        (record) => record.kind === 'tool-result' || record.kind === 'tool-effect-start',
      ),
    ).toBe(false);
  });

  it.each([false, true])(
    'lets running siblings settle and leaves undispatched calls pending when one waits (cancelled=%s)',
    async (cancelled) => {
      const started = deferred();
      const waitSaved = deferred();
      const finish = deferred();
      const abortedSiblings: boolean[] = [];
      let count = 0;
      const f = fixture(
        [
          {
            toolCalls: Array.from({ length: 7 }, (_, index) => ({ name: 'act', args: { index } })),
          },
        ],
        {
          beforeAsk: () => started.promise,
          effect: async (_parameters, context) => {
            if (++count === 4) started.resolve();
            const signal = context!.signal!;
            await Promise.race([
              finish.promise,
              new Promise<void>((resolve) =>
                signal.addEventListener('abort', () => resolve(), { once: true }),
              ),
            ]);
            abortedSiblings.push(signal.aborted);
            return signal.aborted ? 'stopped by cancellation' : 'finished';
          },
        },
      );
      const saved = journalFixture();
      let settled = false;
      const abort = new AbortController();
      const running = f.agent
        .run('input', {
          signal: abort.signal,
          executionJournal: {
            append: async (record) => {
              await saved.journal.append(record);
              if (record.kind === 'tool-wait') waitSaved.resolve();
            },
          },
        })
        .finally(() => {
          settled = true;
        });
      const caught = running.catch((error: unknown) => error);
      try {
        await Promise.race([waitSaved.promise, caught]);
        await new Promise<void>((resolve) => setImmediate(resolve));
        expect(settled).toBe(false);
        expect(f.effect).toHaveBeenCalledTimes(4);
        expect(abortedSiblings).toEqual([]);
      } finally {
        if (cancelled) abort.abort();
        else finish.resolve();
      }
      expect(await caught).toMatchObject({ code: 'EXECUTION_SUSPENDED' });
      finish.resolve();
      expect(abortedSiblings).toEqual([cancelled, cancelled, cancelled, cancelled]);
      const results = saved.records.flatMap((record) =>
        record.kind === 'tool-result' ? [record.result.result] : [],
      );
      expect(results).toEqual(Array(4).fill(cancelled ? 'stopped by cancellation' : 'finished'));
      expect(saved.records.filter((record) => record.kind === 'tool-dispatch')).toHaveLength(5);
      expect(f.requests).toHaveLength(1);
    },
  );
});
