/**
 * NEUT-005 — compaction prompt neutrality tests.
 *
 * The compaction summarization prompt is the one model-facing prompt surface this package
 * owns. Its default base template must be domain-neutral (no software-development bias such
 * as "code changes and file paths" or "debugging steps"), and the base template must be
 * injectable so a consuming layer can replace it entirely.
 */

import { randomUUID } from 'node:crypto';

import { describe, expect, it } from 'vitest';

import { CompactionOrchestrator, DEFAULT_COMPACTION_PROMPT } from '../compaction-orchestrator.js';

import type { ICompactionOptions } from '../compaction-orchestrator.js';
import type { IAIProvider, TUniversalMessage } from '@robota-sdk/agent-core';

function createCapturingProvider(captured: string[]): IAIProvider {
  return {
    name: 'capturing',
    chat: async (messages: TUniversalMessage[]) => {
      captured.push(messages[0]?.content as string);
      return {
        id: randomUUID(),
        role: 'assistant' as const,
        content: 'summary',
        state: 'complete' as const,
        timestamp: new Date(),
      };
    },
  } as IAIProvider;
}

function createHistory(): TUniversalMessage[] {
  return [
    {
      id: randomUUID(),
      role: 'user',
      content: 'first user message',
      state: 'complete' as const,
      timestamp: new Date(),
    },
  ] as TUniversalMessage[];
}

function createOrchestrator(overrides: Partial<ICompactionOptions> = {}): CompactionOrchestrator {
  return new CompactionOrchestrator({
    sessionId: 'neut-005-test',
    cwd: process.cwd(),
    model: 'test-model',
    ...overrides,
  });
}

async function capturePrompt(overrides: Partial<ICompactionOptions> = {}): Promise<string> {
  const captured: string[] = [];
  const provider = createCapturingProvider(captured);
  await createOrchestrator(overrides).compact(provider, createHistory());
  expect(captured).toHaveLength(1);
  return captured[0] ?? '';
}

describe('compaction prompt neutrality (NEUT-005)', () => {
  it('default base template carries no software-development domain bias', async () => {
    const prompt = await capturePrompt();
    expect(prompt).not.toContain('code changes');
    expect(prompt).not.toContain('file paths');
    expect(prompt).not.toContain('debugging');
    // Generic essentials are still requested.
    expect(prompt).toContain('requests and goals');
    expect(prompt).toContain('next steps');
  });

  it('an injected base template fully replaces the default', async () => {
    const prompt = await capturePrompt({ basePrompt: 'CUSTOM BASE TEMPLATE' });
    expect(prompt).toContain('CUSTOM BASE TEMPLATE');
    expect(prompt).not.toContain(DEFAULT_COMPACTION_PROMPT.split('\n')[0] ?? '');
  });

  it('appends focus instructions and the conversation after the base template', async () => {
    const prompt = await capturePrompt({
      basePrompt: 'CUSTOM BASE TEMPLATE',
      compactInstructions: 'FOCUS ON X',
    });
    expect(prompt).toContain('CUSTOM BASE TEMPLATE');
    expect(prompt).toContain('FOCUS ON X');
    expect(prompt).toContain('user: first user message');
  });

  it('exports the default template so consuming layers can compose with it', () => {
    expect(DEFAULT_COMPACTION_PROMPT).toContain('Summarize the following conversation');
  });
});
