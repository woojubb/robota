import { describe, expect, it } from 'vitest';
import type { TUniversalMessage } from '../interfaces/messages.js';
import {
  estimateContextTokensFromMessages,
  estimateSerializedContextTokens,
} from './estimation.js';

const NOW = new Date('2026-05-05T00:00:00.000Z');

function userMessage(content: string): TUniversalMessage {
  return {
    id: `user-${content.length}`,
    role: 'user',
    content,
    state: 'complete',
    timestamp: NOW,
  };
}

function assistantMessage(inputTokens: number, outputTokens: number): TUniversalMessage {
  return {
    id: `assistant-${inputTokens}-${outputTokens}`,
    role: 'assistant',
    content: 'ok',
    state: 'complete',
    timestamp: NOW,
    metadata: { inputTokens, outputTokens },
  };
}

describe('context token estimation', () => {
  it('keeps 80k / 200k serialized usage below the hard-block band', () => {
    const messages = [userMessage('x'.repeat(320_000))];

    const estimate = estimateContextTokensFromMessages(messages);

    expect(estimate.usedTokens).toBeGreaterThanOrEqual(80_000);
    expect(estimate.usedTokens).toBeLessThan(90_000);
  });

  it('uses latest provider usage instead of summing historical full-request usage', () => {
    const messages = [assistantMessage(30_000, 2_000), assistantMessage(50_000, 3_000)];

    const estimate = estimateContextTokensFromMessages(messages);

    expect(estimate.providerTokens).toBe(53_000);
    expect(estimate.usedTokens).toBe(53_000);
  });

  it('uses terminal provider usage as exact post-response state', () => {
    const messages = [userMessage('x'.repeat(320_000)), assistantMessage(10, 5)];

    const estimate = estimateContextTokensFromMessages(messages);

    expect(estimate.serializedTokens).toBeGreaterThan(80_000);
    expect(estimate.providerTokens).toBe(15);
    expect(estimate.usedTokens).toBe(15);
  });

  it('does not let provider metadata hide a larger metadata-free prompt estimate', () => {
    const messages = [assistantMessage(1_000, 100), userMessage('x'.repeat(320_000))];

    const estimate = estimateContextTokensFromMessages(messages);

    expect(estimate.providerTokens).toBe(1_100);
    expect(estimate.usedTokens).toBeGreaterThanOrEqual(80_000);
  });

  it('can use a caller-provided usage floor when it exceeds the serialized estimate', () => {
    const estimate = estimateContextTokensFromMessages([userMessage('short')], {
      usageFloorTokens: 120_000,
    });

    expect(estimate.usedTokens).toBe(120_000);
    expect(estimate.usageFloorTokens).toBe(120_000);
  });

  it('rounds serialized context estimates up to the next token', () => {
    expect(estimateSerializedContextTokens([userMessage('a')])).toBeGreaterThan(0);
  });
});
