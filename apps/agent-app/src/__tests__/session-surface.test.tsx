import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';

import { SessionSurface } from '@robota-sdk/agent-transport-gui/client';

import type { IWsSessionState } from '@robota-sdk/agent-transport-gui/client';

/**
 * GUI-005 TC-01/TC-02 — the desktop app renders a session over the GUI core's reducer state and answers
 * prompts, WITHOUT any session logic of its own (it only calls `send`/`answerPermission`/`answerAsk`). This
 * exercises the shared `SessionSurface` (agent-transport-gui) as the app mounts it.
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

  it('CMD-004 TC-05: a ui_intent notice renders VISIBLY and Dismiss removes it via the reducer', () => {
    const state = stubState({
      dismissUiIntentNotice: vi.fn(),
      uiIntentNotices: [
        {
          id: 'n1',
          intentType: 'show-settings',
          notice:
            'The settings screen is not available on this surface. Use the robota terminal on the host.',
        },
      ],
    } as unknown as Partial<IWsSessionState>);
    render(<SessionSurface state={state} />);
    // The explicit unsupported signal (never a silent drop) is user-visible …
    expect(screen.getByText(/settings screen is not available on this surface/i)).toBeTruthy();
    // … and dismissible through the reducer's handle.
    fireEvent.click(screen.getByLabelText('dismiss show-settings notice'));
    expect(
      (state as unknown as { dismissUiIntentNotice: ReturnType<typeof vi.fn> })
        .dismissUiIntentNotice,
    ).toHaveBeenCalledWith('n1');
  });
});
