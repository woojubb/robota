// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { ConversationView } from '../ConversationView.js';

import type { TConversationEntry } from '../../hooks/useSessionClient.js';

/**
 * #3289 §3 — the conversation is the page's `main` landmark, and a message's driver label reads in
 * plain words: nothing for this connection's own turns, a human phrase for anyone else's, and never
 * the raw server-assigned driver id.
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

describe('a message carries a driver label only when it was not this connection\'s own', () => {
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

  it('shows no label once this connection has learned its own driver id', () => {
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

  it('labels a co-driver\'s message in plain words, never the raw driver id', () => {
    render(
      <ConversationView
        messages={[userMessage('hi', 'app')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId="browser"
      />,
    );
    expect(screen.getByText('from another window')).toBeTruthy();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('labels an attached-terminal message as "from the terminal"', () => {
    render(
      <ConversationView
        messages={[userMessage('hi', 'attach:3')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.getByText('from the terminal')).toBeTruthy();
  });

  it('labels the agent\'s own wake-up as "automatic", never "from automatic"', () => {
    render(
      <ConversationView
        messages={[userMessage('hi', 'agent')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.getByText('automatic')).toBeTruthy();
    expect(screen.queryByText(/from automatic/)).toBeNull();
  });
});
