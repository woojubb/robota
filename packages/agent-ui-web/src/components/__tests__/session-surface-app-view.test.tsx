// @vitest-environment jsdom
/**
 * `SessionSurface` is where a host decides whether app views can run: it provides the app-view host
 * to the conversation from its `appViewSandboxUrl` prop. Without the prop (the remote browser
 * surface, `apps/agent-web`) a view is one plain line and nothing is read or framed.
 */
import { render } from '../../testing/product-provider.js';
import { cleanup, screen } from '@testing-library/react';
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { APP_VIEW_UNAVAILABLE_TEXT } from '../AppView.js';
import { SessionSurface } from '../SessionSurface.js';

import type { IWsSessionState } from '../../hooks/useSessionClient.js';

const original = Element.prototype.scrollIntoView;
beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});
afterAll(() => {
  Element.prototype.scrollIntoView = original;
});
afterEach(() => cleanup());

function state(overrides: Record<string, unknown> = {}): IWsSessionState {
  return {
    status: 'connected',
    connectionLost: false,
    messages: [
      {
        id: 'group',
        role: 'tools',
        tools: [
          {
            id: 'app-tool',
            name: 'mcp__files__browse',
            status: 'done',
            executionId: 'exec-app',
            appView: { viewId: 'view-1', sourceId: 'files', resourceUri: 'ui://files/list' },
          },
        ],
      },
    ],
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
    readAppView: vi.fn().mockResolvedValue({
      sourceId: 'files',
      resourceUri: 'ui://files/list',
      mimeType: 'text/html;profile=mcp-app',
      html: '<main>rows</main>',
      callableTools: {},
    }),
    callAppTool: vi.fn(),
    ...overrides,
  } as unknown as IWsSessionState;
}

describe('SessionSurface and app views', () => {
  it('frames the view in the sandbox page it is given, reading it through the session', async () => {
    const value = state();
    render(<SessionSurface state={value} appViewSandboxUrl="http://localhost/app-sandbox.html" />);

    const frame = await screen.findByTestId('app-view-frame');
    expect(frame.getAttribute('src')).toBe('http://localhost/app-sandbox.html');
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
    expect(value.readAppView).toHaveBeenCalledExactlyOnceWith('view-1', expect.any(AbortSignal));
  });

  it('shows one plain line, reading nothing, when the host gives no sandbox page', () => {
    const value = state();
    render(<SessionSurface state={value} />);

    expect(screen.getByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(value.readAppView).not.toHaveBeenCalled();
  });
});
