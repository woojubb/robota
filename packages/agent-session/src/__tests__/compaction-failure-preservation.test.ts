/**
 * CORE-019 — Compaction Failure Contract tests.
 *
 * An invalid summary (non-string or empty/whitespace provider content) must throw
 * CompactionError BEFORE clearHistory() runs: the conversation history is append-only
 * source data and must survive a failed compaction untouched. The previous behavior
 * replaced the entire history with a '(compaction failed)' marker — data corruption.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CompactionError, CompactionOrchestrator } from '../compaction-orchestrator.js';

import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';

function createProviderReturning(content: unknown): IAIProvider {
  return {
    name: 'fault-injected',
    chat: async () => ({
      id: randomUUID(),
      role: 'assistant' as const,
      content: content as string,
      state: 'complete' as const,
      timestamp: new Date(),
    }),
  } as IAIProvider;
}

function createHistory(): TUniversalMessage[] {
  return [
    {
      id: randomUUID(),
      role: 'user',
      content: 'important original message',
      state: 'complete' as const,
      timestamp: new Date(),
    },
  ] as TUniversalMessage[];
}

function createOrchestrator(): CompactionOrchestrator {
  return new CompactionOrchestrator({
    sessionId: 'core-019-test',
    cwd: process.cwd(),
    model: 'test-model',
  });
}

describe('compaction failure contract (CORE-019)', () => {
  it('throws CompactionError when the provider returns non-string content', async () => {
    const orchestrator = createOrchestrator();
    const provider = createProviderReturning([{ type: 'tool_use' }]);

    await expect(orchestrator.compact(provider, createHistory())).rejects.toBeInstanceOf(
      CompactionError,
    );
  });

  it('throws CompactionError when the provider returns an empty summary', async () => {
    const orchestrator = createOrchestrator();

    await expect(
      createOrchestrator().compact(createProviderReturning(''), createHistory()),
    ).rejects.toBeInstanceOf(CompactionError);
    await expect(
      orchestrator.compact(createProviderReturning('   \n '), createHistory()),
    ).rejects.toBeInstanceOf(CompactionError);
  });

  it('never substitutes a placeholder marker for a failed summary', async () => {
    const orchestrator = createOrchestrator();
    const provider = createProviderReturning(null);

    await expect(orchestrator.compact(provider, createHistory())).rejects.toThrow(/summary/i);
  });

  it('returns the summary unchanged when the provider yields a valid string', async () => {
    const orchestrator = createOrchestrator();
    const provider = createProviderReturning('a valid summary');

    await expect(orchestrator.compact(provider, createHistory())).resolves.toBe('a valid summary');
  });
});
