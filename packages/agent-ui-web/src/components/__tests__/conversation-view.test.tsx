// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConversationView } from '../ConversationView.js';

import type { TConversationEntry } from '../../hooks/useSessionClient.js';

/**
 * #3289 §3 — the conversation is the page's `main` landmark, and a message's driver label reads in
 * plain words: nothing for a turn from the SAME KIND of surface as this connection's own, a plain
 * phrase naming the kind for a turn from a different one, and never the raw server-assigned driver id.
 * The server hands every WebSocket connection of one process the same id, so two tabs of one browser
 * cannot be told apart — the label therefore compares KINDS of surface (terminal, desktop app,
 * browser, remote device), not specific windows.
 */

function userMessage(content: string, author?: string): TConversationEntry {
  return { id: `m-${content}`, role: 'user', content, ...(author ? { author } : {}) };
}

beforeAll(() => {
  // jsdom has no layout; the conversation scrolls itself to the end after each render.
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);

describe('ConversationView is the page\'s main landmark', () => {
  it('renders a main element', () => {
    render(
      <ConversationView
        messages={[]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.getByRole('main')).toBeTruthy();
  });
});

describe('a message carries a driver label only when it came from a different kind of surface', () => {
  it('shows no label on this connection\'s own message (the legacy "owner" id)', () => {
    render(
      <ConversationView
        messages={[userMessage('hi', 'owner')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.getByText('hi')).toBeTruthy();
    expect(screen.queryByText(/from/)).toBeNull();
  });

  it('shows no label for a turn from the same kind of surface as this connection\'s own', () => {
    // Every WS connection of one `--serve` process learns the SAME driver id, so a second browser
    // tab's turns arrive with this connection's own literal id too — same kind, no label.
    render(
      <ConversationView
        messages={[userMessage('hi', 'browser')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId="browser"
      />,
    );
    expect(screen.queryByText(/from/)).toBeNull();
  });

  it('labels a turn from a different kind of surface, in plain words, never the raw driver id', () => {
    render(
      <ConversationView
        messages={[userMessage('hi', 'app')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId="browser"
      />,
    );
    expect(screen.getByText('from the desktop app')).toBeTruthy();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('labels the terminal while this window is the browser, as "from the terminal"', () => {
    render(
      <ConversationView
        messages={[userMessage('hi', 'attach:3')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId="browser"
      />,
    );
    expect(screen.getByText('from the terminal')).toBeTruthy();
  });

  it('labels the agent\'s own wake-up as "automatic", never "from automatic" — always, even though a browser connection could never learn it as its own id', () => {
    render(
      <ConversationView
        messages={[userMessage('hi', 'agent')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId="browser"
      />,
    );
    expect(screen.getByText('automatic')).toBeTruthy();
    expect(screen.queryByText(/from automatic/)).toBeNull();
  });
});
