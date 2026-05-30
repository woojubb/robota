import { describe, it, expect } from 'vitest';
import { checkSameToolInputLimit } from './execution-round-tools';
import type { IExecutionRoundState } from './execution-types';

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

function makeToolCall(name: string, args: string) {
  return {
    id: `tc-${name}`,
    type: 'function' as const,
    function: { name, arguments: args },
  };
}

describe('checkSameToolInputLimit', () => {
  it('does not throw when count is within limit', () => {
    const state = makeRoundState();
    const call = makeToolCall('WebFetch', '{"url":"https://example.com"}');

    expect(() => checkSameToolInputLimit([call], state, 3)).not.toThrow();
    expect(() => checkSameToolInputLimit([call], state, 3)).not.toThrow();
    expect(() => checkSameToolInputLimit([call], state, 3)).not.toThrow();
    expect(state.sameToolInputCounts.get('WebFetch::{"url":"https://example.com"}')).toBe(3);
  });

  it('throws on the (limit + 1)th identical call', () => {
    const state = makeRoundState();
    const call = makeToolCall('WebFetch', '{"url":"https://example.com"}');

    checkSameToolInputLimit([call], state, 3);
    checkSameToolInputLimit([call], state, 3);
    checkSameToolInputLimit([call], state, 3);

    expect(() => checkSameToolInputLimit([call], state, 3)).toThrow(
      '[EXECUTION] Tool "WebFetch" called with identical input 4 times — aborting to prevent infinite loop',
    );
  });

  it('tracks different tools independently', () => {
    const state = makeRoundState();
    const a = makeToolCall('WebFetch', '{"url":"https://a.com"}');
    const b = makeToolCall('WebFetch', '{"url":"https://b.com"}');

    for (let i = 0; i < 3; i++) {
      checkSameToolInputLimit([a], state, 3);
      checkSameToolInputLimit([b], state, 3);
    }

    expect(() => checkSameToolInputLimit([a], state, 3)).toThrow('WebFetch');
    expect(() => checkSameToolInputLimit([b], state, 3)).toThrow('WebFetch');
  });

  it('does not interfere across different tool names', () => {
    const state = makeRoundState();
    const fetch = makeToolCall('WebFetch', '{"url":"https://x.com"}');
    const search = makeToolCall('WebSearch', '{"url":"https://x.com"}');

    for (let i = 0; i < 3; i++) {
      checkSameToolInputLimit([fetch], state, 3);
    }

    expect(() => checkSameToolInputLimit([search], state, 3)).not.toThrow();
  });
});
