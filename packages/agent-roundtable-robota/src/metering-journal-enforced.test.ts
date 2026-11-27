import { describe, expect, it, vi } from 'vitest';
import type {
  IExecutionJournal,
  IRecoverableExecutionJournal,
  TExecutionJournalRecord,
  TUniversalMessage,
} from '@robota-sdk/agent-core';
import type { ModelCallIntent, TurnServices, UsageReport } from '@robota-sdk/agent-roundtable';
import { requestBound } from './call-bound';
import { meterJournal, meterRecoverableJournal } from './metering-journal';
import type { RuntimeEnforcement } from './enforcement';

const enforcement: RuntimeEnforcement = {
  providerAttempts: 1,
  requestOverheadTokens: 4,
  freeTools: ['free'],
};

function services() {
  const admitted: ModelCallIntent[] = [];
  const recorded: UsageReport[] = [];
  const svc: TurnServices & { admitted: ModelCallIntent[]; recorded: UsageReport[] } = {
    admitted,
    recorded,
    admitModelCall: vi.fn(async (call: ModelCallIntent) => {
      admitted.push(call);
    }),
    recordUsage: vi.fn(async (report: UsageReport) => {
      recorded.push(report);
    }),
  };
  return svc;
}

function innerJournal() {
  const appended: TExecutionJournalRecord[] = [];
  const inner: IExecutionJournal = {
    append: vi.fn(async (record) => {
      appended.push(record);
    }),
  };
  return { inner, appended };
}

function identity() {
  return {
    recordId: 'r1',
    executionId: 'exec-1',
    callId: 'call-1',
    providerId: 'anthropic',
    modelId: 'claude',
  };
}

function modelRequest(
  options: Extract<TExecutionJournalRecord, { kind: 'model-request' }>['options'] = {
    maxTokens: 50,
  },
  messages: TUniversalMessage[] = [],
): Extract<TExecutionJournalRecord, { kind: 'model-request' }> {
  return { ...identity(), kind: 'model-request', messages, options };
}

function toolEffect(toolName: string): TExecutionJournalRecord {
  return {
    recordId: 'r2',
    executionId: 'exec-1',
    kind: 'tool-effect-start',
    actionId: 'a1',
    parentCallId: 'call-1',
    toolCallId: 'tc1',
    toolName,
    parameters: {},
  };
}

function response(metadata: Record<string, unknown> = {}): TUniversalMessage {
  return {
    id: 'resp-1',
    role: 'assistant',
    content: 'hi',
    state: 'complete',
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    metadata,
  } as TUniversalMessage;
}

const attested = { usageProvenance: 'complete', inputTokens: 12, outputTokens: 3 };

describe('meterJournal with enforcement', () => {
  it('admits a model-request with the bound taken from the request, before the inner journal', async () => {
    const svc = services();
    const { inner, appended } = innerJournal();
    const order: string[] = [];
    svc.admitModelCall = vi.fn(async (call) => {
      order.push('admit');
      svc.admitted.push(call);
    });
    vi.mocked(inner.append).mockImplementation(async (record) => {
      order.push('append');
      appended.push(record);
    });
    const record = modelRequest({ maxTokens: 50 }, [
      {
        id: 'm',
        role: 'user',
        content: 'hello',
        state: 'complete',
        timestamp: new Date(0),
      } as TUniversalMessage,
    ]);
    await meterJournal(inner, svc, enforcement).append(record);
    expect(order).toEqual(['admit', 'append']);
    expect(svc.admitted[0]?.bound).toEqual(requestBound(record, enforcement));
    expect(svc.admitted[0]?.bound?.maxOutputTokens).toBe(50);
  });

  it.each([
    ['no output cap', {}],
    ['a zero output cap', { maxTokens: 0 }],
    ['hosted web tools requested', { maxTokens: 5, nativeWebTools: { webSearch: true } }],
  ])('refuses %s before admission and before the inner journal', async (_label, options) => {
    const svc = services();
    const { inner } = innerJournal();
    await expect(
      meterJournal(inner, svc, enforcement).append(modelRequest(options)),
    ).rejects.toMatchObject({ code: 'unbounded-call' });
    expect(svc.admitModelCall).not.toHaveBeenCalled();
    expect(inner.append).not.toHaveBeenCalled();
  });

  it('refuses a non-text part and a bound beyond a safe integer', async () => {
    const svc = services();
    const { inner } = innerJournal();
    const image = {
      id: 'm',
      role: 'user',
      content: 'x',
      state: 'complete',
      timestamp: new Date(0),
      parts: [{ type: 'image_uri', uri: 'https://example.test/a.png' }],
    } as TUniversalMessage;
    await expect(
      meterJournal(inner, svc, enforcement).append(modelRequest({ maxTokens: 5 }, [image])),
    ).rejects.toMatchObject({ code: 'unbounded-call' });
    await expect(
      meterJournal(inner, svc, {
        ...enforcement,
        requestOverheadTokens: Number.MAX_SAFE_INTEGER,
      }).append(modelRequest({ maxTokens: 5 })),
    ).rejects.toMatchObject({ code: 'unbounded-call' });
    expect(svc.admitModelCall).not.toHaveBeenCalled();
    expect(inner.append).not.toHaveBeenCalled();
  });

  it('refuses a tool effect that is not declared free, and passes a declared one through', async () => {
    const svc = services();
    const { inner, appended } = innerJournal();
    const metered = meterJournal(inner, svc, enforcement);
    await expect(metered.append(toolEffect('mystery'))).rejects.toMatchObject({
      code: 'unbounded-call',
      message: expect.stringContaining('mystery'),
    });
    expect(appended).toHaveLength(0);
    await metered.append(toolEffect('free'));
    expect(appended).toHaveLength(1);
    expect(svc.admitModelCall).not.toHaveBeenCalled();
  });

  it('refuses a managed frame', async () => {
    const svc = services();
    const { inner } = innerJournal();
    const frame = { ...identity(), kind: 'managed-frame' } as unknown as TExecutionJournalRecord;
    await expect(meterJournal(inner, svc, enforcement).append(frame)).rejects.toMatchObject({
      code: 'unbounded-call',
    });
    expect(inner.append).not.toHaveBeenCalled();
  });

  it('leaves a cache hit admission-free', async () => {
    const svc = services();
    const { inner, appended } = innerJournal();
    await meterJournal(inner, svc, enforcement).append({
      ...identity(),
      kind: 'model-cache-hit',
      response: response(attested),
    });
    expect(svc.admitModelCall).not.toHaveBeenCalled();
    expect(appended).toHaveLength(1);
    expect(svc.recorded[0]).toMatchObject({ outcome: 'cache-hit' });
  });

  it('settles attested usage as reported with one attempt and partial with several', async () => {
    for (const [attempts, provenance] of [
      [1, 'reported'],
      [3, 'partial'],
    ] as const) {
      const svc = services();
      const { inner } = innerJournal();
      await meterJournal(inner, svc, { ...enforcement, providerAttempts: attempts }).append({
        ...identity(),
        kind: 'model-response',
        response: response(attested),
      });
      expect(svc.recorded[0]).toMatchObject({
        outcome: 'completed',
        provenance,
        tokens: { input: 12, output: 3 },
      });
    }
  });

  it('settles a response with no attested usage as unknown, keeping the bound', async () => {
    const svc = services();
    const { inner } = innerJournal();
    await meterJournal(inner, svc, enforcement).append({
      ...identity(),
      kind: 'model-response',
      response: response(),
    });
    expect(svc.recorded[0]).toMatchObject({ provenance: 'unknown' });
    expect(svc.recorded[0]?.tokens).toBeUndefined();
  });

  it('keeps today’s unbounded admission when no enforcement is given', async () => {
    const svc = services();
    const { inner } = innerJournal();
    await meterJournal(inner, svc).append(modelRequest({}));
    expect(svc.admitted[0]?.bound).toBeUndefined();
    await meterJournal(inner, svc).append(toolEffect('anything'));
  });

  it('validates the declaration when the journal is wrapped', () => {
    const { inner } = innerJournal();
    expect(() =>
      meterJournal(inner, services(), { providerAttempts: 0, requestOverheadTokens: 0 }),
    ).toThrow(expect.objectContaining({ code: 'invalid-config' }));
  });

  it('meters a recoverable journal the same way and passes read through', async () => {
    const svc = services();
    const appended: TExecutionJournalRecord[] = [];
    const inner: IRecoverableExecutionJournal = {
      append: async (record) => {
        appended.push(record);
      },
      read: vi.fn(async () => appended),
    };
    const metered = meterRecoverableJournal(inner, svc, enforcement);
    await metered.append(modelRequest({ maxTokens: 9 }));
    expect(svc.admitted[0]?.bound?.maxOutputTokens).toBe(9);
    await expect(metered.append(modelRequest({}))).rejects.toMatchObject({
      code: 'unbounded-call',
    });
    expect(await metered.read('exec-1')).toBe(appended);
  });
});
