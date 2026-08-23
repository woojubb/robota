import { describe, expect, it } from 'vitest';

import {
  readAssistantReplies,
  readErrors,
  readLastAssistantText,
  readToolCalls,
} from '../index.js';

import type { InteractionEvent } from '../index.js';

/**
 * INFRA-020 TC-01: the shared pure accessors over an InteractionEvent stream. These are the single
 * home for "what counts as a reply / tool call / error"; every IAgentDriver implementer delegates here.
 */
describe('interaction-event accessors (INFRA-020)', () => {
  const err = new Error('boom');
  const events: InteractionEvent[] = [
    { type: 'user-message', text: 'hi' },
    { type: 'assistant-chunk', chunk: 'par' },
    { type: 'assistant-chunk', chunk: 'tial' },
    { type: 'tool-call', id: 't1', name: 'Bash', args: { command: 'ls' } },
    { type: 'tool-result', id: 't1', name: 'Bash', result: 'ok' },
    { type: 'assistant-done', fullText: 'first reply' },
    { type: 'user-message', text: 'again' },
    { type: 'error', error: err },
    { type: 'assistant-done', fullText: 'second reply' },
  ];

  it('readAssistantReplies returns completed replies in order', () => {
    expect(readAssistantReplies(events)).toEqual(['first reply', 'second reply']);
  });

  it('readLastAssistantText returns the most recent reply', () => {
    expect(readLastAssistantText(events)).toBe('second reply');
    expect(readLastAssistantText([])).toBeUndefined();
  });

  it('readToolCalls returns tool-call observations', () => {
    expect(readToolCalls(events)).toEqual([{ id: 't1', name: 'Bash', args: { command: 'ls' } }]);
  });

  it('readErrors returns surfaced errors', () => {
    expect(readErrors(events)).toEqual([err]);
  });

  it('accessors are pure (do not mutate the input)', () => {
    const snapshot = [...events];
    readAssistantReplies(events);
    readToolCalls(events);
    readErrors(events);
    expect(events).toEqual(snapshot);
  });
});
