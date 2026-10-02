// @vitest-environment jsdom
/**
 * #3289 §3 review — every state `SessionSurface`'s conversation slot can show renders exactly one
 * `main` landmark. Nothing above `SessionSurface` (agent-gui-web's `App`, or a host embedding the
 * package directly) can be relied on to supply one, so each of the slot's own states — the empty
 * state before a first turn, the provider-setup gate, and the real conversation (`ConversationView`,
 * already covered elsewhere) — must carry it itself, never zero and never nested.
 */

import { render } from '../../testing/product-provider.js';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { SessionSurface } from '../SessionSurface.js';

import type { IWsSessionState } from '../../hooks/useSessionClient.js';

beforeAll(() => {
  // jsdom has no layout; the conversation scrolls itself to the end after each render.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

function baseState(overrides: Record<string, unknown> = {}): IWsSessionState {
  return {
    status: 'connected',
    connectionLost: false,
    messages: [],
    activeTools: [],
    streamingText: '',
    isThinking: false,
    executionWorkspace: null,
    sessionName: null,
    ownDriverId: null,
    commandCatalog: null,
    sessionStatus: null,
    sessionListing: null,
    sessionsError: null,
    requestSessions: () => {},
    switchSession: () => {},
    newSession: () => {},
    sessionSidebarOpen: false,
    setSessionSidebarOpen: () => {},
    send: () => {},
    pendingPrompts: [],
    queuedPrompt: null,
    answerPermission: () => {},
    answerAsk: () => {},
    sessionNotices: [],
    dismissSessionNotice: () => {},
    scheduledTasks: [],
    pauseSchedule: () => {},
    resumeSchedule: () => {},
    deleteSchedule: () => {},
    ...overrides,
  } as unknown as IWsSessionState;
}

describe('SessionSurface renders exactly one main landmark in every conversation-slot state (#3289 §3 review)', () => {
  it('the empty state before a first turn', () => {
    const { container } = render(<SessionSurface state={baseState()} />);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('the provider-setup gate (sessionStatus.setupRequired)', () => {
    const state = baseState({ sessionStatus: { setupRequired: true } });
    const { container } = render(<SessionSurface state={state} />);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });

  it('the real conversation, once messages exist — never nested with the slot it replaces', () => {
    const state = baseState({
      messages: [{ id: 'm1', role: 'user', content: 'hi' }],
    });
    const { container } = render(<SessionSurface state={state} />);
    expect(container.querySelectorAll('main')).toHaveLength(1);
  });
});
