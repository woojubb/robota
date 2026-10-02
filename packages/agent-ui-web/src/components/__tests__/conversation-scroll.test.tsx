// @vitest-environment jsdom
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConversationView } from '../ConversationView.js';

/**
 * #3289 §2 — auto-scroll follows new content only while the person is at the bottom (within ~80px of
 * it); scrolling up stops it, and a "Jump to latest" button appears whenever the view is not at the
 * bottom and a reply is streaming, or new content has arrived below the viewport. `scrollTop` /
 * `scrollHeight` / `clientHeight` are mocked here — jsdom has no real layout, so nothing computes them.
 */

function setMetrics(el: HTMLElement, scrollTop: number, scrollHeight: number, clientHeight: number): void {
  Object.defineProperty(el, 'scrollTop', { configurable: true, value: scrollTop, writable: true });
  Object.defineProperty(el, 'scrollHeight', { configurable: true, value: scrollHeight, writable: true });
  Object.defineProperty(el, 'clientHeight', { configurable: true, value: clientHeight, writable: true });
}

function scroller(): HTMLElement {
  return screen.getByRole('main');
}

afterEach(cleanup);

describe('ConversationView — scroll pinning while streaming (#3289 §2)', () => {
  it('stays pinned to the bottom while streaming, as long as the person has not scrolled up', () => {
    const { rerender } = render(
      <ConversationView messages={[]} activeTools={[]} streamingText="" isThinking={false} ownDriverId={null} />,
    );
    const el = scroller();
    setMetrics(el, 0, 400, 400); // already at the bottom: 400 - 0 - 400 === 0

    rerender(
      <ConversationView messages={[]} activeTools={[]} streamingText="hello" isThinking ownDriverId={null} />,
    );

    expect(el.scrollTop).toBe(el.scrollHeight);
    expect(screen.queryByText('Jump to latest')).toBeNull();
  });

  it('scrolling up during streaming stops pinning: a later chunk does not pull the view back down', () => {
    const { rerender } = render(
      <ConversationView messages={[]} activeTools={[]} streamingText="hello" isThinking ownDriverId={null} />,
    );
    const el = scroller();
    // Scrolled well away from the bottom (distance 1000 - 100 - 400 = 500 > 80).
    setMetrics(el, 100, 1000, 400);
    fireEvent.scroll(el);
    expect(screen.getByText('Jump to latest')).toBeTruthy();

    rerender(
      <ConversationView
        messages={[]}
        activeTools={[]}
        streamingText="hello there, more text"
        isThinking
        ownDriverId={null}
      />,
    );

    // The view stayed exactly where the person put it.
    expect(el.scrollTop).toBe(100);
    expect(screen.getByText('Jump to latest')).toBeTruthy();
  });

  it('"Jump to latest" appears while scrolled away during streaming, and clicking it resumes pinning', () => {
    const { rerender } = render(
      <ConversationView messages={[]} activeTools={[]} streamingText="hello" isThinking ownDriverId={null} />,
    );
    const el = scroller();
    setMetrics(el, 100, 1000, 400);
    fireEvent.scroll(el);
    const jump = screen.getByRole('button', { name: /Jump to latest/ });

    fireEvent.click(jump);

    expect(el.scrollTop).toBe(el.scrollHeight);
    expect(screen.queryByRole('button', { name: /Jump to latest/ })).toBeNull();

    // Pinning resumed: further streamed content keeps following the bottom.
    setMetrics(el, el.scrollTop, 1300, 400);
    rerender(
      <ConversationView
        messages={[]}
        activeTools={[]}
        streamingText="hello there, even more"
        isThinking
        ownDriverId={null}
      />,
    );
    expect(el.scrollTop).toBe(1300);
  });

  it('returning to the bottom by hand resumes pinning', () => {
    const { rerender } = render(
      <ConversationView messages={[]} activeTools={[]} streamingText="hello" isThinking ownDriverId={null} />,
    );
    const el = scroller();
    setMetrics(el, 100, 1000, 400);
    fireEvent.scroll(el);
    expect(screen.getByText('Jump to latest')).toBeTruthy();

    // The person scrolls back down to the bottom themselves.
    setMetrics(el, 600, 1000, 400); // distance 1000 - 600 - 400 === 0
    fireEvent.scroll(el);
    expect(screen.queryByText('Jump to latest')).toBeNull();

    setMetrics(el, 600, 1200, 400);
    rerender(
      <ConversationView
        messages={[]}
        activeTools={[]}
        streamingText="hello there again"
        isThinking
        ownDriverId={null}
      />,
    );
    expect(el.scrollTop).toBe(1200);
  });

  it('shows no "Jump to latest" button before the person has ever scrolled away', () => {
    render(
      <ConversationView messages={[]} activeTools={[]} streamingText="" isThinking={false} ownDriverId={null} />,
    );
    expect(screen.queryByText('Jump to latest')).toBeNull();
  });

  it('does not resurrect "Jump to latest" on a later scroll-up once the person is back at the bottom and idle', () => {
    const { rerender } = render(
      <ConversationView messages={[]} activeTools={[]} streamingText="hello" isThinking ownDriverId={null} />,
    );
    const el = scroller();

    // Scrolled away mid-stream: new content below arrives while not at the bottom.
    setMetrics(el, 100, 1000, 400);
    fireEvent.scroll(el);
    expect(screen.getByText('Jump to latest')).toBeTruthy();

    // The reply finishes while still scrolled away — "Jump to latest" stays up for the finished message.
    setMetrics(el, 100, 1100, 400);
    rerender(
      <ConversationView
        messages={[{ id: 'm1', role: 'assistant', content: 'hello there' }]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    expect(screen.getByText('Jump to latest')).toBeTruthy();

    // The person scrolls all the way back down themselves (not via the button).
    setMetrics(el, 700, 1100, 400); // distance 1100 - 700 - 400 === 0
    fireEvent.scroll(el);
    expect(screen.queryByText('Jump to latest')).toBeNull();

    // They scroll up again to reread earlier history. Nothing new has arrived and nothing is
    // streaming, so the button must not reappear — it would have nothing to jump to.
    setMetrics(el, 200, 1100, 400);
    fireEvent.scroll(el);
    expect(screen.queryByText('Jump to latest')).toBeNull();
  });
});
