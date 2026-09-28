import { describe, expect, it, vi } from 'vitest';
import type {
  IExecutionJournal,
  IRecoverableExecutionJournal,
  TExecutionJournalRecord,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { ModelCallIntent, TurnServices, UsageReport } from '@robota-sdk/agent-roundtable';
import { meterJournal, meterRecoverableJournal } from './metering-journal';

function services(): TurnServices & {
  admitted: ModelCallIntent[];
  recorded: UsageReport[];
} {
  const admitted: ModelCallIntent[] = [];
  const recorded: UsageReport[] = [];
  return {
    admitted,
    recorded,
    admitModelCall: vi.fn(async (call: ModelCallIntent) => {
      admitted.push(call);
    }),
    recordUsage: vi.fn(async (report: UsageReport) => {
      recorded.push(report);
    }),
  };
}

function response(overrides: Partial<TUniversalMessage> = {}): TUniversalMessage {
  return {
    id: 'resp-1',
    role: 'assistant',
    content: 'hi',
    state: 'complete',
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    ...overrides,
  } as TUniversalMessage;
}

/** The identity fields every `model-*` record shares; each call site adds its own `kind`. */
function modelIdentity() {
  return {
    recordId: 'r1',
    executionId: 'exec-1',
    callId: 'call-1',
    providerId: 'anthropic',
    modelId: 'claude',
  };
}

function modelRequestRecord(): TExecutionJournalRecord {
  return { ...modelIdentity(), kind: 'model-request', messages: [], options: {} };
}

describe('meterJournal (non-recoverable)', () => {
  it('admits a model-request before appending it to the inner journal', async () => {
    const svc = services();
    const order: string[] = [];
    const inner: IExecutionJournal = {
      append: vi.fn(async () => {
        order.push('append');
      }),
    };
    svc.admitModelCall = vi.fn(async () => {
      order.push('admit');
    });
    const metered = meterJournal(inner, svc);
    await metered.append(modelRequestRecord());
    expect(order).toEqual(['admit', 'append']);
    expect(svc.admitModelCall).toHaveBeenCalledWith({
      callId: 'call-1',
      providerId: 'anthropic',
      modelId: 'claude',
    });
  });

  it('never dispatches when admission is rejected', async () => {
    const svc = services();
    svc.admitModelCall = vi.fn(async () => {
      throw new Error('model-call limit reached');
    });
    const inner: IExecutionJournal = { append: vi.fn(async () => {}) };
    const metered = meterJournal(inner, svc);
    await expect(metered.append(modelRequestRecord())).rejects.toThrow('model-call limit reached');
    expect(inner.append).not.toHaveBeenCalled();
  });

  it('records completed usage, with provenance and tokens, after a model-response', async () => {
    const svc = services();
    const inner: IExecutionJournal = { append: vi.fn(async () => {}) };
    const metered = meterJournal(inner, svc);
    await metered.append({
      ...modelIdentity(),
      kind: 'model-response',
      response: response({
        metadata: { usageProvenance: 'complete', inputTokens: 10, outputTokens: 5 },
      }),
    });
    expect(inner.append).toHaveBeenCalledOnce();
    expect(svc.recorded).toEqual([
      {
        callId: 'call-1',
        outcome: 'completed',
        provenance: 'reported',
        tokens: { input: 10, output: 5 },
        final: true,
      },
    ]);
  });

  it('records unknown usage, with no token fields, on a model-failure', async () => {
    const svc = services();
    const inner: IExecutionJournal = { append: vi.fn(async () => {}) };
    const metered = meterJournal(inner, svc);
    await metered.append({
      ...modelIdentity(),
      kind: 'model-failure',
      error: { name: 'Error', message: 'timeout' },
    });
    expect(svc.recorded).toEqual([
      { callId: 'call-1', outcome: 'failed', provenance: 'unknown', final: true },
    ]);
    expect(svc.recorded[0]).not.toHaveProperty('tokens');
  });

  // Optional: an 'unknown'-provenance report used to still attach tokens whenever the message's
  // metadata happened to carry plain inputTokens/outputTokens fields, EVEN with no
  // `usageProvenance: 'complete'|'partial'` marker verifying them — reading as more trustworthy
  // than 'unknown' should mean.
  it('omits tokens for unknown provenance even when metadata carries plain token counts', async () => {
    const svc = services();
    const inner: IExecutionJournal = { append: vi.fn(async () => {}) };
    const metered = meterJournal(inner, svc);
    await metered.append({
      ...modelIdentity(),
      kind: 'model-response',
      response: response({ metadata: { inputTokens: 10, outputTokens: 5 } }),
    });
    expect(svc.recorded[0]).toMatchObject({
      callId: 'call-1',
      outcome: 'completed',
      provenance: 'unknown',
    });
    expect(svc.recorded[0]).not.toHaveProperty('tokens');
  });

  // The ledger rejects a fractional token count outright; a reporter with fractional provider
  // counts must round them first. 'partial' provenance skips the strict integer check
  // `verifiedProviderCallUsage` applies to 'complete', so this is where a fractional count can
  // legitimately reach `usageReport` while provenance is still non-'unknown'.
  it('rounds fractional token counts to the nearest integer', async () => {
    const svc = services();
    const inner: IExecutionJournal = { append: vi.fn(async () => {}) };
    const metered = meterJournal(inner, svc);
    await metered.append({
      ...modelIdentity(),
      kind: 'model-response',
      response: response({
        metadata: { usageProvenance: 'partial', inputTokens: 10.4, outputTokens: 5.6 },
      }),
    });
    expect(svc.recorded[0]).toMatchObject({
      provenance: 'partial',
      tokens: { input: 10, output: 6 },
    });
  });

  // The ledger requires non-negative integers; agent-core's own usage readers only guard
  // finiteness, not sign, so a negative count (finite, and therefore not filtered upstream) can
  // still reach this adapter and must be dropped here rather than forwarded as given.
  it('drops a negative token count instead of propagating it', async () => {
    const svc = services();
    const inner: IExecutionJournal = { append: vi.fn(async () => {}) };
    const metered = meterJournal(inner, svc);
    await metered.append({
      ...modelIdentity(),
      kind: 'model-response',
      response: response({
        metadata: { usageProvenance: 'partial', inputTokens: 10, outputTokens: -3 },
      }),
    });
    expect(svc.recorded[0]).toMatchObject({ tokens: { input: 10 } });
    expect((svc.recorded[0] as { tokens?: Record<string, unknown> }).tokens).not.toHaveProperty(
      'output',
    );
  });

  // Cache-hit admission-free: a cache hit costs nothing to serve, so the ledger accepts it
  // reported straight through, with no prior admission, as long as it carries its own identity —
  // this adapter must send that identity rather than spending a call-limit allowance for free.
  it('reports a cache hit without admission, appending before recording, carrying its own identity', async () => {
    const svc = services();
    const order: string[] = [];
    const inner: IExecutionJournal = {
      append: vi.fn(async () => {
        order.push('append');
      }),
    };
    const baseRecordUsage = svc.recordUsage.bind(svc);
    svc.recordUsage = vi.fn(async (report) => {
      order.push('record');
      await baseRecordUsage(report);
    });
    const metered = meterJournal(inner, svc);
    await metered.append({
      ...modelIdentity(),
      kind: 'model-cache-hit',
      response: response(),
    });
    expect(svc.admitModelCall).not.toHaveBeenCalled();
    expect(order).toEqual(['append', 'record']);
    expect(svc.recorded[0]).toMatchObject({
      callId: 'call-1',
      outcome: 'cache-hit',
      providerId: 'anthropic',
      modelId: 'claude',
    });
  });

  it('passes through record kinds it does not meter', async () => {
    const svc = services();
    const inner: IExecutionJournal = { append: vi.fn(async () => {}) };
    const metered = meterJournal(inner, svc);
    const toolIntent: TExecutionJournalRecord = {
      recordId: 'r2',
      executionId: 'exec-1',
      kind: 'tool-intent',
      actionId: 'a1',
      parentCallId: 'call-1',
      toolCallId: 'tc1',
      toolName: 'act',
      parameters: {},
    };
    await metered.append(toolIntent);
    expect(inner.append).toHaveBeenCalledWith(toolIntent);
    expect(svc.admitModelCall).not.toHaveBeenCalled();
    expect(svc.recordUsage).not.toHaveBeenCalled();
  });
});

describe('meterRecoverableJournal', () => {
  it('preserves read() while metering append()', async () => {
    const svc = services();
    const stored: TExecutionJournalRecord[] = [];
    const inner: IRecoverableExecutionJournal = {
      append: vi.fn(async (record: TExecutionJournalRecord) => {
        stored.push(record);
      }),
      read: vi.fn(async (executionId: string) =>
        stored.filter((record) => record.executionId === executionId),
      ),
    };
    const metered = meterRecoverableJournal(inner, svc);
    await metered.append(modelRequestRecord());
    await expect(metered.read('exec-1')).resolves.toEqual([modelRequestRecord()]);
    expect(svc.admitted).toHaveLength(1);
  });
});
