import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ABSTRACT_EVENT_SERVICE } from '../event-service';
import type { IExecutionJournal, TExecutionJournalRecord } from '../interfaces/execution-journal';
import type { IAssistantMessage, IToolCall } from '../interfaces/messages';
import type { IToolExecutionResult } from '../interfaces/tool';
import type { IToolSchema } from '../interfaces/tool-schema';
import { ConversationStore } from '../managers/conversation-store';
import { Tools } from '../managers/tool-manager';
import { SilentLogger } from '../utils/logger';
import { ExecutionEventEmitter } from './execution-event-emitter';
import { recoverToolBatch } from './execution-recovery-state';
import { executeAndRecordToolCalls } from './execution-round-tools';
import { attachToolBatchJournal } from './execution-tool-journal';
import { ToolExecutionService } from './tool-execution-service';
import type { IExecutionRoundState } from './execution-types';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';

const schema: IToolSchema = {
  name: 'act',
  description: 'A fixture action',
  parameters: { type: 'object', properties: { value: { type: 'number' } } },
};
const calls: IToolCall[] = ['first', 'second'].map((id) => ({
  id,
  type: 'function',
  function: { name: 'act', arguments: '{"value":1}' },
}));

function fixture() {
  const records: TExecutionJournalRecord[] = [];
  const effects: string[] = [];
  const inputs: unknown[] = [];
  const response: IAssistantMessage = {
    id: 'assistant',
    role: 'assistant',
    content: '',
    timestamp: new Date(),
    state: 'complete',
    toolCalls: calls,
  };
  const tools = new Tools({ resolveToolSearchMode: () => 'off' });
  tools.addTool(schema, async (parameters, context) => {
    expect(records.filter((record) => record.kind === 'tool-intent')).toHaveLength(2);
    if (!context?.beforeToolEffect || !context.executionId)
      throw new Error('Missing effect admission or call identity');
    await context.beforeToolEffect(parameters);
    effects.push(context.executionId);
    inputs.push(parameters['value']);
    return `result for ${context.executionId}`;
  });
  const toolExecutionService = new ToolExecutionService(tools);
  const eventEmitter = new ExecutionEventEmitter(DEFAULT_ABSTRACT_EVENT_SERVICE, SilentLogger);
  eventEmitter.prepareOwnerPathBases('conversation');
  const journal: IExecutionJournal = {
    append: async (record) => void records.push(structuredClone(record)),
  };
  const run = (
    journalToUse = journal,
    recovery?: ReturnType<typeof recoverToolBatch>,
    captureReceipts = true,
    requestedCalls = calls,
    frame = response,
  ) => {
    const store = new ConversationStore();
    store.addMessage(structuredClone(frame));
    const state: IExecutionRoundState = {
      toolsExecuted: [],
      toolCallOutcomes: [],
      currentRound: 1,
      runningAssistantCount: 1,
      lastTrackedAssistantMessage: undefined,
      cumulativeInputTokens: 0,
      consecutiveUnknownToolFailureRounds: 0,
      sameToolInputCounts: new Map(),
    };
    return executeAndRecordToolCalls(
      requestedCalls,
      store,
      'conversation',
      'execution',
      1,
      'frame',
      undefined,
      state,
      { toolExecutionService, eventEmitter, logger: SilentLogger, plugins: [] },
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      {
        journal: journalToUse,
        parentCallId: 'provider-call',
        captureReceipts,
        assistantFrame: frame,
        ...(recovery && { recovery }),
      },
    );
  };
  return { effects, inputs, journal, records, response, run };
}

describe('journaled tool batch receipts', () => {
  it('keeps ordinary model-step execution free of receipt snapshots', async () => {
    const f = fixture();
    const outcome = await f.run(f.journal, undefined, false);
    expect(outcome.receipts).toBeUndefined();
    expect(f.effects).toHaveLength(2);
    expect(f.records.filter((record) => record.kind === 'tool-result')).toHaveLength(2);
  });

  it('returns one correlated receipt for each durably settled call and reuses it on recovery', async () => {
    const f = fixture();
    const first = await f.run();
    expect(f.effects).toHaveLength(2);
    expect(first.receipts).toHaveLength(2);
    for (const receipt of first.receipts ?? []) {
      const saved = f.records.find(
        (record) => record.kind === 'tool-result' && record.toolCallId === receipt.toolCallId,
      );
      expect(saved).toMatchObject({ actionId: receipt.actionId, result: receipt.result });
      expect(receipt.result).toMatchObject({
        executionId: receipt.toolCallId,
        toolName: 'act',
        result: `result for ${receipt.toolCallId}`,
      });
    }
    const route = {
      executionId: 'execution',
      callId: 'provider-call',
      providerId: 'fixture',
      modelId: 'model',
    };
    const recovered = recoverToolBatch(
      [
        {
          kind: 'model-request',
          recordId: 'provider-call:request',
          ...route,
          messages: [],
          options: { tools: [schema] },
          checkpoint: {
            version: 1,
            effectAdmission: 'required',
            messages: [],
            round: 1,
            contextLimit: 100_000,
            cumulativeInputTokens: 0,
            sameToolInputCounts: [],
          },
        },
        {
          kind: 'model-response',
          recordId: 'provider-call:response',
          ...route,
          response: f.response,
        },
        ...f.records,
      ],
      'execution',
      'provider-call',
    );
    const changedCalls = structuredClone(calls);
    changedCalls[0].function.arguments = '{"value":2}';
    const before = f.records.length;
    await expect(f.run(f.journal, recovered, true, changedCalls)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(f.records).toHaveLength(before);
    expect(f.effects).toHaveLength(2);

    const changedFrame = { ...f.response, id: 'other-frame' };
    await expect(f.run(f.journal, recovered, true, calls, changedFrame)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(f.records).toHaveLength(before);
    expect(f.effects).toHaveLength(2);

    for (const [savedValue, differentValue] of [
      [Number.NaN, null],
      [-0, 0],
    ] as const) {
      const saved = structuredClone(recovered);
      saved.response.metadata = { marker: savedValue };
      const frame = {
        ...f.response,
        metadata: { marker: differentValue },
      } as unknown as IAssistantMessage;
      await expect(f.run(f.journal, saved, true, calls, frame)).rejects.toMatchObject({
        code: 'EXECUTION_RECOVERY_CONFLICT',
      });
      expect(f.records).toHaveLength(before);
      expect(f.effects).toHaveLength(2);
    }

    const savedWithDate = structuredClone(recovered);
    savedWithDate.response.metadata = { at: new Date('2026-01-01T00:00:00.000Z') };
    const sameFrame = { ...f.response, metadata: { at: new Date('2026-01-01T00:00:00.000Z') } };
    expect((await f.run(f.journal, savedWithDate, true, calls, sameFrame)).receipts).toEqual(
      first.receipts,
    );
    expect(f.effects).toHaveLength(2);

    const wrongExecution = structuredClone(recovered);
    wrongExecution.executionId = 'another-execution';
    await expect(f.run(f.journal, wrongExecution)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    expect(f.records).toHaveLength(before);
    expect(f.effects).toHaveLength(2);

    const unknown = structuredClone(recovered);
    const unknownAction = unknown.actions.get('first');
    if (!unknownAction) throw new Error('Missing recovered action');
    delete unknownAction.result;
    await expect(f.run(f.journal, unknown)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
      actionIds: [unknownAction.actionId],
    });
    expect(f.records).toHaveLength(before);
    expect(f.effects).toHaveLength(2);

    const resumed = await f.run(f.journal, recovered);
    expect(resumed.receipts).toEqual(first.receipts);
    expect(f.effects).toHaveLength(2);
  });

  it('waits for every result append before returning receipts', async () => {
    const f = fixture();
    let reached!: () => void;
    let release!: () => void;
    const firstResult = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const journal: IExecutionJournal = {
      append: async (record) => {
        if (record.kind === 'tool-result') {
          reached();
          await gate;
        }
        await f.journal.append(record);
      },
    };
    let finished = false;
    const running = f.run(journal);
    void running.then(
      () => (finished = true),
      () => (finished = true),
    );
    await firstResult;
    expect(finished).toBe(false);
    release();
    const outcome = await running;
    expect(outcome.receipts).toHaveLength(2);
    expect(f.records.filter((record) => record.kind === 'tool-result')).toHaveLength(2);
  });

  it('freezes the assistant frame and arguments before an asynchronous journal append', async () => {
    const f = fixture();
    let reached!: () => void;
    let release!: () => void;
    const intentStarted = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const journal: IExecutionJournal = {
      append: async (record) => {
        if (record.kind === 'tool-intent' && record.toolCallId === 'first') {
          reached();
          await gate;
        }
        await f.journal.append(record);
      },
    };
    const requested = structuredClone(calls);
    const frame = structuredClone(f.response);
    const running = f.run(journal, undefined, true, requested, frame);
    await intentStarted;
    requested[0].function.arguments = '{"value":999}';
    if (!frame.toolCalls) throw new Error('Missing frame calls');
    frame.toolCalls[0].function.arguments = '{"value":999}';
    release();
    const outcome = await running;
    expect(outcome.receipts).toHaveLength(2);
    expect(f.inputs).toEqual([1, 1]);
  });

  it('does not return receipts when result persistence fails', async () => {
    const f = fixture();
    const journal: IExecutionJournal = {
      append: async (record) => {
        if (record.kind === 'tool-result') throw new Error('unavailable');
        await f.journal.append(record);
      },
    };
    await expect(f.run(journal)).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(f.effects.length).toBeGreaterThan(0);
    expect(f.records.some((record) => record.kind === 'tool-result')).toBe(false);
  });

  it('returns the exact saved snapshot even if the executor mutates its result during persistence', async () => {
    const records: TExecutionJournalRecord[] = [];
    let reached!: () => void;
    let release!: () => void;
    const appending = new Promise<void>((resolve) => (reached = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    const journal: IExecutionJournal = {
      append: async (record) => {
        if (record.kind === 'tool-result') {
          reached();
          await gate;
        }
        records.push(structuredClone(record));
      },
    };
    const batch: IToolExecutionBatchContext = {
      requests: [{ toolName: 'act', parameters: { value: 1 }, executionId: 'first' }],
      mode: 'sequential',
    };
    const settlement = await attachToolBatchJournal(
      batch,
      'execution',
      { journal, parentCallId: 'provider-call', captureReceipts: true },
      () => undefined,
    );
    if (!batch.journal?.beforeEffect || !settlement) throw new Error('Missing journal boundary');
    await batch.journal.beforeDispatch(0);
    await batch.journal.beforeEffect(0, { value: 1 });
    const payload = { value: 'original' };
    const writing = batch.journal.onResult(0, {
      executionId: 'first',
      toolName: 'act',
      success: true,
      result: payload,
    });
    await appending;
    expect(settlement.receipts()).toBeUndefined();
    payload.value = 'changed';
    release();
    await writing;
    expect(records.find((record) => record.kind === 'tool-result')).toMatchObject({
      result: { result: { value: 'original' } },
    });
    const receipts = settlement.receipts();
    expect(receipts).toMatchObject([{ result: { result: { value: 'original' } } }]);
    const result = receipts?.[0]?.result.result;
    if (!result || typeof result !== 'object' || Array.isArray(result) || result instanceof Date)
      throw new Error('Expected an object result');
    result['value'] = 'modified by recipient';
    expect(settlement.receipts()).toMatchObject([{ result: { result: { value: 'original' } } }]);
  });

  it('does not produce a receipt for a settlement belonging to another call', async () => {
    const append = vi.fn(async () => {});
    const batch: IToolExecutionBatchContext = {
      requests: [{ toolName: 'act', parameters: { value: 1 }, executionId: 'first' }],
      mode: 'sequential',
    };
    const settlement = await attachToolBatchJournal(
      batch,
      'execution',
      { journal: { append }, parentCallId: 'provider-call', captureReceipts: true },
      () => undefined,
    );
    if (!batch.journal || !settlement) throw new Error('Missing journal boundary');
    await expect(
      batch.journal.onResult(0, {
        executionId: 'other',
        toolName: 'act',
        success: true,
        result: 'value',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-result' });
    expect(append).toHaveBeenCalledTimes(1);
    expect(settlement.receipts()).toBeUndefined();
  });

  it('refuses duplicate call identities before writing any intents', async () => {
    const append = vi.fn(async () => {});
    const batch: IToolExecutionBatchContext = {
      requests: [
        { toolName: 'act', parameters: { value: 1 }, executionId: 'same' },
        { toolName: 'act', parameters: { value: 2 }, executionId: 'same' },
      ],
      mode: 'parallel',
    };
    await expect(
      attachToolBatchJournal(
        batch,
        'execution',
        { journal: { append }, parentCallId: 'provider-call', captureReceipts: true },
        () => undefined,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses a missing execution, parent or batch identity before writing', async () => {
    const append = vi.fn(async () => {});
    const request = { toolName: 'act', parameters: { value: 1 }, executionId: 'first' };
    for (const input of [
      { requests: [], executionId: 'execution', parentCallId: 'provider-call' },
      { requests: [request], executionId: ' ', parentCallId: 'provider-call' },
      { requests: [request], executionId: 'execution', parentCallId: '' },
    ]) {
      await expect(
        attachToolBatchJournal(
          { requests: input.requests, mode: 'sequential' },
          input.executionId,
          { journal: { append }, parentCallId: input.parentCallId, captureReceipts: true },
          () => undefined,
        ),
      ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
    }
    expect(append).not.toHaveBeenCalled();
  });

  it('refuses a successful result that has no recorded effect admission', async () => {
    const append = vi.fn(async () => {});
    const batch: IToolExecutionBatchContext = {
      requests: [{ toolName: 'act', parameters: { value: 1 }, executionId: 'first' }],
      mode: 'sequential',
    };
    const settlement = await attachToolBatchJournal(
      batch,
      'execution',
      { journal: { append }, parentCallId: 'provider-call', captureReceipts: true },
      () => undefined,
    );
    if (!batch.journal || !settlement) throw new Error('Missing journal boundary');
    await batch.journal.beforeDispatch(0);
    await expect(
      batch.journal.onResult(0, {
        executionId: 'first',
        toolName: 'act',
        success: true,
        result: 'value',
      }),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED', kind: 'tool-result' });
    expect(append).toHaveBeenCalledTimes(2);
    expect(settlement.receipts()).toBeUndefined();
  });

  it('classifies an uncloneable settlement as a journal failure', async () => {
    const batch: IToolExecutionBatchContext = {
      requests: [{ toolName: 'act', parameters: { value: 1 }, executionId: 'first' }],
      mode: 'sequential',
    };
    const settlement = await attachToolBatchJournal(
      batch,
      'execution',
      { journal: { append: async () => {} }, parentCallId: 'provider-call', captureReceipts: true },
      () => undefined,
    );
    if (!batch.journal?.beforeEffect || !settlement) throw new Error('Missing journal boundary');
    await batch.journal.beforeDispatch(0);
    await batch.journal.beforeEffect(0, { value: 1 });
    const invalid = {
      executionId: 'first',
      toolName: 'act',
      success: true,
      result: () => {},
    } as unknown as IToolExecutionResult;
    await expect(batch.journal.onResult(0, invalid)).rejects.toMatchObject({
      code: 'EXECUTION_JOURNAL_FAILED',
      kind: 'tool-result',
    });
    expect(settlement.receipts()).toBeUndefined();
  });
});
