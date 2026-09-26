// @vitest-environment jsdom
import { act, render, screen, fireEvent, cleanup, within } from '@testing-library/react';
import { afterEach, describe, it, expect, vi } from 'vitest';

import { SessionSurface } from '@robota-sdk/agent-ui-web/client';

import type { IWsSessionState } from '@robota-sdk/agent-ui-web/client';

/**
 * GUI-005 TC-01/TC-02 — the GUI web app renders a session over the GUI core's reducer state and answers
 * prompts, WITHOUT any session logic of its own (it only calls `send`/`answerPermission`/`answerAsk`). This
 * exercises the shared `SessionSurface` (agent-ui-web) as the app mounts it.
 */

// jsdom has no layout; the conversation's auto-scroll calls this.
Element.prototype.scrollIntoView = () => undefined;
afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

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
    sessionListing: null,
    sessionsError: null,
    requestSessions: vi.fn(),
    switchSession: vi.fn(),
    newSession: vi.fn(),
    sessionSidebarOpen: true,
    setSessionSidebarOpen: vi.fn(),
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

  it('#3186: a command result is a card in the conversation, line breaks kept, long output folded', () => {
    const content = Array.from({ length: 20 }, (_, i) => `line ${i + 1}`).join('\n');
    render(
      <SessionSurface
        state={stubState({
          messages: [{ id: 'c1', role: 'command', name: 'help', content, tone: 'success' }],
        })}
      />,
    );
    const card = screen.getByTestId('command-output');
    expect(card.textContent).toContain('/help');
    expect(card.textContent).toContain('line 12');
    expect(card.textContent).not.toContain('line 13');
    fireEvent.click(screen.getByRole('button', { name: 'Show all 20 lines' }));
    expect(card.textContent).toContain('line 20');
    expect(card.querySelector('pre')?.className).toContain('whitespace-pre-wrap');
  });

  it('#3186: a session error is a dismissible toast', () => {
    const state = stubState({
      sessionNotices: [{ id: 'error', kind: 'session-error', message: 'Provider failed' }],
    });
    render(<SessionSurface state={state} />);
    expect(screen.getByRole('alert').textContent).toContain('Provider failed');
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss notice' }));
    expect(state.dismissSessionNotice).toHaveBeenCalledWith('error');
  });

  it('#3186: a finished turn shows its tool calls as one line that opens on click', () => {
    render(
      <SessionSurface
        state={stubState({
          messages: [
            {
              id: 't1',
              role: 'tools',
              tools: [
                { id: 'a', name: 'Read', status: 'done', input: 'a.ts' },
                { id: 'b', name: 'Edit', status: 'error' },
              ],
            },
          ],
        })}
      />,
    );
    const summary = screen.getByRole('button', { name: /2 tool calls/ });
    expect(summary.textContent).toContain('1 failed');
    expect(screen.queryByText('a.ts')).toBeNull();
    fireEvent.click(summary);
    expect(screen.getByText('a.ts')).toBeTruthy();
  });

  it('#3186: the activity rail stays closed while only the main thread exists', () => {
    const mainOnly = {
      entries: [{ id: 'main', kind: 'main_thread', title: 'Main thread' }],
    } as unknown as IWsSessionState['executionWorkspace'];
    const { rerender } = render(<SessionSurface state={stubState({ executionWorkspace: mainOnly })} />);
    expect(screen.queryByText('Main thread')).toBeNull();
    const withTask = {
      entries: [
        { id: 'main', kind: 'main_thread', title: 'Main thread' },
        { id: 't', kind: 'background_task', title: 'Build', status: 'running', controls: [] },
      ],
    } as unknown as IWsSessionState['executionWorkspace'];
    rerender(<SessionSurface state={stubState({ executionWorkspace: withTask })} />);
    expect(screen.getByText('Build')).toBeTruthy();
  });

  it('#3186: typing / opens the command menu; Enter completes, Enter again runs it', () => {
    const state = stubState({
      commandCatalog: {
        commands: [
          { name: 'help', description: 'Show commands', modelInvocable: false, runner: 'runtime' },
          { name: 'mode', description: 'Change the permission mode', modelInvocable: false, runner: 'runtime' },
        ],
        skills: [
          { name: 'parity-demo', description: 'Demo skill', source: 'project', modelInvocable: true, userInvocable: true },
        ],
      },
    } as Partial<IWsSessionState>);
    render(<SessionSurface state={state} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/' } });
    const menu = screen.getByRole('listbox', { name: 'commands' });
    expect(menu.textContent).toContain('/parity-demo');
    fireEvent.change(input, { target: { value: '/mo' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(input.value).toBe('/mode ');
    expect(state.send).not.toHaveBeenCalled();
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'mode' });
  });

  it('#3189: a command the terminal runs is marked "terminal" in the menu; a session command is not', () => {
    const state = stubState({
      commandCatalog: {
        commands: [
          { name: 'help', description: 'Show commands', modelInvocable: false, runner: 'runtime' },
          { name: 'share', description: 'Share the session', modelInvocable: false, runner: 'runtime' },
          {
            name: 'shell',
            description: 'Open a shell',
            modelInvocable: false,
            runner: 'client',
            surfaces: ['terminal'],
          },
        ],
        skills: [],
      },
    } as Partial<IWsSessionState>);
    render(<SessionSurface state={state} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: '/sh' } });
    const shell = screen.getByRole('option', { name: /\/shell/ });
    const badge = within(shell).getByText('terminal');
    expect(badge.getAttribute('title')).toBe('Runs in the robota terminal');
    expect(shell.getAttribute('aria-description')).toBe('Runs in the robota terminal');
    const share = screen.getByRole('option', { name: /\/share/ });
    expect(within(share).queryByText('terminal')).toBeNull();
  });

  it('#3186: the status row shows the session status and opens its pickers', () => {
    const state = stubState({
      sessionStatus: {
        sessionId: 's',
        model: 'claude-sonnet-5',
        permissionMode: 'acceptEdits',
        effort: 'high',
        context: { usedPercentage: 42, usedTokens: 42, maxTokens: 100, remainingPercentage: 58 },
        goal: null,
      },
    } as Partial<IWsSessionState>);
    render(<SessionSurface state={state} />);
    expect(screen.getByLabelText('context 42% used')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'mode: acceptEdits' }));
    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'mode' });
    fireEvent.click(screen.getByRole('button', { name: 'model: claude-sonnet-5' }));
    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'provider' });
  });

  it('#3186: a goal in progress shows above the composer and can be stopped', () => {
    const goal = {
      id: 'g',
      objective: 'Make the tests pass',
      status: 'active',
      iterations: 2,
      maxIterations: 10,
      startedAt: '2026-09-26T00:00:00Z',
      progress: [],
    };
    const status = {
      sessionId: 's',
      model: 'm',
      permissionMode: 'default',
      effort: 'auto',
      context: { usedPercentage: 1, usedTokens: 1, maxTokens: 100, remainingPercentage: 99 },
    };
    const state = stubState({ sessionStatus: { ...status, goal } } as Partial<IWsSessionState>);
    const { rerender } = render(<SessionSurface state={state} />);
    const bar = screen.getByRole('status', { name: 'goal' });
    expect(bar.textContent).toContain('Make the tests pass');
    expect(bar.textContent).toContain('2/10');
    fireEvent.click(screen.getByRole('button', { name: 'Stop goal' }));
    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'goal', args: 'cancel' });
    rerender(<SessionSurface state={stubState({ sessionStatus: { ...status, goal: null } } as Partial<IWsSessionState>)} />);
    expect(screen.queryByRole('status', { name: 'goal' })).toBeNull();
  });

  it('#3186 review: a pending question stays visible while the Usage view is open', () => {
    const state = stubState({
      pendingPrompts: [
        { kind: 'permission', id: 'p1', toolName: 'write_file', toolArgs: { path: 'x' } },
      ] as unknown as IWsSessionState['pendingPrompts'],
    });
    render(<SessionSurface state={state} personalUsageEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(screen.getByText(/permission request/i)).toBeTruthy();
    fireEvent.click(screen.getByText('Allow'));
    expect(state.answerPermission).toHaveBeenCalledWith('p1', true);
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

  it('#3186: a docked question takes focus once armed, answers by number key, and Esc cancels it', () => {
    vi.useFakeTimers();
    const state = stubState({
      pendingPrompts: [
        {
          kind: 'ask',
          id: 'a1',
          request: {
            title: 'Select language',
            options: [
              { value: 'ko', label: 'ko' },
              { value: 'en', label: 'en' },
            ],
          },
        },
      ] as unknown as IWsSessionState['pendingPrompts'],
    });
    const { unmount } = render(<SessionSurface state={state} />);
    const dialog = screen.getByRole('dialog', { name: 'pending question' });
    // #3189: its keys are not live as it appears, so a key typed for the composer cannot answer it.
    expect(document.activeElement).not.toBe(dialog);
    act(() => {
      vi.runOnlyPendingTimers();
    });
    expect(document.activeElement).toBe(dialog);
    fireEvent.keyDown(dialog, { key: '2' });
    expect(state.answerAsk).toHaveBeenCalledWith('a1', { type: 'answer', values: ['en'] });
    fireEvent.keyDown(dialog, { key: 'Escape' });
    expect(state.answerAsk).toHaveBeenCalledWith('a1', { type: 'cancelled' });
    unmount();
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

describe('#3189 — the session sidebar', () => {
  const listing: NonNullable<IWsSessionState['sessionListing']> = {
    currentSessionId: 'cur',
    sessions: [
      {
        id: 'cur',
        name: 'Refactor the parser',
        cwd: '/w',
        updatedAt: new Date(Date.now() - 5 * 60_000).toISOString(),
        messageCount: 12,
        preview: 'refactor',
      },
      {
        id: 'old',
        cwd: '/w',
        updatedAt: new Date(Date.now() - 3 * 3_600_000).toISOString(),
        messageCount: 1,
        preview: 'Fix the flaky test',
      },
    ],
    unreadableSessionIds: ['broken-1'],
  };

  it('lists the sessions with name or preview, time and count, the current one marked', () => {
    render(<SessionSurface state={stubState({ sessionListing: listing })} />);
    const sidebar = screen.getByRole('complementary', { name: 'Sessions' });
    const current = screen.getByRole('button', { name: /Refactor the parser/ });
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.textContent).toContain('5m ago');
    expect(current.textContent).toContain('12 msgs');
    const other = screen.getByRole('button', { name: /Fix the flaky test/ });
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.textContent).toContain('3h ago');
    expect(other.textContent).toContain('1 msg');
    // Unreadable records are listed as one folded line, never as rows to click.
    expect(screen.queryByRole('button', { name: /broken-1/ })).toBeNull();
    expect(sidebar.textContent).toContain('1 session could not be read');
    expect(sidebar.textContent).toContain('broken-1');
  });

  it('clicking another session switches to it; the current one does nothing', () => {
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);
    fireEvent.click(screen.getByRole('button', { name: /Refactor the parser/ }));
    expect(state.switchSession).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: /Fix the flaky test/ }));
    expect(state.switchSession).toHaveBeenCalledWith('old');
  });

  it('+ New session starts one', () => {
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);
    fireEvent.click(screen.getByRole('button', { name: /New session/ }));
    expect(state.newSession).toHaveBeenCalledTimes(1);
  });

  it('collapses to a rail and opens again', () => {
    const state = stubState({ sessionListing: listing });
    const { rerender } = render(<SessionSurface state={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Hide sessions' }));
    expect(state.setSessionSidebarOpen).toHaveBeenCalledWith(false);
    rerender(<SessionSurface state={{ ...state, sessionSidebarOpen: false }} />);
    expect(screen.queryByRole('complementary', { name: 'Sessions' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show sessions' }));
    expect(state.setSessionSidebarOpen).toHaveBeenCalledWith(true);
  });

  it('a host that cannot list sessions has no sidebar', () => {
    render(
      <SessionSurface
        state={stubState({ sessionsError: { code: 'not_available', message: 'no directory' } })}
      />,
    );
    expect(screen.queryByRole('complementary', { name: 'Sessions' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Show sessions' })).toBeNull();
  });

  it('a failed listing says why inside the sidebar', () => {
    render(
      <SessionSurface
        state={stubState({ sessionsError: { code: 'list_failed', message: 'Could not read the store.' } })}
      />,
    );
    const sidebar = screen.getByRole('complementary', { name: 'Sessions' });
    expect(sidebar.textContent).toContain('Could not read the store.');
  });
});
