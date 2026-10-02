// @vitest-environment jsdom
import { render } from '../../testing/product-provider.js';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConversationView } from '../ConversationView.js';

import type { IActiveTool, TConversationEntry } from '../../hooks/useSessionClient.js';

/**
 * #3289 §3 — the conversation is the page's `main` landmark, and a message's driver label reads in
 * plain words: nothing for a turn from the SAME KIND of surface as this connection's own, a plain
 * phrase naming the kind for a turn from a different one, and never the raw server-assigned driver id.
 * The server hands every WebSocket connection of one process the same id, so two tabs of one browser
 * cannot be told apart — the label therefore compares KINDS of surface (terminal, desktop app,
 * browser, remote device), not specific windows.
 *
 * #3288 — letting people review what the agent changed and ran: a tool row expands to its diff or
 * output, a turn's changed files get one summary row, internal/command-projection tools are shown
 * (or hidden) correctly, and a long path is never cut in the middle of the filename.
 */

// jsdom has no scroll implementation; ConversationView scrolls to the bottom on every update.
Element.prototype.scrollIntoView = (): void => {};

afterEach(() => cleanup());

function userMessage(content: string, author?: string): TConversationEntry {
  return { id: `m-${content}`, role: 'user', content, ...(author ? { author } : {}) };
}

function renderConversation(
  messages: readonly TConversationEntry[],
  ownDriverId: string | null = null,
): void {
  render(
    <ConversationView
      messages={messages}
      activeTools={[]}
      streamingText=""
      isThinking={false}
      ownDriverId={ownDriverId}
    />,
  );
}

function tool(overrides: Partial<IActiveTool>): IActiveTool {
  return { id: 't1', name: 'Read', status: 'done', ...overrides };
}

/** A `tools` entry renders as one collapsed group first; open it to reach the individual rows. */
function expandGroup(): void {
  fireEvent.click(screen.getByRole('button', { name: /tool call/ }));
}

/**
 * The individual tool row's OWN button, not the group's summary button — both can match the same
 * tool-name text once the group is open, so this always takes the last (innermost) match.
 */
function toolRowButton(name: RegExp): HTMLElement {
  const matches = screen.getAllByRole('button', { name });
  return matches[matches.length - 1]!;
}

describe('mixed tool observations', () => {
  it('shows registered attribution as inert text beside the linked call', () => {
    const text =
      'Tool source (attribution only, not authority): {"sourceId":"<script>fixture</script>","component":"save","origin":"fixture://installed","version":"1"}';
    renderConversation([
      {
        id: 'source',
        role: 'tools',
        tools: [
          tool({
            name: 'fixture__observe',
            executionId: 'call-source',
            toolResultData: 'saved',
            toolResultParts: [{ type: 'text', text }],
          }),
        ],
      },
    ]);
    expandGroup();
    fireEvent.click(toolRowButton(/fixture__observe/));
    expect(screen.getByText(/Tool source.*fixture/)).toBeTruthy();
    expect(screen.getByText('call-source')).toBeTruthy();
    expect(document.querySelector('script')).toBeNull();
  });
  it('keeps structured-only observations visible without requiring a media part', () => {
    renderConversation([
      {
        id: 'structured',
        role: 'tools',
        tools: [
          tool({
            name: 'fixture__observe',
            toolResultData: '{"revision":7}',
          }),
        ],
      },
    ]);
    expandGroup();
    fireEvent.click(toolRowButton(/fixture__observe/));
    expect(screen.getByText('{"revision":7}')).toBeTruthy();
  });

  it('shows text, inline raster and structured output together while keeping URIs inert', () => {
    renderConversation([
      {
        id: 'mixed',
        role: 'tools',
        tools: [
          tool({
            name: 'fixture__observe',
            executionId: 'call-7',
            toolResultData: '{"output":"observed","revision":7}',
            toolResultParts: [
              { type: 'text', text: 'Observed state' },
              { type: 'image_inline', mimeType: 'image/png', data: 'iVBORw0KGgo=' },
              { type: 'resource_link', uri: 'https://untrusted.invalid/receipt', name: 'receipt' },
              { type: 'image_uri', uri: 'https://untrusted.invalid/image' },
              {
                type: 'resource_embedded',
                uri: 'fixture:note',
                text: '<script>untrusted()</script>',
              },
            ],
          }),
        ],
      },
    ]);
    expandGroup();
    fireEvent.click(toolRowButton(/fixture__observe/));
    expect(screen.getByText('Observed state')).toBeTruthy();
    expect(screen.getByText('{"output":"observed","revision":7}')).toBeTruthy();
    expect(screen.getByText('call-7')).toBeTruthy();
    expect(screen.getByRole('img').getAttribute('src')).toBe('data:image/png;base64,iVBORw0KGgo=');
    expect(screen.getByText('https://untrusted.invalid/receipt')).toBeTruthy();
    expect(screen.getByText('https://untrusted.invalid/image')).toBeTruthy();
    expect(screen.getByText('<script>untrusted()</script>')).toBeTruthy();
    expect(document.querySelector('a[href], script, img[src^="https:"]')).toBeNull();
  });

  it('diagnoses unsupported inline media without fetching or rendering active content', () => {
    renderConversation([
      {
        id: 'unsafe',
        role: 'tools',
        tools: [
          tool({
            toolResultParts: [
              { type: 'image_inline', mimeType: 'image/svg+xml', data: 'PHN2Zz4=' },
              { type: 'audio_inline', mimeType: 'audio/wav', data: 'AA==' },
            ],
          }),
        ],
      },
    ]);
    expandGroup();
    fireEvent.click(toolRowButton(/Read/));
    expect(screen.getByText(/image\/svg\+xml/)).toBeTruthy();
    expect(screen.getByText(/audio\/wav/)).toBeTruthy();
    expect(document.querySelector('img, audio, iframe, object')).toBeNull();
  });
});

describe("ConversationView is the page's main landmark", () => {
  it('renders a main element', () => {
    renderConversation([]);
    expect(screen.getByRole('main')).toBeTruthy();
  });
});

describe('a message carries a driver label only when it came from a different kind of surface', () => {
  it('shows no label on this connection\'s own message (the legacy "owner" id)', () => {
    renderConversation([userMessage('hi', 'owner')]);
    expect(screen.getByText('hi')).toBeTruthy();
    expect(screen.queryByText(/from/)).toBeNull();
  });

  it("shows no label for a turn from the same kind of surface as this connection's own", () => {
    // Every WS connection of one `--serve` process learns the SAME driver id, so a second browser
    // tab's turns arrive with this connection's own literal id too — same kind, no label.
    renderConversation([userMessage('hi', 'browser')], 'browser');
    expect(screen.queryByText(/from/)).toBeNull();
  });

  it('labels a turn from a different kind of surface, in plain words, never the raw driver id', () => {
    renderConversation([userMessage('hi', 'app')], 'browser');
    expect(screen.getByText('from the desktop app')).toBeTruthy();
    expect(screen.queryByText('app')).toBeNull();
  });

  it('labels the terminal while this window is the browser, as "from the terminal"', () => {
    renderConversation([userMessage('hi', 'attach:3')], 'browser');
    expect(screen.getByText('from the terminal')).toBeTruthy();
  });

  it('labels the agent\'s own wake-up as "Automatic — loop" (#3288 §1), never "from automatic" — always, even though a browser connection could never learn it as its own id', () => {
    renderConversation([userMessage('hi', 'agent')], 'browser');
    expect(screen.getByText('Automatic — loop')).toBeTruthy();
    expect(screen.queryByText(/from automatic/)).toBeNull();
  });
});

describe('#3288: expandable tool rows', () => {
  it('an Edit row expands to show its diff', () => {
    renderConversation([
      {
        id: 'g1',
        role: 'tools',
        tools: [
          tool({
            id: 'edit-1',
            name: 'Edit',
            diffFile: 'src/a.ts',
            diffLines: [
              { type: 'remove', text: 'old line', lineNumber: 1 },
              { type: 'add', text: 'new line', lineNumber: 1 },
            ],
          }),
        ],
      },
    ]);
    // Collapsed by default: diff text is not yet in the document.
    expect(screen.queryByText(/new line/)).toBeNull();
    expandGroup();
    fireEvent.click(toolRowButton(/Edit/));
    expect(screen.getByText(/new line/)).toBeTruthy();
    expect(screen.getByText(/old line/)).toBeTruthy();
  });

  it('a Shell row expands to show output and exit status', () => {
    renderConversation([
      {
        id: 'g1',
        role: 'tools',
        tools: [
          tool({
            id: 'sh-1',
            name: 'Bash',
            input: 'pnpm test',
            toolResultData: JSON.stringify({ success: true, output: 'all good', exitCode: 0 }),
          }),
        ],
      },
    ]);
    expandGroup();
    fireEvent.click(toolRowButton(/Bash/));
    expect(screen.getByText('all good')).toBeTruthy();
    expect(screen.getByText(/exit 0/)).toBeTruthy();
  });

  it('a row with neither a diff nor output has no expand affordance', () => {
    renderConversation([
      { id: 'g1', role: 'tools', tools: [tool({ id: 'r1', name: 'Read', input: 'a.ts' })] },
    ]);
    expandGroup();
    expect(toolRowButton(/Read/).hasAttribute('disabled')).toBe(true);
  });
});

describe('#3288: paths are never truncated mid-filename', () => {
  it('shows the full filename even for a very long directory path', () => {
    const longPath =
      'packages/agent-ui-web/src/components/very/deeply/nested/directory/structure/goes/here/ConversationView.tsx';
    renderConversation([
      {
        id: 'g1',
        role: 'tools',
        tools: [tool({ id: 'r1', name: 'Read', displayPath: longPath })],
      },
    ]);
    expandGroup();
    expect(screen.getByText(/ConversationView\.tsx$/)).toBeTruthy();
  });
});

describe('#3288: internal tools and command projections', () => {
  it('hides the internal goal-signal tool entirely', () => {
    renderConversation([
      {
        id: 'g1',
        role: 'tools',
        tools: [tool({ id: 'goal-1', name: 'report_goal_status', internal: true })],
      },
    ]);
    expect(screen.queryByText('report_goal_status')).toBeNull();
  });

  it('renders a projected command tool as "Ran /<name>"', () => {
    renderConversation([
      {
        id: 'g1',
        role: 'tools',
        tools: [tool({ id: 'cmd-1', name: 'command_agent', commandName: 'agent' })],
      },
    ]);
    expandGroup();
    expect(screen.getByText('Ran /agent')).toBeTruthy();
    expect(screen.queryByText('command_agent')).toBeNull();
  });

  it('a group of only-internal tools renders nothing', () => {
    renderConversation([
      {
        id: 'g1',
        role: 'tools',
        tools: [tool({ id: 'goal-1', name: 'report_goal_status', internal: true })],
      },
      { id: 'm1', role: 'assistant', content: 'done' },
    ]);
    expect(screen.getByText('done')).toBeTruthy();
    expect(screen.queryByText(/tool call/)).toBeNull();
  });
});

describe('#3288: Changed files summary row', () => {
  it('lists each changed file with +N/-M, and a click opens its diff', () => {
    renderConversation([
      {
        id: 'cf1',
        role: 'changed-files',
        files: [
          {
            path: 'src/a.ts',
            added: 2,
            removed: 1,
            diffLines: [{ type: 'add', text: 'hello world', lineNumber: 1 }],
          },
        ],
      },
    ]);
    expect(screen.getByText('src/a.ts')).toBeTruthy();
    expect(screen.getByText('+2')).toBeTruthy();
    expect(screen.getByText('-1')).toBeTruthy();
    expect(screen.queryByText(/hello world/)).toBeNull();
    fireEvent.click(screen.getByText('src/a.ts'));
    expect(screen.getByText(/hello world/)).toBeTruthy();
  });
});

describe('#3288: chronology — tool rows render where they happened relative to the text', () => {
  it('renders entries in the order the conversation array carries them', () => {
    renderConversation([
      { id: 'm1', role: 'assistant', content: 'checking first' },
      { id: 'g1', role: 'tools', tools: [tool({ id: 'r1', name: 'Read', input: 'a.ts' })] },
      { id: 'm2', role: 'assistant', content: 'done now' },
    ]);
    const container = screen.getByText('checking first').closest('.agent-ui');
    const text = container?.textContent ?? '';
    expect(text.indexOf('checking first')).toBeLessThan(text.indexOf('Read'));
    expect(text.indexOf('Read')).toBeLessThan(text.indexOf('done now'));
  });
});
