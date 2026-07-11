import { describe, expect, it } from 'vitest';

import {
  applyPromptEvent,
  askResponse,
  permissionResponse,
  type TPendingPrompt,
} from '../prompt-state.js';

import type { TServerMessage } from '@robota-sdk/agent-transport-protocol';

/**
 * REMOTE-009 Step 4 / REMOTE-007 render+answer — the pure prompt-state list transitions + answer builders.
 * Shared by the WS and RTC clients (same TServerMessages), so testing the pure logic covers both.
 */

const permReq: TServerMessage = {
  type: 'permission_request',
  event: { id: 'p1', toolName: 'Bash', toolArgs: { command: 'ls' } },
};
const askReq: TServerMessage = {
  type: 'ask_request',
  event: { id: 'a1', request: { id: 'r', title: 'Pick' } },
};

describe('applyPromptEvent (REMOTE-007 web render)', () => {
  it('appends a permission prompt on permission_request', () => {
    const next = applyPromptEvent([], permReq);
    expect(next).toEqual([
      { kind: 'permission', id: 'p1', toolName: 'Bash', toolArgs: { command: 'ls' } },
    ]);
  });

  it('appends an ask prompt on ask_request', () => {
    const next = applyPromptEvent([], askReq);
    expect(next).toEqual([{ kind: 'ask', id: 'a1', request: { id: 'r', title: 'Pick' } }]);
  });

  it('removes the prompt on prompt_resolved (co-drive dismiss)', () => {
    const withPrompt = applyPromptEvent([], permReq);
    const resolved: TServerMessage = { type: 'prompt_resolved', event: { id: 'p1' } };
    expect(applyPromptEvent(withPrompt, resolved)).toEqual([]);
  });

  it('is idempotent against a duplicate request id', () => {
    const once = applyPromptEvent([], permReq);
    expect(applyPromptEvent(once, permReq)).toBe(once); // same ref, not re-appended
  });

  it('preserves referential equality for unrelated messages and unknown resolve ids', () => {
    const prompts: readonly TPendingPrompt[] = applyPromptEvent([], permReq);
    expect(
      applyPromptEvent(prompts, { type: 'thinking', isThinking: true } as TServerMessage),
    ).toBe(prompts);
    expect(applyPromptEvent(prompts, { type: 'prompt_resolved', event: { id: 'nope' } })).toBe(
      prompts,
    );
  });

  it('builds the answer client messages', () => {
    expect(permissionResponse('p1', true)).toEqual({
      type: 'permission-response',
      id: 'p1',
      result: true,
    });
    expect(askResponse('a1', { type: 'answer', values: ['x'] })).toEqual({
      type: 'ask-response',
      id: 'a1',
      response: { type: 'answer', values: ['x'] },
    });
  });
});
