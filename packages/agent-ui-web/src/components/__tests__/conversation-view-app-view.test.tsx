// @vitest-environment jsdom

import { render } from '../../testing/product-provider.js';
import { act, cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { AppViewHostContext } from '../../app-view/host-context.js';
import { APP_VIEW_UNAVAILABLE_TEXT } from '../AppView.js';
import { ConversationView } from '../ConversationView.js';

import type { IAppViewHost } from '../../app-view/host-context.js';
import type { IActiveTool, TConversationEntry } from '../../hooks/useSessionClient.js';

// jsdom has no scroll implementation; ConversationView scrolls to the bottom on every update.
Element.prototype.scrollIntoView = (): void => {};

afterEach(() => cleanup());

function host(overrides: Partial<IAppViewHost> = {}): IAppViewHost {
  return {
    sandboxUrl: 'http://localhost/app-sandbox.html',
    readAppView: vi.fn().mockResolvedValue({
      sourceId: 'files',
      resourceUri: 'ui://files/list',
      mimeType: 'text/html;profile=mcp-app',
      html: '<main>rows</main>',
      callableTools: {},
    }),
    callAppTool: vi.fn(),
    hostInfo: { name: 'Test Host', version: '1.0.0' },
    platform: 'web',
    ...overrides,
  };
}

function appTool(overrides: Partial<IActiveTool> = {}): IActiveTool {
  return {
    id: 'app-tool',
    name: 'mcp__files__browse',
    status: 'done',
    executionId: 'exec-app',
    appView: { viewId: 'view-1', sourceId: 'files', resourceUri: 'ui://files/list' },
    ...overrides,
  };
}

function plainTool(overrides: Partial<IActiveTool> = {}): IActiveTool {
  return {
    id: 'plain-tool',
    name: 'Read',
    status: 'done',
    executionId: 'exec-plain',
    ...overrides,
  };
}

function renderConversation(options: {
  messages?: TConversationEntry[];
  activeTools?: IActiveTool[];
  value?: IAppViewHost | null;
}): ReturnType<typeof render> {
  const element = (
    <AppViewHostContext.Provider value={options.value === undefined ? host() : options.value}>
      <ConversationView
        messages={options.messages ?? []}
        activeTools={options.activeTools ?? []}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />
    </AppViewHostContext.Provider>
  );
  return render(element);
}

describe('a finished turn’s tool group', () => {
  const finished = (tools: readonly IActiveTool[]): TConversationEntry => ({
    id: 'group',
    role: 'tools',
    tools,
  });

  it('shows the app under the group line without opening the group', async () => {
    renderConversation({ messages: [finished([appTool()])] });

    const frame = await screen.findByTestId('app-view-frame');
    const summary = screen.getByRole('button', { name: /1 tool call/ });
    expect(summary.getAttribute('aria-expanded')).toBe('false');
    expect(summary.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(frame.getAttribute('sandbox')).toBe('allow-scripts');
  });

  it('shows it once: opening the group neither repeats it nor reads it again', async () => {
    const value = host();
    renderConversation({ messages: [finished([appTool()])], value });
    await screen.findByTestId('app-view-frame');

    fireEvent.click(screen.getByRole('button', { name: /1 tool call/ }));

    expect(screen.getAllByTestId('app-view-frame')).toHaveLength(1);
    expect(value.readAppView).toHaveBeenCalledTimes(1);
  });

  it('shows one app for each call that has one, and none for the calls that do not', async () => {
    const value = host();
    renderConversation({
      messages: [
        finished([
          appTool({
            id: 'a',
            executionId: 'exec-a',
            appView: { viewId: 'view-a', sourceId: 'files', resourceUri: 'ui://files/list' },
          }),
          plainTool(),
          appTool({
            id: 'b',
            executionId: 'exec-b',
            appView: { viewId: 'view-b', sourceId: 'files', resourceUri: 'ui://files/list' },
          }),
        ]),
      ],
      value,
    });

    await screen.findAllByTestId('app-view-frame');
    expect(screen.getAllByTestId('app-view-frame')).toHaveLength(2);
    expect(value.readAppView).toHaveBeenCalledWith('view-a', expect.any(AbortSignal));
    expect(value.readAppView).toHaveBeenCalledWith('view-b', expect.any(AbortSignal));
    expect(value.readAppView).not.toHaveBeenCalledWith('exec-plain');
  });

  it('shows a plain line instead of a frame when the surface has no sandbox page', () => {
    renderConversation({
      messages: [finished([appTool()])],
      value: host({ sandboxUrl: undefined }),
    });

    expect(screen.getByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('shows the plain line when no host provides app views at all', () => {
    renderConversation({ messages: [finished([appTool()])], value: null });

    expect(screen.getByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
  });

  it('renders a call without an app view exactly as before, with no frame and no line', () => {
    renderConversation({ messages: [finished([plainTool()])] });

    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeNull();
    expect(screen.getByRole('button', { name: /1 tool call/ }).getAttribute('aria-expanded')).toBe(
      'false',
    );
  });

  it('shows nothing for an internal signal call, even one that names a view', () => {
    renderConversation({ messages: [finished([appTool({ internal: true })])] });

    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeNull();
  });
});

describe('a live tool row', () => {
  it('shows the app only once its call has finished', async () => {
    const value = host();
    const { rerender } = renderConversation({
      activeTools: [appTool({ status: 'running', appView: undefined })],
      value,
    });
    expect(document.querySelector('iframe')).toBeNull();

    rerender(
      <AppViewHostContext.Provider value={value}>
        <ConversationView
          messages={[]}
          activeTools={[appTool()]}
          streamingText=""
          isThinking={false}
          ownDriverId={null}
        />
      </AppViewHostContext.Provider>,
    );

    const frame = await screen.findByTestId('app-view-frame');
    expect(screen.getAllByTestId('app-view-frame')).toHaveLength(1);
    const row = screen.getByRole('button', { name: /mcp__files__browse/ });
    expect(row.compareDocumentPosition(frame) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('reads nothing and frames nothing when the surface has no sandbox page', () => {
    const value = host({ sandboxUrl: undefined });
    renderConversation({ activeTools: [appTool()], value });

    expect(screen.getByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeTruthy();
    expect(document.querySelector('iframe')).toBeNull();
    expect(value.readAppView).not.toHaveBeenCalled();
  });

  it('does not show one, nor read one, for a call still running, whatever it announced', async () => {
    const value = host();
    renderConversation({ activeTools: [appTool({ status: 'running' })], value });

    await act(async () => {});
    expect(document.querySelector('iframe')).toBeNull();
    expect(screen.queryByText(APP_VIEW_UNAVAILABLE_TEXT)).toBeNull();
    expect(value.readAppView).not.toHaveBeenCalled();
  });
});
