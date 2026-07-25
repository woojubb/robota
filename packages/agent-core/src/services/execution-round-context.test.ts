import { describe, expect, it, vi } from 'vitest';

import { handleContextCapacityBlock } from './execution-round-context';

import type { IExecutionRoundState } from './execution-types';
import type { IAgentConfig } from '../interfaces/agent';
import type { TUniversalMessage } from '../interfaces/messages';
import type { IAIProvider } from '../interfaces/provider';
import type { ConversationStore } from '../managers/conversation-history-manager';
import type { ILogger } from '../utils/logger';

const NOW = new Date('2026-01-01T00:00:00Z');

function userMessage(content: string): TUniversalMessage {
  return { id: 'm1', role: 'user', content, state: 'complete', timestamp: NOW };
}

function makeConfig(overrides: Partial<IAgentConfig> = {}): IAgentConfig {
  return {
    name: 'test-agent',
    aiProviders: [{ name: 'mock-provider' } as IAIProvider],
    defaultModel: { provider: 'mock-provider', model: 'claude-haiku-4-5' },
    ...overrides,
  };
}

function makeRoundState(): IExecutionRoundState {
  return {
    toolsExecuted: [],
    currentRound: 1,
    runningAssistantCount: 0,
    lastTrackedAssistantMessage: undefined,
    cumulativeInputTokens: 0,
    consecutiveUnknownToolFailureRounds: 0,
    sameToolInputCounts: new Map(),
  };
}

const logger = {
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
  error: vi.fn(),
  log: vi.fn(),
} as unknown as ILogger;

function runCapacityBlock(config: IAgentConfig): string {
  const addAssistantMessage = vi.fn();
  const store = { addAssistantMessage } as unknown as ConversationStore;
  // 780k chars ≈ 195k tokens > 95% of the 200k window — forces the hard block.
  const blocked = handleContextCapacityBlock(
    [userMessage('x'.repeat(780_000))],
    config,
    makeRoundState(),
    store,
    logger,
    1,
  );
  expect(blocked).toBe(true);
  expect(addAssistantMessage).toHaveBeenCalledTimes(1);
  return addAssistantMessage.mock.calls[0]?.[0] as string;
}

describe('handleContextCapacityBlock — capacity notice neutrality', () => {
  it('emits a product-neutral notice with no slash-command vocabulary by default', () => {
    const notice = runCapacityBlock(makeConfig());
    expect(notice).toContain('Context window is near capacity');
    expect(notice).not.toContain('/compact');
    expect(notice).toContain('Reduce the conversation history');
  });

  it('uses an injected capacity hint when the config provides one', () => {
    const notice = runCapacityBlock(makeConfig({ contextCapacityHint: 'Run /compact and retry.' }));
    expect(notice).toContain('Run /compact and retry.');
    expect(notice).not.toContain('Reduce the conversation history');
  });
});
