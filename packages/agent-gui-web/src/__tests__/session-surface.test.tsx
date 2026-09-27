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
    connectionLost: false,
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
    queuedPrompt: null,
    send: vi.fn(),
    answerPermission: vi.fn(),
    answerAsk: vi.fn(),
    settingsOpen: false,
    settingsStatus: 'idle',
    settingsSnapshot: null,
    settingsError: null,
    openSettings: vi.fn(),
    closeSettings: vi.fn(),
    updateSettings: vi.fn(),
    ...over,
  } as unknown as IWsSessionState;
}

describe('SessionSurface (GUI-002 TC-01/TC-02)', () => {
  it('names the current session in the title bar', () => {
    render(<SessionSurface state={stubState({ sessionName: 'Fix the flaky parser test' })} />);
    expect(screen.getByRole('heading', { name: 'Fix the flaky parser test' })).toBeTruthy();
  });

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
      entries: [{ id: 'main', kind: 'main_thread', title: 'Main thread', controls: ['select'] }],
    } as unknown as IWsSessionState['executionWorkspace'];
    const { rerender } = render(
      <SessionSurface state={stubState({ executionWorkspace: mainOnly })} />,
    );
    expect(screen.queryByText('Main thread')).toBeNull();
    const withTask = {
      entries: [
        { id: 'main', kind: 'main_thread', title: 'Main thread', controls: ['select'] },
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
          {
            name: 'mode',
            description: 'Change the permission mode',
            modelInvocable: false,
            runner: 'runtime',
          },
        ],
        skills: [
          {
            name: 'parity-demo',
            description: 'Demo skill',
            source: 'project',
            modelInvocable: true,
            userInvocable: true,
          },
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
          {
            name: 'share',
            description: 'Share the session',
            modelInvocable: false,
            runner: 'runtime',
          },
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
    rerender(
      <SessionSurface
        state={stubState({ sessionStatus: { ...status, goal: null } } as Partial<IWsSessionState>)}
      />,
    );
    expect(screen.queryByRole('status', { name: 'goal' })).toBeNull();
  });

  it('#3280 §2: Send becomes Stop while a turn runs, and Stop sends abort', () => {
    const state = stubState({ isThinking: true });
    render(<SessionSurface state={state} />);
    expect(screen.queryByRole('button', { name: 'Send' })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Stop' }));
    expect(state.send).toHaveBeenCalledWith({ type: 'abort' });
  });

  it('#3280 §2: Esc in the composer stops a running turn', () => {
    const state = stubState({ isThinking: true });
    render(<SessionSurface state={state} />);
    fireEvent.keyDown(screen.getByLabelText('message'), { key: 'Escape' });
    expect(state.send).toHaveBeenCalledWith({ type: 'abort' });
  });

  it('#3280 §2: more than one message queued behind the turn shows above the composer, with Remove all only', () => {
    const state = stubState({
      isThinking: true,
      queuedPrompt: { text: 'ping the team when done', count: 2 },
    } as Partial<IWsSessionState>);
    render(<SessionSurface state={state} />);
    const row = screen.getByRole('status', { name: 'queued prompt' });
    expect(row.textContent).toContain('Queued: ping the team when done');
    expect(row.textContent).toContain('and 1 more');
    // Edit would only ever recover the shown prompt's text; cancel-queue drops every queued prompt.
    expect(screen.queryByRole('button', { name: 'Edit' })).toBeNull();

    fireEvent.click(screen.getByRole('button', { name: 'Remove all' }));
    expect(state.send).toHaveBeenCalledWith({ type: 'cancel-queue' });
    expect(state.send).toHaveBeenCalledWith({ type: 'get-pending' });
  });

  it('#3280 §2: Edit cancels the queue and puts the queued text back in the draft', () => {
    const state = stubState({
      isThinking: true,
      queuedPrompt: { text: 'ping the team when done', count: 1 },
    } as Partial<IWsSessionState>);
    render(<SessionSurface state={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Edit' }));
    expect(state.send).toHaveBeenCalledWith({ type: 'cancel-queue' });
    expect((screen.getByLabelText('message') as HTMLTextAreaElement).value).toBe(
      'ping the team when done',
    );
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
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }), { detail: 1 });
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
    fireEvent.click(screen.getByRole('button', { name: 'Allow' }), { detail: 1 });
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
    // The report itself is content-free; a session's readable name comes from this workspace's own
    // local session-directory listing (#3289 §4), not from the report.
    const listing: NonNullable<IWsSessionState['sessionListing']> = {
      currentSessionId: 'a',
      sessions: [
        { id: 'a', name: 'Session A', cwd: '/w', updatedAt: report.generatedAt, messageCount: 1, preview: '' },
        { id: 'b', name: 'Session B', cwd: '/w', updatedAt: report.generatedAt, messageCount: 1, preview: '' },
        { id: 'c', name: 'Session C', cwd: '/w', updatedAt: report.generatedAt, messageCount: 1, preview: '' },
      ],
      unreadableSessionIds: [],
    };
    const state = stubState({
      personalUsageStatus: 'ready',
      personalUsageReport: report,
      requestPersonalUsage: vi.fn(),
      sessionListing: listing,
    });

    render(<SessionSurface state={state} personalUsageEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));

    expect(state.requestPersonalUsage).toHaveBeenCalledWith('7d');
    expect(screen.getByText('1,200')).toBeTruthy();
    expect(screen.getByText('gpt-test')).toBeTruthy();
    expect(screen.getByText(/partial day/i)).toBeTruthy();
    // The button shows the session's readable name, never the raw id (#3289 §4).
    fireEvent.click(screen.getByRole('button', { name: 'Open session Session A' }));
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
        preview: '## Fix the flaky test (raw reply, not the title)',
        // #3289 §1: a stable title (the first request), distinct from the raw `preview` above.
        title: 'Fix the flaky test',
      },
    ],
    unreadableSessionIds: ['broken-1'],
  };

  // A row's "More" button is also named after its title ("More for <title>"), so an unanchored
  // name match finds both; the row button itself is always first in the DOM.
  const sessionRowButton = (name: RegExp): HTMLElement =>
    screen.getAllByRole('button', { name }).filter((el) => el.tagName === 'BUTTON' && !(el.getAttribute('aria-label') ?? '').startsWith('More for'))[0]!;

  it('lists the sessions by their stable title, time, the current one marked, no message count', () => {
    render(<SessionSurface state={stubState({ sessionListing: listing })} />);
    const sidebar = screen.getByRole('complementary', { name: 'Sessions' });
    const current = sessionRowButton(/Refactor the parser/);
    expect(current.getAttribute('aria-current')).toBe('true');
    expect(current.textContent).toContain('5m ago');
    expect(current.textContent).not.toMatch(/msg/);
    const other = sessionRowButton(/Fix the flaky test/);
    expect(other.getAttribute('aria-current')).toBeNull();
    expect(other.textContent).toContain('3h ago');
    expect(other.textContent).not.toMatch(/msg/);
    expect(other.textContent).not.toContain('## Fix the flaky test');
    // Unreadable records are listed as one folded line, never as rows to click.
    expect(screen.queryByRole('button', { name: /broken-1/ })).toBeNull();
    expect(sidebar.textContent).toContain("1 older session in this folder can't be opened");
    expect(sidebar.textContent).toContain('broken-1');
  });

  it('clicking another session switches to it; the current one does nothing', () => {
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);
    fireEvent.click(sessionRowButton(/Refactor the parser/));
    expect(state.switchSession).not.toHaveBeenCalled();
    fireEvent.click(sessionRowButton(/Fix the flaky test/));
    expect(state.switchSession).toHaveBeenCalledWith('old');
  });

  it('the title bar names the current session from the listing when no rename was seen', () => {
    render(<SessionSurface state={stubState({ sessionListing: listing })} />);
    expect(screen.getByRole('heading', { name: 'Refactor the parser' })).toBeTruthy();
  });

  it('an unnamed current session is titled by its stable title, not the raw preview', () => {
    render(
      <SessionSurface
        state={stubState({ sessionListing: { ...listing, currentSessionId: 'old' } })}
      />,
    );
    expect(screen.getByRole('heading', { name: 'Fix the flaky test' })).toBeTruthy();
  });

  it('choosing a session from the usage view shows its conversation', () => {
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} personalUsageEnabled />);
    fireEvent.click(screen.getByRole('button', { name: 'Usage' }));
    expect(screen.getByRole('main', { name: 'Personal usage' })).toBeTruthy();

    fireEvent.click(sessionRowButton(/Fix the flaky test/));

    expect(state.switchSession).toHaveBeenCalledWith('old');
    expect(screen.queryByRole('main', { name: 'Personal usage' })).toBeNull();
    expect(screen.getByLabelText('message')).toBeTruthy();
  });

  it('+ New session starts one', () => {
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'New session' }));
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

  it('#3282 §4a: the footer gear opens the Settings screen', () => {
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);
    fireEvent.click(screen.getByRole('button', { name: 'Settings' }));
    expect(state.openSettings).toHaveBeenCalledTimes(1);
  });

  it('a failed listing says why inside the sidebar', () => {
    render(
      <SessionSurface
        state={stubState({
          sessionsError: { code: 'list_failed', message: 'Could not read the store.' },
        })}
      />,
    );
    const sidebar = screen.getByRole('complementary', { name: 'Sessions' });
    expect(sidebar.textContent).toContain('Could not read the store.');
  });
});

describe('#3280 §5 — a lost connection keeps the conversation and the draft', () => {
  it('the composer refuses to send while not connected, and keeps the draft', () => {
    const state = stubState({ status: 'disconnected' });
    render(<SessionSurface state={state} />);
    const input = screen.getByLabelText('message') as HTMLTextAreaElement;
    fireEvent.change(input, { target: { value: 'are you there' } });
    fireEvent.keyDown(input, { key: 'Enter' });

    expect(state.send).not.toHaveBeenCalled();
    expect(input.value).toBe('are you there');
    const send = screen.getByRole('button', { name: 'Send' });
    expect(send.hasAttribute('disabled')).toBe(true);
    expect(send.getAttribute('aria-description')).toBe('Not connected');
  });

  it('reconnecting after a drop shows a banner above the conversation, which stays visible', () => {
    const { rerender } = render(<SessionSurface state={stubState({ status: 'connected' })} />);
    expect(screen.getByText('hello')).toBeTruthy();

    rerender(<SessionSurface state={stubState({ status: 'connecting' })} />);

    expect(screen.getByRole('status').textContent).toContain('Reconnecting…');
    expect(screen.getByText('hello')).toBeTruthy();
  });

  it('once retries give up, a desktop host shows "Robota stopped." with a working Reconnect; the conversation stays', () => {
    const onReconnect = vi.fn(() => new Promise<void>(() => {}));
    render(
      <SessionSurface
        state={stubState({ status: 'disconnected', connectionLost: true })}
        onReconnect={onReconnect}
      />,
    );
    expect(screen.getByText('hello')).toBeTruthy();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('Robota stopped.');

    fireEvent.click(within(alert).getByRole('button', { name: 'Reconnect' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });

  it('once retries give up, a browser host (no onReconnect) shows the restart instruction and no button', () => {
    render(<SessionSurface state={stubState({ status: 'disconnected', connectionLost: true })} />);
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('robota --serve --open');
    expect(within(alert).queryByRole('button')).toBeNull();
  });
});

describe('#3282 §3 — first run: setup mode', () => {
  const setupStatus: NonNullable<IWsSessionState['sessionStatus']> = {
    sessionId: 's',
    model: 'setup-required',
    permissionMode: 'default',
    effort: 'auto',
    context: { usedPercentage: 0, usedTokens: 0, maxTokens: 0, remainingPercentage: 100 },
    goal: null,
    setupRequired: true,
  };

  it('shows the setup panel instead of the conversation, and hides the composer', () => {
    const state = stubState({ sessionStatus: setupStatus });
    render(<SessionSurface state={state} />);

    expect(screen.getByRole('heading', { name: 'Connect a model provider to start.' })).toBeTruthy();
    // The conversation (and its default fixture message) is not shown while setup is required.
    expect(screen.queryByText('hello')).toBeNull();
    expect(screen.queryByLabelText('message')).toBeNull();
  });

  it('renders exactly one main landmark, never zero, never nested (#3289 §3)', () => {
    const state = stubState({ sessionStatus: setupStatus });
    render(<SessionSurface state={state} />);

    // getByRole('main') itself throws on zero matches or on more than one — this alone proves both
    // halves of the invariant, the same way the conversation and personal-usage states already do.
    expect(screen.getByRole('main', { name: 'Set up a provider' })).toBeTruthy();
  });

  it('"Set up provider" sends /provider add as a command', () => {
    const state = stubState({ sessionStatus: setupStatus });
    render(<SessionSurface state={state} />);

    fireEvent.click(screen.getByRole('button', { name: 'Set up provider' }));

    expect(state.send).toHaveBeenCalledWith({ type: 'command', name: 'provider', args: 'add' });
  });

  it('"Set up provider" is disabled while disconnected', () => {
    const state = stubState({ status: 'disconnected', sessionStatus: setupStatus });
    render(<SessionSurface state={state} />);

    const button = screen.getByRole('button', { name: 'Set up provider' });
    expect(button.hasAttribute('disabled')).toBe(true);
    fireEvent.click(button);
    expect(state.send).not.toHaveBeenCalled();
  });

  it('the setup flow\'s questions dock where the composer would be (PermissionPrompt keeps rendering)', () => {
    const state = stubState({
      sessionStatus: setupStatus,
      pendingPrompts: [
        {
          kind: 'ask',
          id: 'a1',
          request: { title: 'Select provider', options: [{ value: 'anthropic', label: 'anthropic' }] },
        },
      ] as unknown as IWsSessionState['pendingPrompts'],
    });
    render(<SessionSurface state={state} />);

    expect(screen.getByRole('dialog', { name: 'pending question' })).toBeTruthy();
  });

  it('clears once setupRequired turns false: the composer and conversation return, live, no reload', () => {
    const { rerender } = render(<SessionSurface state={stubState({ sessionStatus: setupStatus })} />);
    expect(screen.queryByLabelText('message')).toBeNull();

    rerender(
      <SessionSurface
        state={stubState({ sessionStatus: { ...setupStatus, setupRequired: undefined, model: 'claude' } })}
      />,
    );

    expect(screen.getByLabelText('message')).toBeTruthy();
    expect(screen.getByText('hello')).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Connect a model provider to start.' })).toBeNull();
  });
});

describe('#3289 §2 — below md, the open sidebar is a sheet over the conversation', () => {
  const listing: NonNullable<IWsSessionState['sessionListing']> = {
    currentSessionId: 'cur',
    sessions: [
      { id: 'cur', name: 'Current session', cwd: '/w', updatedAt: new Date().toISOString(), messageCount: 1, preview: '' },
      { id: 'old', name: 'Older session', cwd: '/w', updatedAt: new Date().toISOString(), messageCount: 1, preview: '' },
    ],
    unreadableSessionIds: [],
  };
  const sessionRowButton = (name: RegExp): HTMLElement =>
    screen.getAllByRole('button', { name }).filter((el) => el.tagName === 'BUTTON' && !(el.getAttribute('aria-label') ?? '').startsWith('More for'))[0]!;

  /** `matches` fixed for every query — good enough for a test that only cares about one breakpoint. */
  function mockViewport(matches: boolean): void {
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      addListener: vi.fn(),
      removeListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
  }

  afterEach(() => {
    // @ts-expect-error -- test-only cleanup of the global stub `mockViewport` sets.
    delete window.matchMedia;
  });

  it('a wide window shows the sidebar as a plain column, with no backdrop', () => {
    mockViewport(false);
    render(<SessionSurface state={stubState({ sessionListing: listing })} />);
    expect(screen.getByRole('complementary', { name: 'Sessions' })).toBeTruthy();
    expect(screen.queryByRole('dialog', { name: 'Sessions' })).toBeNull();
  });

  it('a narrow window shows the sheet in a dialog with a dimmed backdrop, which closes it on an outside click', () => {
    mockViewport(true);
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);

    const dialog = screen.getByRole('dialog', { name: 'Sessions' });
    expect(dialog).toBeTruthy();
    // The backdrop is `Dialog`'s own outer element, the dialog panel's parent; `Dialog` listens for
    // `mousedown` there (not `click`) and closes only when the event's target is the backdrop itself.
    fireEvent.mouseDown(dialog.parentElement!);

    expect(state.setSessionSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('Esc closes the narrow sheet', () => {
    mockViewport(true);
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);

    fireEvent.keyDown(document, { key: 'Escape' });

    expect(state.setSessionSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('choosing a session closes the narrow sheet too', () => {
    mockViewport(true);
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);

    fireEvent.click(sessionRowButton(/Older session/));

    expect(state.switchSession).toHaveBeenCalledWith('old');
    expect(state.setSessionSidebarOpen).toHaveBeenCalledWith(false);
  });

  it('a wide window never closes on Esc or a session choice — it is a column, not a sheet', () => {
    mockViewport(false);
    const state = stubState({ sessionListing: listing });
    render(<SessionSurface state={state} />);

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(state.setSessionSidebarOpen).not.toHaveBeenCalled();

    fireEvent.click(sessionRowButton(/Older session/));
    expect(state.switchSession).toHaveBeenCalledWith('old');
    expect(state.setSessionSidebarOpen).not.toHaveBeenCalled();
  });

  it('moves focus into the open sheet, and traps Tab inside it', () => {
    mockViewport(true);
    render(<SessionSurface state={stubState({ sessionListing: listing })} />);
    const dialog = screen.getByRole('dialog', { name: 'Sessions' });

    expect(dialog.contains(document.activeElement)).toBe(true);

    const focusable = dialog.querySelectorAll('button');
    const first = focusable[0] as HTMLElement;
    const last = focusable[focusable.length - 1] as HTMLElement;
    first.focus();
    fireEvent.keyDown(document, { key: 'Tab', shiftKey: true });
    expect(document.activeElement).toBe(last);
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(first);
  });

  it('returns focus to the control that opened the sheet, once it closes', () => {
    mockViewport(true);
    const state = stubState({ sessionListing: listing, sessionSidebarOpen: false });
    const { rerender } = render(<SessionSurface state={state} />);

    const opener = screen.getByRole('button', { name: 'Show sessions' });
    opener.focus();
    fireEvent.click(opener);
    expect(state.setSessionSidebarOpen).toHaveBeenCalledWith(true);

    // The rail's own button is replaced by the sheet it opens, so this simulates the host applying
    // that state change (as the earlier "collapses to a rail and opens again" test does).
    rerender(<SessionSurface state={{ ...state, sessionSidebarOpen: true }} />);
    expect(screen.getByRole('dialog', { name: 'Sessions' }).contains(document.activeElement)).toBe(true);

    fireEvent.keyDown(document, { key: 'Escape' });
    rerender(<SessionSurface state={{ ...state, sessionSidebarOpen: false }} />);

    // A fresh "Show sessions" button remounted under the same name — that is the return address.
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Show sessions' }));
  });
});
