import { describe, expect, it } from 'vitest';
import type { TExecutionJournalRecord, TUniversalMessage } from '@robota-sdk/agent-core';
import { requestBound } from './call-bound';

type ModelRequestRecord = Extract<TExecutionJournalRecord, { kind: 'model-request' }>;

const policy = { providerAttempts: 1, requestOverheadTokens: 0 };

function userMessage(content: string, extra: Partial<TUniversalMessage> = {}): TUniversalMessage {
  return {
    id: 'm1',
    role: 'user',
    content,
    state: 'complete',
    timestamp: new Date('2024-01-01T00:00:00.000Z'),
    ...extra,
  } as TUniversalMessage;
}

function record(
  options: ModelRequestRecord['options'] = { maxTokens: 100 },
  messages: TUniversalMessage[] = [userMessage('hello')],
): ModelRequestRecord {
  return {
    kind: 'model-request',
    recordId: 'r1',
    executionId: 'e1',
    callId: 'c1',
    providerId: 'p',
    modelId: 'm',
    messages,
    options,
  };
}

function encodedBytes(rec: ModelRequestRecord): number {
  return new TextEncoder().encode(
    JSON.stringify([
      rec.messages,
      rec.options.tools ?? [],
      rec.options.responseFormat ?? null,
      rec.options.toolChoice ?? null,
    ]),
  ).length;
}

describe('requestBound', () => {
  it('takes the input from the encoded request and the output from its cap, with exactly two keys', () => {
    const rec = record();
    const bound = requestBound(rec, policy);
    expect(bound).toEqual({ inputTokens: encodedBytes(rec), maxOutputTokens: 100 });
    expect(Object.keys(bound).sort()).toEqual(['inputTokens', 'maxOutputTokens']);
  });

  it('multiplies both sides by the provider attempts and adds the overhead before multiplying', () => {
    const rec = record();
    const bound = requestBound(rec, { providerAttempts: 3, requestOverheadTokens: 7 });
    expect(bound.inputTokens).toBe((encodedBytes(rec) + 7) * 3);
    expect(bound.maxOutputTokens).toBe(300);
  });

  it('counts UTF-8 bytes, not characters', () => {
    const ascii = requestBound(record({ maxTokens: 10 }, [userMessage('a')]), policy);
    const wide = requestBound(record({ maxTokens: 10 }, [userMessage('\u{1F600}')]), policy);
    expect(wide.inputTokens - ascii.inputTokens).toBe(3);
  });

  it('counts tools, response format and tool choice as request input', () => {
    const bare = requestBound(record(), policy).inputTokens;
    const tools: NonNullable<ModelRequestRecord['options']['tools']> = [
      {
        name: 'act',
        description: 'does a thing',
        parameters: { type: 'object', properties: {} },
      },
    ];
    expect(requestBound(record({ maxTokens: 100, tools }), policy).inputTokens).toBeGreaterThan(
      bare,
    );
    expect(
      requestBound(record({ maxTokens: 100, responseFormat: { type: 'json_object' } }), policy)
        .inputTokens,
    ).toBeGreaterThan(bare);
    expect(
      requestBound(record({ maxTokens: 100, toolChoice: 'none' }), policy).inputTokens,
    ).toBeGreaterThan(bare);
  });

  it.each([undefined, 0, -5, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 2])(
    'refuses a request whose output cap is %s',
    (maxTokens) => {
      const options = maxTokens === undefined ? {} : { maxTokens };
      expect(() => requestBound(record(options), policy)).toThrow(
        expect.objectContaining({ code: 'unbounded-call' }),
      );
    },
  );

  it('refuses a message carrying a non-text part', () => {
    const rec = record({ maxTokens: 10 }, [
      userMessage('look', { parts: [{ type: 'image_uri', uri: 'https://example.test/a.png' }] }),
    ]);
    expect(() => requestBound(rec, policy)).toThrow(
      expect.objectContaining({ code: 'unbounded-call' }),
    );
  });

  it('admits a message whose parts are all text', () => {
    const rec = record({ maxTokens: 10 }, [
      userMessage('look', { parts: [{ type: 'text', text: 'look' }] }),
    ]);
    expect(() => requestBound(rec, policy)).not.toThrow();
  });

  it.each([{ webSearch: true }, { webFetch: true }])(
    'refuses a request that asks for hosted web tools: %j',
    (nativeWebTools) => {
      expect(() => requestBound(record({ maxTokens: 10, nativeWebTools }), policy)).toThrow(
        expect.objectContaining({ code: 'unbounded-call' }),
      );
    },
  );

  it('admits a request that withholds hosted web tools', () => {
    expect(() =>
      requestBound(
        record({ maxTokens: 10, nativeWebTools: { webSearch: false, webFetch: false } }),
        policy,
      ),
    ).not.toThrow();
  });

  it('refuses a bound beyond a safe integer rather than rounding it', () => {
    expect(() =>
      requestBound(record(), {
        providerAttempts: 1,
        requestOverheadTokens: Number.MAX_SAFE_INTEGER,
      }),
    ).toThrow(expect.objectContaining({ code: 'unbounded-call' }));
    expect(() =>
      requestBound(record({ maxTokens: Number.MAX_SAFE_INTEGER }), {
        providerAttempts: 2,
        requestOverheadTokens: 0,
      }),
    ).toThrow(expect.objectContaining({ code: 'unbounded-call' }));
    expect(() => requestBound(record({ maxTokens: Number.MAX_SAFE_INTEGER - 5 }), policy)).toThrow(
      expect.objectContaining({ code: 'unbounded-call' }),
    );
  });
});
