import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ABSTRACT_EVENT_SERVICE } from '../../event-service';
import type { TAgentExecutionConfig } from '../../interfaces/agent';
import type { TExecutionJournalRecord } from '../../interfaces/execution-journal';
import type {
  IManagedRunProvider,
  TManagedToolBatch,
  TManagedTurnResult,
} from '../../interfaces/managed-provider';
import type { IToolSchema } from '../../interfaces/tool-schema';
import { ConversationStore } from '../../managers/conversation-store';
import { Tools } from '../../managers/tool-manager';
import { SilentLogger } from '../../utils/logger';
import { ExecutionEventEmitter } from '../execution-event-emitter';
import { createManagedToolExecutor } from '../execution-managed-host';
import { ToolExecutionService } from '../tool-execution-service';

const schema: IToolSchema = {
  name: 'act',
  description: 'Record a fixture action',
  parameters: { type: 'object', properties: { value: { type: 'number' } } },
};

function frame(id: string, calls: Array<[string, number]>): TManagedToolBatch {
  return {
    id,
    role: 'assistant',
    content: '',
    timestamp: new Date('2026-01-01T00:00:01.000Z'),
    state: 'complete',
    toolCalls: calls.map(([callId, value]) => ({
      id: callId,
      type: 'function' as const,
      function: { name: 'act', arguments: JSON.stringify({ value }) },
    })) as TManagedToolBatch['toolCalls'],
  };
}

function fixture(options?: { maxRounds?: number; maxSameToolInputs?: number }) {
  const records: TExecutionJournalRecord[] = [];
  const journal = {
    append: vi.fn(async (record: TExecutionJournalRecord) => {
      if (records.some((saved) => saved.recordId === record.recordId)) return;
      records.push(structuredClone(record));
    }),
    read: vi.fn(async () => structuredClone(records)),
  };
  const config: TAgentExecutionConfig = {
    name: 'managed-fixture',
    aiProviders: [],
    defaultModel: { provider: 'managed-provider', model: 'managed-model' },
    toolExecutionPolicy: (calls) => ({
      mode: 'parallel',
      maxConcurrency: 2,
      scheduling: new Map(
        calls.map((call, index) => [
          call.id,
          { resources: [], ...(index === 1 && { dependsOn: [calls[0].id] }) },
        ]),
      ),
    }),
  };
  const store = new ConversationStore();
  store.addMessage({
    id: 'user-message',
    role: 'user',
    content: 'perform actions',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    state: 'complete',
  });
  const effects = vi.fn(async (value: number) => `effect:${value}`);
  const tools = new Tools({ resolveToolSearchMode: () => 'off' });
  tools.addTool(schema, async (parameters, context) => {
    await context!.beforeToolEffect!(parameters);
    return effects(Number(parameters.value));
  });
  const controller = new AbortController();
  const host = createManagedToolExecutor({
    journal,
    store,
    conversationId: 'conversation',
    context: {
      conversationId: 'conversation',
      executionId: 'execution',
      startTime: new Date('2026-01-01T00:00:00.000Z'),
      messages: store.getMessages(),
      config,
      signal: controller.signal,
      maxExecutionRounds: options?.maxRounds,
      maxSameToolInputs: options?.maxSameToolInputs,
    },
    config,
    tools: [schema],
    state: {
      toolsExecuted: [],
      toolCallOutcomes: [],
      currentRound: 0,
      runningAssistantCount: 0,
      lastTrackedAssistantMessage: undefined,
      cumulativeInputTokens: 0,
      consecutiveUnknownToolFailureRounds: 0,
      sameToolInputCounts: new Map(),
    },
    deps: {
      toolExecutionService: new ToolExecutionService(tools),
      plugins: [],
      logger: SilentLogger,
      eventEmitter: new ExecutionEventEmitter(DEFAULT_ABSTRACT_EVENT_SERVICE, SilentLogger),
    },
  });
  return { records, journal, store, effects, ...host, controller };
}

describe('managed host tool boundary', () => {
  it('runs a scripted provider through two complete frames and returns only durable receipts', async () => {
    const f = fixture();
    const provider: IManagedRunProvider = {
      kind: 'managed-run',
      name: 'managed-provider',
      version: 'fixture',
      validateConfig: () => true,
      run: async (_input, host): Promise<TManagedTurnResult> => {
        const first = await host.execute(
          frame('frame-one', [
            ['call-one', 1],
            ['call-two', 2],
          ]),
        );
        expect(first.map((receipt) => receipt.result.result)).toEqual(['effect:1', 'effect:2']);
        expect(f.records.filter((record) => record.kind === 'tool-result')).toHaveLength(2);
        const second = await host.execute(
          frame('frame-two', [
            ['call-three', 3],
            ['call-four', 4],
          ]),
        );
        expect(second.map((receipt) => receipt.result.result)).toEqual(['effect:3', 'effect:4']);
        return {
          id: 'final-answer',
          role: 'assistant',
          content: 'done',
          timestamp: new Date('2026-01-01T00:00:02.000Z'),
          state: 'complete',
        };
      },
    };
    const result = await provider.run(
      { messages: [], tools: [schema], model: 'managed-model', options: {} },
      { signal: f.controller.signal, emit: async () => {}, execute: f.execute },
    );
    expect(result.content).toBe('done');
    f.assertHealthy();
    expect(f.effects).toHaveBeenCalledTimes(4);
    expect(f.store.getMessages().map((message) => message.role)).toEqual([
      'user',
      'assistant',
      'tool',
      'tool',
      'assistant',
      'tool',
      'tool',
    ]);
    expect(f.records.filter((record) => record.kind === 'managed-frame')).toHaveLength(2);
    expect(f.records.filter((record) => record.kind === 'tool-effect-start')).toHaveLength(4);
    const policy = f.records.find((record) => record.kind === 'tool-intent' && record.batchPolicy);
    expect(policy).toMatchObject({
      kind: 'tool-intent',
      batchPolicy: { mode: 'parallel', maxConcurrency: 2 },
    });
    if (policy?.kind !== 'tool-intent') throw new Error('Missing durable batch policy');
    expect(policy.batchPolicy?.scheduling).toContainEqual([
      'call-two',
      { dependsOn: ['call-one'], resources: [] },
    ]);
    const firstEffect = f.records.findIndex((record) => record.kind === 'tool-effect-start');
    expect(
      f.records.slice(0, firstEffect).filter((record) => record.kind === 'tool-intent'),
    ).toHaveLength(2);
    const first = frame('frame-one', [
      ['call-one', 1],
      ['call-two', 2],
    ]);
    const replay = await f.execute(first);
    expect(replay).toHaveLength(2);
    expect(f.effects).toHaveBeenCalledTimes(4);
    first.toolCalls[0].function.arguments = '{"value":9}';
    await expect(f.execute(first)).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    await expect(f.execute(frame('frame-three', [['call-five', 5]]))).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
  });

  it('rejects a second frame while the first has not returned its receipts', async () => {
    const f = fixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const append = f.journal.append.getMockImplementation()!;
    f.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-result') {
        enter();
        await gate;
      }
      await append(record);
    });
    const first = f.execute(frame('frame-one', [['call-one', 1]]));
    await entered;
    const sameFrame = f.execute(frame('frame-one', [['call-one', 1]]));
    await expect(f.execute(frame('frame-two', [['call-two', 2]]))).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    release();
    expect(await sameFrame).toEqual(await first);
    expect(f.effects).toHaveBeenCalledOnce();
    expect(f.records.filter((record) => record.kind === 'managed-frame')).toHaveLength(1);
    await expect(f.execute(frame('frame-three', [['call-three', 3]]))).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(() => f.assertHealthy()).toThrow(/awaiting durable receipts/);
  });

  it('latches a lost durable result and refuses later effects', async () => {
    const f = fixture();
    const append = f.journal.append.getMockImplementation()!;
    f.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-result') throw new Error('storage unavailable');
      await append(record);
    });
    await expect(f.execute(frame('frame-one', [['call-one', 1]]))).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
    });
    expect(f.effects).toHaveBeenCalledOnce();
    await expect(f.execute(frame('frame-two', [['call-two', 2]]))).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
    });
    expect(f.effects).toHaveBeenCalledOnce();
    expect(() => f.assertHealthy()).toThrow(/Execution journal failed at tool-result/);
  });

  it('retains a host failure when a provider swallows the callback rejection', async () => {
    const f = fixture();
    const append = f.journal.append.getMockImplementation()!;
    f.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-result') throw new Error('storage unavailable');
      await append(record);
    });
    const provider: IManagedRunProvider = {
      kind: 'managed-run',
      name: 'managed-provider',
      version: 'fixture',
      validateConfig: () => true,
      run: async (_input, host) => {
        try {
          await host.execute(frame('frame-one', [['call-one', 1]]));
        } catch {
          // A native runtime may still report a final success after the host callback failed.
        }
        return {
          id: 'false-success',
          role: 'assistant',
          content: 'done',
          timestamp: new Date('2026-01-01T00:00:02.000Z'),
          state: 'complete',
        };
      },
    };
    const reported = await provider.run(
      { messages: [], tools: [schema], model: 'managed-model', options: {} },
      { signal: f.controller.signal, emit: async () => {}, execute: f.execute },
    );
    expect(reported.content).toBe('done');
    expect(() => f.assertHealthy()).toThrow(/Execution journal failed at tool-result/);
  });

  it('refuses an existing journal and a new frame beyond the round limit', async () => {
    const existing = fixture();
    existing.records.push({
      kind: 'model-failure',
      recordId: 'prior:failure',
      executionId: 'execution',
      callId: 'prior',
      providerId: 'managed-provider',
      modelId: 'managed-model',
      error: { name: 'Error', message: 'prior failure' },
    });
    await expect(existing.execute(frame('frame-one', [['call-one', 1]]))).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(existing.effects).not.toHaveBeenCalled();
    expect(() => existing.assertHealthy()).toThrow(/previous managed turn/);

    const limited = fixture({ maxRounds: 1 });
    await limited.execute(frame('frame-one', [['call-one', 1]]));
    await expect(limited.execute(frame('frame-two', [['call-two', 2]]))).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(limited.effects).toHaveBeenCalledOnce();
  });

  it('keeps repeated-input limits across frames and refuses a cancelled next frame', async () => {
    const limited = fixture({ maxSameToolInputs: 1 });
    await limited.execute(frame('frame-one', [['call-one', 1]]));
    await expect(limited.execute(frame('frame-two', [['call-two', 1]]))).rejects.toMatchObject({
      name: 'SameToolInputLoopError',
    });
    expect(limited.effects).toHaveBeenCalledOnce();

    const cancelled = fixture();
    await cancelled.execute(frame('frame-one', [['call-one', 1]]));
    cancelled.controller.abort();
    await expect(cancelled.execute(frame('frame-two', [['call-two', 2]]))).rejects.toBeDefined();
    expect(cancelled.effects).toHaveBeenCalledOnce();
  });
});
