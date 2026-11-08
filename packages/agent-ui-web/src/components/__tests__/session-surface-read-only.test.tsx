// @vitest-environment jsdom

/**
 * While the host has the client observe, `SessionSurface` renders read-only: the conversation and its
 * work stay visible, every control that changes the session or its work is absent. `drive` and a role
 * the host has not answered yet (`null`) render exactly as before.
 */

import { render } from '../../testing/product-provider.js';
import { cleanup, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SessionSurface } from '../SessionSurface.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type { IWsSessionState } from '../../hooks/useSessionClient.js';

const original = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  Element.prototype.scrollIntoView = original;
});
afterEach(cleanup);

function entry(overrides: Partial<IExecutionWorkspaceEntry>): IExecutionWorkspaceEntry {
  return {
    id: 'task:agent_1',
    sourceId: 'agent_1',
    kind: 'background_task',
    origin: { kind: 'tool_call', sessionId: 'session_1' },
    status: 'running',
    title: 'Review the auth module',
    unread: false,
    attention: 'none',
    visibility: 'default',
    updatedAt: '2026-05-09T00:00:00.000Z',
    controls: ['select', 'cancel', 'attach', 'send'],
    resumeSessionId: 'fork-1',
    state: 'working',
    ...overrides,
  };
}

/** A complete enough status that the composer's status row never reads through an undefined field. */
function status(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    sessionId: 's1',
    model: 'm',
    permissionMode: 'default',
    effort: 'auto',
    context: { usedPercentage: 0, usedTokens: 0, maxTokens: 100, remainingPercentage: 100 },
    goal: null,
    ...extra,
  };
}

const goal = {
  id: 'goal_1',
  objective: 'Ship the release',
  status: 'active',
  iterations: 1,
  maxIterations: 5,
};

function state(overrides: Record<string, unknown> = {}): IWsSessionState {
  return {
    status: 'connected',
    connectionLost: false,
    role: null,
    messages: [{ id: 'm1', role: 'user', content: 'hello' }],
    activeTools: [],
    streamingText: '',
    isThinking: false,
    executionWorkspace: { entries: [entry({})] },
    openEntryId: null,
    sessionName: null,
    ownDriverId: null,
    commandCatalog: null,
    sessionStatus: status({ goal }),
    sessionListing: {
      currentSessionId: 's1',
      sessions: [
        {
          id: 's1',
          cwd: '/w',
          updatedAt: '2026-09-26T00:00:00.000Z',
          messageCount: 1,
          preview: 'one',
          title: 'one',
        },
      ],
    },
    sessionsError: null,
    requestSessions: () => {},
    switchSession: () => {},
    newSession: () => {},
    sessionSidebarOpen: true,
    setSessionSidebarOpen: () => {},
    send: () => {},
    pendingPrompts: [],
    queuedPrompt: null,
    answerPermission: () => {},
    answerAsk: () => {},
    sessionNotices: [],
    dismissSessionNotice: () => {},
    scheduledTasks: [
      {
        id: 'sched_1',
        kind: 'scheduled',
        label: 'Scheduled: check the build',
        status: 'sleeping',
        mode: 'background',
        parentSessionId: 'session-1',
        depth: 0,
        cwd: '/repo',
        updatedAt: '2026-05-01T00:00:00.000Z',
        unread: false,
        schedule: { cronExpression: '0 9 * * 1-5', agentInstruction: 'check the build' },
      },
    ],
    pauseSchedule: () => {},
    resumeSchedule: () => {},
    deleteSchedule: () => {},
    openExecutionDetail: () => {},
    closeExecutionDetail: () => {},
    loadMoreExecutionDetail: () => {},
    executionDetailStatus: 'ready',
    executionDetailRecords: [],
    executionDetailError: null,
    executionDetailComplete: true,
    ...overrides,
  } as unknown as IWsSessionState;
}

const CONTROLS = [
  'Stop goal',
  'Cancel goal',
  'Pause',
  'Resume',
  'Delete…',
  'Stop',
  'Send to fork',
  'Continue as session',
];

function presentControls(): string[] {
  return CONTROLS.filter(
    (name) =>
      screen.queryAllByRole('button', { name: new RegExp(`^${name}`, 'u') }).length > 0 ||
      screen.queryByLabelText(name) !== null,
  );
}

describe('SessionSurface read-only presentation', () => {
  it.each([['observe' as const]])('%s hides every control that changes the session', (role) => {
    render(<SessionSurface state={state({ role })} personalUsageEnabled />);
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.getByText('Read-only: you are watching this session.').getAttribute('role')).toBe(
      'status',
    );
    expect(screen.queryByLabelText('Sessions')).toBeNull();
    expect(screen.queryByLabelText('Show sessions')).toBeNull();
    expect(screen.queryByLabelText('Settings')).toBeNull();
    expect(screen.queryByRole('button', { name: 'New session' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Usage' })).toBeNull();
    expect(screen.getByRole('button', { name: 'Project' })).toBeTruthy();
    // The work and the goal are still shown.
    expect(screen.getAllByText('Ship the release').length).toBeGreaterThan(0);
    expect(screen.getByText('Review the auth module')).toBeTruthy();
    expect(screen.getByText('check the build')).toBeTruthy();
    expect(presentControls()).toEqual([]);
  });

  it("an observer's open execution detail has no Stop, Send or Continue", () => {
    const running = entry({});
    const ended = entry({
      id: 'task:agent_2',
      sourceId: 'agent_2',
      title: 'Ended fork',
      status: 'completed',
      controls: ['select', 'close', 'attach'],
    });
    for (const open of [running, ended]) {
      render(
        <SessionSurface
          state={state({
            role: 'observe',
            executionWorkspace: { entries: [running, ended] },
            openEntryId: open.id,
          })}
        />,
      );
      expect(screen.getByRole('dialog', { name: open.title })).toBeTruthy();
      expect(presentControls()).toEqual([]);
      expect(screen.queryByLabelText('Message the fork')).toBeNull();
      cleanup();
    }
  });

  it('an observer is not offered the provider setup action', () => {
    render(
      <SessionSurface
        state={state({ role: 'observe', sessionStatus: status({ setupRequired: true }) })}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Set up provider' })).toBeNull();
    expect(screen.getByRole('main', { name: 'Conversation' })).toBeTruthy();
  });

  it.each([['drive' as const], [null]])('%s renders the controls as before', (role) => {
    render(<SessionSurface state={state({ role })} personalUsageEnabled />);
    expect(screen.getByRole('textbox')).toBeTruthy();
    expect(screen.queryByText('Read-only: you are watching this session.')).toBeNull();
    expect(screen.getByLabelText('Sessions')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Usage' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Stop goal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Cancel goal' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Pause' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Delete…' })).toBeTruthy();
    expect(screen.getByRole('button', { name: /^Stop Review/u })).toBeTruthy();
  });

  it.each([['drive' as const], [null]])(
    '%s keeps Send in an open fork and Set up provider',
    (role) => {
      render(<SessionSurface state={state({ role, openEntryId: 'task:agent_1' })} />);
      expect(screen.getByLabelText('Message the fork')).toBeTruthy();
      cleanup();
      render(
        <SessionSurface state={state({ role, sessionStatus: status({ setupRequired: true }) })} />,
      );
      expect(screen.getByRole('button', { name: 'Set up provider' })).toBeTruthy();
    },
  );
});
