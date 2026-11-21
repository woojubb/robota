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
    expect(effects).toHaveBeenCalledOnce();
    expect(outcome.receipts).toHaveLength(1);
    expect(outcome.receipts?.[0]?.toolCallId).toBe('native-call');
    expect(f.records.map((record) => record.kind)).toContain('tool-result');
    expect(outcome.messages.map((message) => message.role)).toEqual(['user', 'assistant', 'tool']);
  });

  it('refuses an invalid frame before writing it', async () => {
    const f = fixture();
    f.frame.toolCalls[0].id = '';
    await expect(commitManagedToolFrame(f.journal, f.identity, f.frame)).rejects.toMatchObject({
      code: 'EXECUTION_RECOVERY_INVALID',
    });
    expect(f.journal.append).not.toHaveBeenCalled();
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
