import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SessionSurface } from '../App.js';

import type { IWsSessionState } from '@robota-sdk/agent-web-ui/client';

/**
 * GUI-002 TC-01/TC-02 — the compose-root renders a session over agent-web-ui's reducer state and answers
 * prompts, WITHOUT any session logic of its own (it only calls `send`/`answerPermission`/`answerAsk`).
 */

function stubState(over: Partial<IWsSessionState> = {}): IWsSessionState {
  return {
    status: 'connected',
    messages: [{ id: 'm1', role: 'user', content: 'hello' }],
    activeTools: [],
    streamingText: '',
    isThinking: false,
    executionWorkspace: null,
    pendingPrompts: [],
    send: vi.fn(),
    answerPermission: vi.fn(),
    answerAsk: vi.fn(),
    ...over,
  } as unknown as IWsSessionState;
}

describe('SessionSurface (GUI-002 TC-01/TC-02)', () => {
  it('TC-01: renders the conversation + status from the reducer state', () => {
    render(<SessionSurface state={stubState()} />);
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.getByText('connected')).toBeTruthy();
  });

  it('TC-01: submitting the composer calls send({type:submit}) and clears the draft', () => {
    const state = stubState();
    render(<SessionSurface state={state} />);
    const input = screen.getByLabelText('message') as HTMLInputElement;
    fireEvent.change(input, { target: { value: 'do a thing' } });
    fireEvent.click(screen.getByText('Send'));
    expect(state.send).toHaveBeenCalledWith({ type: 'submit', prompt: 'do a thing' });
    expect(input.value).toBe('');
  });

  it('TC-01: an empty/whitespace draft does not submit', () => {
    const state = stubState();
    render(<SessionSurface state={state} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '   ' } });
    fireEvent.click(screen.getByText('Send'));
    expect(state.send).not.toHaveBeenCalled();
  });

  it('TC-02: a pending permission prompt renders and Allow answers it via answerPermission', () => {
    const state = stubState({
      pendingPrompts: [
        { kind: 'permission', id: 'p1', toolName: 'write_file', toolArgs: { path: 'x' } },
      ] as unknown as IWsSessionState['pendingPrompts'],
    });
    render(<SessionSurface state={state} />);
    expect(screen.getByText(/permission request/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Allow'));
    expect(state.answerPermission).toHaveBeenCalledWith('p1', true);
  });
});
