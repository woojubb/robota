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
    personalUsageStatus: 'idle',
    personalUsageReport: null,
    personalUsageError: null,
    requestPersonalUsage: vi.fn(),
    storedSessionUsageStatus: 'idle',
    storedSessionUsageReport: null,
    storedSessionUsageSessionId: null,
    storedSessionUsageError: null,
    requestStoredSessionUsage: vi.fn(),
    currentSessionUsageStatus: 'idle',
    currentSessionUsageReport: null,
    requestCurrentSessionUsage: vi.fn(),
    sessionNotices: [],
    dismissSessionNotice: vi.fn(),
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
    expect(screen.queryByRole('button', { name: 'Usage' })).toBeNull();
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

  it('ARCH-2164: routes slash input to the command wire path', () => {
    const state = stubState();
    render(<SessionSurface state={state} />);
    fireEvent.change(screen.getByLabelText('message'), { target: { value: '/help providers' } });
    fireEvent.click(screen.getByText('Send'));
    expect(state.send).toHaveBeenCalledWith({
      type: 'command',
      name: 'help',
      args: 'providers',
    });
  });

  it('ARCH-2164: renders command results and session errors as dismissible notices', () => {
    const state = stubState({
      sessionNotices: [
        { id: 'command', kind: 'command-result', message: '/help: available', success: true },
        { id: 'error', kind: 'session-error', message: 'Provider failed' },
      ],
    });
    render(<SessionSurface state={state} />);

    expect(screen.getByText('/help: available')).toBeTruthy();
    expect(screen.getByText('Provider failed')).toBeTruthy();
    fireEvent.click(screen.getAllByRole('button', { name: 'Dismiss notice' })[0]!);
    expect(state.dismissSessionNotice).toHaveBeenCalledWith('command');
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

  it('SCREEN-2577: opens Usage, requests 7d, and renders totals plus model breakdown', () => {
    const report: NonNullable<IWsSessionState['personalUsageReport']> = {
      schemaVersion: 1,
      generatedAt: '2026-09-06T03:00:00.000Z',
      period: '7d',
      timezone: 'Asia/Seoul',
      interval: { startDate: '2026-08-31', endDate: '2026-09-06' },
      totals: {
        sessions: 3,
        turns: 12,
        promptTokens: 900,
        completionTokens: 300,
        totalTokens: 1200,
        costUsd: 0.42,
        costStatus: 'exact',
      },
      daily: [
        {
          date: '2026-09-06',
          partial: true,
          sessionIds: ['a'],
          totals: {
            sessions: 1,
            turns: 2,
            promptTokens: 90,
            completionTokens: 30,
            totalTokens: 120,
            costUsd: 0.04,
            costStatus: 'exact',
          },
        },
      ],
      byModel: [
        {
          key: 'gpt-test',
          label: 'gpt-test',
          turns: 12,
          promptTokens: 900,
          completionTokens: 300,
          totalTokens: 1200,
          costUsd: 0.42,
          costStatus: 'exact',
          sessionIds: ['a', 'b', 'c'],
        },
      ],
      byProvider: [],
      bySurface: [],
      bySource: [],
      byActivity: [],
      sessionIds: ['a', 'b', 'c'],
      coverage: {
        validSessions: 3,
        corruptSessions: 0,
        unsupportedSessions: 0,
        duplicateObservations: 0,
        legacyObservations: 0,
        unknownModelObservations: 0,
        unknownProviderObservations: 0,
        unknownSurfaceObservations: 0,
        corruptSessionIds: [],
        unsupportedSessionIds: [],
      },
    };
    const state = stubState({
      personalUsageStatus: 'ready',
      personalUsageReport: report,
      requestPersonalUsage: vi.fn(),
    });

    render(<SessionSurface state={state} personalUsageEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));

    expect(state.requestPersonalUsage).toHaveBeenCalledWith('7d');
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(screen.getByText('gpt-test')).toBeTruthy();
    expect(screen.getByText(/partial day/i)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Open session a' }));
    expect(state.requestStoredSessionUsage).toHaveBeenCalledWith('a');
  });

  it('SCREEN-2577: renders explicit report errors', () => {
    render(
      <SessionSurface
        state={stubState({
          personalUsageStatus: 'error',
          personalUsageError: 'Local session store is unavailable.',
        })}
        personalUsageEnabled
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(screen.getByText('Local session store is unavailable.')).toBeTruthy();
  });

  it('SCREEN-2577: renders a deliberate empty state', () => {
    const emptyReport = {
      schemaVersion: 1,
      generatedAt: '2026-09-06T03:00:00.000Z',
      period: '7d',
      timezone: 'UTC',
      interval: { startDate: '2026-08-31', endDate: '2026-09-06' },
      totals: {
        sessions: 0,
        turns: 0,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
        costUsd: 0,
        costStatus: 'unknown',
      },
      daily: [],
      byModel: [],
      byProvider: [],
      bySurface: [],
      bySource: [],
      byActivity: [],
      sessionIds: [],
      coverage: {
        validSessions: 0,
        corruptSessions: 0,
        unsupportedSessions: 0,
        duplicateObservations: 0,
        legacyObservations: 0,
        unknownModelObservations: 0,
        unknownProviderObservations: 0,
        unknownSurfaceObservations: 0,
        corruptSessionIds: [],
        unsupportedSessionIds: [],
      },
    } as NonNullable<IWsSessionState['personalUsageReport']>;
    render(
      <SessionSurface
        state={stubState({ personalUsageStatus: 'ready', personalUsageReport: emptyReport })}
        personalUsageEnabled
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(screen.getByText('No recorded usage in this period.')).toBeTruthy();
  });
});
