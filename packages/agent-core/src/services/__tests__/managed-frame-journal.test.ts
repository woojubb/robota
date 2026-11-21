import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_ABSTRACT_EVENT_SERVICE } from '../../event-service';
import type {
  IExecutionRoundCheckpoint,
  TExecutionJournalRecord,
} from '../../interfaces/execution-journal';
import type { TManagedToolBatch } from '../../interfaces/managed-provider';
import type { IToolSchema } from '../../interfaces/tool-schema';
import { ConversationStore } from '../../managers/conversation-store';
import { Tools } from '../../managers/tool-manager';
import { SilentLogger } from '../../utils/logger';
import { ExecutionEventEmitter } from '../execution-event-emitter';
import { commitManagedToolFrame } from '../execution-journal';
import { recoverToolBatch } from '../execution-recovery-state';
import { resumeJournaledToolCalls } from '../execution-resume';
import { ToolExecutionService } from '../tool-execution-service';

const schema: IToolSchema = {
  name: 'act',
  description: 'A fixture action',
  parameters: { type: 'object', properties: { value: { type: 'number' } } },
};

function fixture() {
  const user = {
    id: 'user-message',
    role: 'user' as const,
    content: 'perform the action',
    timestamp: new Date('2026-01-01T00:00:00.000Z'),
    state: 'complete' as const,
  };
  const checkpoint: IExecutionRoundCheckpoint = {
    version: 1,
    effectAdmission: 'required',
    messages: [user],
    round: 1,
    contextLimit: 100_000,
    cumulativeInputTokens: 0,
    sameToolInputCounts: [],
  };
  const frame: TManagedToolBatch = {
    id: 'assistant-frame',
    role: 'assistant',
    content: '',
    timestamp: new Date('2026-01-01T00:00:01.000Z'),
    state: 'complete',
    toolCalls: [
      {
        id: 'native-call',
        type: 'function',
        function: { name: 'act', arguments: '{"value":1}' },
      },
    ],
  };
  const records: TExecutionJournalRecord[] = [];
  const journal = {
    append: vi.fn(async (record: TExecutionJournalRecord) => {
      if (records.some((saved) => saved.recordId === record.recordId)) return;
      records.push(structuredClone(record));
    }),
    read: vi.fn(async () => structuredClone(records)),
  };
  const identity = {
    executionId: 'execution',
    callId: 'managed-frame-call',
    providerId: 'managed-provider',
    modelId: 'managed-model',
    checkpoint,
    tools: [schema],
  };
  return { frame, checkpoint, records, journal, identity };
}

async function settle(f: ReturnType<typeof fixture>) {
  const effects = vi.fn(async () => 'effect completed');
  const tools = new Tools({ resolveToolSearchMode: () => 'off' });
  tools.addTool(schema, async (parameters, context) => {
    expect(f.records[0]?.kind).toBe('managed-frame');
    await context!.beforeToolEffect!(parameters);
    return effects();
  });
  const store = new ConversationStore();
  const outcome = await resumeJournaledToolCalls(
    store,
    'conversation',
    {
      executionId: 'execution',
      callId: 'managed-frame-call',
      journal: f.journal,
      includeReceipts: true,
    },
    {
      toolExecutionService: new ToolExecutionService(tools),
      plugins: [],
      logger: SilentLogger,
      eventEmitter: new ExecutionEventEmitter(DEFAULT_ABSTRACT_EVENT_SERVICE, SilentLogger),
    },
    {
      name: 'managed-fixture',
      aiProviders: [],
      defaultModel: { provider: 'managed-provider', model: 'managed-model' },
    },
  );
  return { outcome, effects };
}

describe('managed assistant frame journal', () => {
  it('commits the complete frame before a provider-free receipt recovery', async () => {
    const f = fixture();
    const committed = await commitManagedToolFrame(f.journal, f.identity, f.frame);
    expect(f.records).toHaveLength(1);
    expect(f.records[0]).toMatchObject({
      kind: 'managed-frame',
      response: { id: 'assistant-frame', toolCalls: [{ id: 'native-call' }] },
      checkpoint: { effectAdmission: 'required' },
    });
    expect(recoverToolBatch(f.records, 'execution', 'managed-frame-call').response).toEqual(
      committed,
    );

    const { outcome, effects } = await settle(f);
    expect(effects).toHaveBeenCalledOnce();
    expect(outcome.receipts).toHaveLength(1);
    expect(outcome.receipts?.[0]?.toolCallId).toBe('native-call');
    expect(f.records.map((record) => record.kind)).toContain('tool-result');
    expect(outcome.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
    const replay = await settle(f);
    expect(replay.effects).not.toHaveBeenCalled();
    expect(replay.outcome.receipts).toEqual(outcome.receipts);
  });

  it('advances only from a settled frame and rejects a reused native call identity', async () => {
    const f = fixture();
    const first = await commitManagedToolFrame(f.journal, f.identity, f.frame);
    await expect(commitManagedToolFrame(f.journal, f.identity, f.frame)).resolves.toEqual(first);
    expect(f.records).toHaveLength(1);

    const next = structuredClone(f.frame);
    next.id = 'assistant-frame-two';
    const nextIdentity = {
      ...f.identity,
      callId: 'managed-frame-call-two',
      checkpoint: { ...f.checkpoint, round: 2 },
    };
    await expect(commitManagedToolFrame(f.journal, nextIdentity, next)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_REQUIRED',
    });
    expect(f.records).toHaveLength(1);

    const { outcome, effects } = await settle(f);
    expect(effects).toHaveBeenCalledOnce();
    next.toolCalls[0].id = 'native-call-two';
    await expect(commitManagedToolFrame(f.journal, nextIdentity, next)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    next.toolCalls[0].id = 'native-call';
    nextIdentity.checkpoint.messages = outcome.messages;
    await expect(commitManagedToolFrame(f.journal, nextIdentity, next)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    next.toolCalls[0].id = 'native-call-two';
    const alteredHistory = structuredClone(outcome.messages);
    const last = alteredHistory.at(-1);
    if (last?.role !== 'tool') throw new Error('Missing settled tool observation');
    last.content = 'different result';
    await expect(
      commitManagedToolFrame(
        f.journal,
        { ...nextIdentity, checkpoint: { ...nextIdentity.checkpoint, messages: alteredHistory } },
        next,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    next.id = f.frame.id;
    await expect(commitManagedToolFrame(f.journal, nextIdentity, next)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_CONFLICT',
    });
    next.id = 'assistant-frame-two';
    await expect(
      commitManagedToolFrame(
        f.journal,
        { ...nextIdentity, providerId: 'other-managed-provider' },
        next,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    await expect(
      commitManagedToolFrame(
        f.journal,
        { ...nextIdentity, tools: [{ ...schema, description: 'changed projection' }] },
        next,
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    await expect(commitManagedToolFrame(f.journal, nextIdentity, next)).resolves.toEqual(next);
    expect(f.records.filter((record) => record.kind === 'managed-frame')).toHaveLength(2);
    expect(recoverToolBatch(f.records, 'execution', 'managed-frame-call-two').response).toEqual(
      next,
    );
  });

  it('refuses a conflicting replay of an already committed frame', async () => {
    const f = fixture();
    await commitManagedToolFrame(f.journal, f.identity, f.frame);
    f.frame.toolCalls[0].function.arguments = '{"value":2}';
    await expect(commitManagedToolFrame(f.journal, f.identity, f.frame)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(f.records).toHaveLength(1);
  });

  it('does not advance after an admitted effect loses its durable result', async () => {
    const f = fixture();
    await commitManagedToolFrame(f.journal, f.identity, f.frame);
    const append = f.journal.append.getMockImplementation()!;
    f.journal.append.mockImplementation(async (record) => {
      if (record.kind === 'tool-result') throw new Error('result storage unavailable');
      await append(record);
    });
    const effects = vi.fn(async () => 'effect completed');
    const tools = new Tools({ resolveToolSearchMode: () => 'off' });
    tools.addTool(schema, async (parameters, context) => {
      await context!.beforeToolEffect!(parameters);
      return effects();
    });
    await expect(
      resumeJournaledToolCalls(
        new ConversationStore(),
        'conversation',
        {
          executionId: 'execution',
          callId: 'managed-frame-call',
          journal: f.journal,
          includeReceipts: true,
        },
        {
          toolExecutionService: new ToolExecutionService(tools),
          plugins: [],
          logger: SilentLogger,
          eventEmitter: new ExecutionEventEmitter(DEFAULT_ABSTRACT_EVENT_SERVICE, SilentLogger),
        },
        {
          name: 'managed-fixture',
          aiProviders: [],
          defaultModel: { provider: 'managed-provider', model: 'managed-model' },
        },
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    expect(effects).toHaveBeenCalledOnce();
    const next = structuredClone(f.frame);
    next.id = 'assistant-frame-two';
    next.toolCalls[0].id = 'native-call-two';
    await expect(
      commitManagedToolFrame(f.journal, { ...f.identity, callId: 'managed-frame-call-two' }, next),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_REQUIRED' });
    expect(effects).toHaveBeenCalledOnce();
    expect(f.records.filter((record) => record.kind === 'managed-frame')).toHaveLength(1);
  });

  it('refuses an invalid frame before writing it', async () => {
    const f = fixture();
    f.frame.toolCalls[0].id = '';
    await expect(commitManagedToolFrame(f.journal, f.identity, f.frame)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(f.journal.append).not.toHaveBeenCalled();
  });

  it('refuses a call outside the managed tool projection during commit and recovery', async () => {
    const f = fixture();
    f.identity.tools = [];
    await expect(commitManagedToolFrame(f.journal, f.identity, f.frame)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(f.journal.append).not.toHaveBeenCalled();

    f.records.push({
      kind: 'managed-frame',
      recordId: 'managed-frame-call:frame',
      executionId: 'execution',
      callId: 'managed-frame-call',
      providerId: 'managed-provider',
      modelId: 'managed-model',
      response: structuredClone(f.frame),
      checkpoint: structuredClone(f.checkpoint),
      tools: [],
    });
    const effects = vi.fn(async () => 'effect completed');
    const tools = new Tools({ resolveToolSearchMode: () => 'off' });
    tools.addTool(schema, async () => effects());
    await expect(
      resumeJournaledToolCalls(
        new ConversationStore(),
        'conversation',
        {
          executionId: 'execution',
          callId: 'managed-frame-call',
          journal: f.journal,
          includeReceipts: true,
        },
        {
          toolExecutionService: new ToolExecutionService(tools),
          plugins: [],
          logger: SilentLogger,
          eventEmitter: new ExecutionEventEmitter(DEFAULT_ABSTRACT_EVENT_SERVICE, SilentLogger),
        },
        {
          name: 'managed-fixture',
          aiProviders: [],
          defaultModel: { provider: 'managed-provider', model: 'managed-model' },
        },
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_INVALID' });
    expect(effects).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(1);
  });

  it('refuses an active route change before recovering any managed tool effect', async () => {
    const f = fixture();
    await commitManagedToolFrame(f.journal, f.identity, f.frame);
    const effects = vi.fn(async () => 'effect completed');
    const tools = new Tools({ resolveToolSearchMode: () => 'off' });
    tools.addTool(schema, async () => effects());
    await expect(
      resumeJournaledToolCalls(
        new ConversationStore(),
        'conversation',
        {
          executionId: 'execution',
          callId: 'managed-frame-call',
          journal: f.journal,
          includeReceipts: true,
        },
        {
          toolExecutionService: new ToolExecutionService(tools),
          plugins: [],
          logger: SilentLogger,
          eventEmitter: new ExecutionEventEmitter(DEFAULT_ABSTRACT_EVENT_SERVICE, SilentLogger),
        },
        {
          name: 'managed-fixture',
          aiProviders: [],
          defaultModel: { provider: 'other-provider', model: 'managed-model' },
        },
      ),
    ).rejects.toMatchObject({ code: 'EXECUTION_RECOVERY_CONFLICT' });
    expect(effects).not.toHaveBeenCalled();
    expect(f.records).toHaveLength(1);
  });

  it('does not acknowledge a frame until storage acknowledges its append', async () => {
    const f = fixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    f.journal.append.mockImplementation(async () => {
      enter();
      await gate;
      throw new Error('lost acknowledgement');
    });
    const committed = commitManagedToolFrame(f.journal, f.identity, f.frame);
    const refused = expect(committed).rejects.toMatchObject({ code: 'EXECUTION_JOURNAL_FAILED' });
    await entered;
    expect(f.records).toHaveLength(0);
    release();
    await refused;
  });

  it('keeps the committed frame unchanged while an append is pending', async () => {
    const f = fixture();
    let enter!: () => void;
    let release!: () => void;
    const entered = new Promise<void>((resolve) => (enter = resolve));
    const gate = new Promise<void>((resolve) => (release = resolve));
    f.journal.append.mockImplementation(async (record) => {
      enter();
      await gate;
      f.records.push(structuredClone(record));
    });
    const committing = commitManagedToolFrame(f.journal, f.identity, f.frame);
    await entered;
    f.frame.toolCalls[0].function.arguments = '{"value":999}';
    release();
    const returned = await committing;
    expect(returned.toolCalls[0].function.arguments).toBe('{"value":1}');
    const saved = f.records[0];
    expect(saved?.kind).toBe('managed-frame');
    if (saved?.kind === 'managed-frame')
      expect(saved.response.toolCalls[0].function.arguments).toBe('{"value":1}');
  });
});
