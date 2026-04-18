import { randomUUID } from 'node:crypto';
import { describe, it, expect } from 'vitest';
import {
  buildConversationStartData,
  buildConversationCompleteData,
  buildToolBeforeData,
  buildToolAfterBaseData,
  validateEventEmitterOptions,
} from '../event-emitter-helpers';
import type { TUniversalMessage } from '@robota-sdk/agent-core';

const baseCtx = {
  executionId: 'eid',
  sessionId: 'sid',
  userId: 'uid',
  messages: [] as TUniversalMessage[],
};

function makeUserMsg(content: string, timestamp?: Date): TUniversalMessage {
  return {
    id: randomUUID(),
    role: 'user',
    content,
    state: 'complete',
    timestamp: timestamp ?? new Date(),
  };
}

describe('buildConversationStartData', () => {
  it('maps context fields and empty messages', () => {
    const result = buildConversationStartData(baseCtx);
    expect(result.executionId).toBe('eid');
    expect(result.sessionId).toBe('sid');
    expect((result.data as Record<string, unknown>)?.messages).toEqual([]);
  });

  it('maps messages with timestamp', () => {
    const ts = new Date('2024-01-01T00:00:00Z');
    const ctx = { ...baseCtx, messages: [makeUserMsg('hi', ts)] };
    const result = buildConversationStartData(ctx);
    const msgs = (result.data as Record<string, unknown>)?.messages as unknown[];
    expect(msgs).toHaveLength(1);
    expect((msgs[0] as Record<string, unknown>).content).toBe('hi');
    expect((msgs[0] as Record<string, unknown>).timestamp).toBe(ts.toISOString());
  });

  it('uses current time when message has no timestamp', () => {
    const msg = makeUserMsg('hi');
    // remove timestamp to simulate missing field
    const msgWithoutTs = { ...msg, timestamp: undefined } as unknown as TUniversalMessage;
    const ctx = { ...baseCtx, messages: [msgWithoutTs] };
    const result = buildConversationStartData(ctx);
    const msgs = (result.data as Record<string, unknown>)?.messages as unknown[];
    expect(typeof (msgs[0] as Record<string, unknown>).timestamp).toBe('string');
  });
});

describe('buildConversationCompleteData', () => {
  it('maps result fields', () => {
    const result = buildConversationCompleteData(baseCtx, {
      content: 'answer',
      usage: { totalTokens: 42 },
      toolCalls: [{ id: 't1', name: 'tool', arguments: { x: 1 }, result: 'ok' }],
    });
    const data = result.data as Record<string, unknown>;
    expect(data?.response).toBe('answer');
    expect(data?.tokensUsed).toBe(42);
    expect((data?.toolCalls as unknown[]).length).toBe(1);
  });

  it('falls back to tokensUsed when usage absent', () => {
    const result = buildConversationCompleteData(baseCtx, { tokensUsed: 7 });
    expect((result.data as Record<string, unknown>)?.tokensUsed).toBe(7);
  });
});

describe('buildToolBeforeData', () => {
  it('maps tool context', () => {
    const result = buildToolBeforeData(baseCtx, {
      toolName: 'myTool',
      executionId: 'tid',
      parameters: { a: 1 },
    });
    const data = result.data as Record<string, unknown>;
    expect(data?.toolName).toBe('myTool');
    expect(data?.arguments).toBe(JSON.stringify({ a: 1 }));
  });
});

describe('buildToolAfterBaseData', () => {
  it('includes toolResult when result is present', () => {
    const result = buildToolAfterBaseData(baseCtx, { name: 't', id: 'i', result: 'val' }, 100);
    const data = result.data as Record<string, unknown>;
    expect(data?.toolResult).toBe('val');
    expect(data?.duration).toBe(100);
    expect(data?.success).toBe(true);
  });

  it('omits toolResult when result is null', () => {
    const result = buildToolAfterBaseData(baseCtx, { name: 't', id: 'i', result: null });
    const data = result.data as Record<string, unknown>;
    expect(data?.toolResult).toBeUndefined();
    expect(data?.success).toBe(false);
  });
});

describe('validateEventEmitterOptions', () => {
  it('throws on negative maxListeners', () => {
    expect(() => validateEventEmitterOptions({ maxListeners: -1 }, 'P')).toThrow('maxListeners');
  });

  it('throws on negative buffer.maxSize', () => {
    expect(() =>
      validateEventEmitterOptions(
        { buffer: { enabled: true, maxSize: -1, flushInterval: 100 } },
        'P',
      ),
    ).toThrow('maxSize');
  });

  it('throws on negative buffer.flushInterval', () => {
    expect(() =>
      validateEventEmitterOptions(
        { buffer: { enabled: true, maxSize: 10, flushInterval: -1 } },
        'P',
      ),
    ).toThrow('flushInterval');
  });

  it('passes with valid options', () => {
    expect(() => validateEventEmitterOptions({ maxListeners: 10 }, 'P')).not.toThrow();
  });
});
