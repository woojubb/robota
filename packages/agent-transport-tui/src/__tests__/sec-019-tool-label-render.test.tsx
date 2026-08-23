/**
 * SEC-019 (issue #2022) — the RENDERED FRAME carries no payload from a poisoned tool label.
 *
 * Round-3 review of PR #2212 found a tool name reaching `<Text>` unsanitized. The call had been
 * added — to one of the two branches in `MessageList` that show a tool name. Whenever a tool's
 * content happened to parse as a structured summary, the other branch ran and the name went through
 * raw. Three further sites had the same gap.
 *
 * Asserting "the call is present at every site" is the assertion that failed: it is a claim about
 * source text, and it is satisfied by a file where the call exists once. These tests ask the
 * question the defect actually answers — RENDER the component with every tool-shaped field poisoned,
 * and require that the payload is not in the frame. A new render site inside these components is
 * covered without anyone remembering to extend the test.
 *
 * What this does NOT cover, stated because the boundary matters: a component these tests do not
 * render. The floor is the components, not the package.
 */

import { render } from 'ink-testing-library';
import React from 'react';
import { describe, expect, it } from 'vitest';

import MessageList from '../MessageList.js';
import StreamingIndicator from '../StreamingIndicator.js';

import { createToolMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IToolState } from '@robota-sdk/agent-interface-transport';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** OSC 52 writes the system clipboard; its introducer and parameters are what must not survive. */
const CLIPBOARD_WRITE = `${ESC}]52;c;cG93bmVk${BEL}`;
/**
 * OSC 8 renders a link whose visible text and target differ.
 *
 * The target carries an opaque marker and the detector looks for THAT, not for the host. A
 * `frame.includes('https://evil.example')` reads as URL-substring sanitization to any analyser and
 * to any reader, and the objection is right even in a detector: a substring test on a URL is
 * unreliable in general, and a marker is both stricter here and not a claim about URLs.
 */
const LINK_MARKER = 'pwn-link-marker-8f3a';
const DECEPTIVE_LINK = `${ESC}]8;;https://evil.example/${LINK_MARKER}${BEL}`;
/** CSI erases the screen above the prompt. */
const ERASE_DISPLAY = `${ESC}[2J`;

const POISON = `${CLIPBOARD_WRITE}${DECEPTIVE_LINK}${ERASE_DISPLAY}`;

/**
 * The markers whose presence proves the payload reached the terminal.
 *
 * Not `hasTerminalControl`: the renderer emits ANSI of its own — colours, dim, bold — so a frame
 * legitimately contains ESC. The question is whether THIS payload's introducers and parameters are
 * in it, which is what a terminal would act on.
 */
function carriesPayload(frame: string): boolean {
  return (
    frame.includes(`${ESC}]52`) ||
    frame.includes(`${ESC}]8;;`) ||
    frame.includes(`${ESC}[2J`) ||
    frame.includes('52;c;cG93bmVk') ||
    frame.includes(LINK_MARKER)
  );
}

function frameOf(element: React.ReactElement): string {
  const { lastFrame, unmount } = render(element);
  const frame = lastFrame() ?? '';
  unmount();
  return frame;
}

describe('SEC-019 — a poisoned tool label never reaches the frame', () => {
  // Built through the real constructors, not a hand-written object literal. The first version of
  // these two cases used `category: 'message'`; MessageList dispatches on `'chat'`, so nothing
  // rendered and both cases passed WITH the fix reversed. The mutation is what exposed that — a
  // render test that renders nothing is green for the same reason a correct one is.
  const toolEntry = (content: string): IHistoryEntry =>
    messageToHistoryEntry(
      createToolMessage(content, { toolCallId: 'call-1', name: `Read${POISON}` }),
    );

  it('MessageList: structured tool summary branch (the branch review found unguarded)', () => {
    // The content parses as IToolCallSummary[], which is what selects the branch that rendered the
    // tool name through `humanizeToolName` alone.
    const frame = frameOf(
      <MessageList history={[toolEntry(JSON.stringify([{ line: 'read ok' }]))]} />,
    );
    expect(frame).toContain('Read');
    expect(carriesPayload(frame)).toBe(false);
  });

  it('MessageList: plain-text tool branch', () => {
    const frame = frameOf(<MessageList history={[toolEntry(`not json ${POISON}`)]} />);
    expect(frame).toContain('Read');
    expect(carriesPayload(frame)).toBe(false);
  });

  it('MessageList: the tool-summary event label, name and first argument both', () => {
    const entry: IHistoryEntry = {
      id: 'evt-1',
      timestamp: new Date(),
      category: 'event',
      type: 'tool-summary',
      data: {
        tools: [
          {
            toolName: `Read${POISON}`,
            firstArg: `file.ts${POISON}`,
            isRunning: false,
            result: 'success',
          },
        ],
        summary: `✓ Read(file.ts)${POISON}`,
      },
    } as unknown as IHistoryEntry;
    const frame = frameOf(<MessageList history={[entry]} />);
    expect(frame).toContain('Read');
    expect(carriesPayload(frame)).toBe(false);
  });

  it('StreamingIndicator: the live tool line, name and first argument both', () => {
    const tools: IToolState[] = [
      {
        toolName: `Read${POISON}`,
        firstArg: `file.ts${POISON}`,
        isRunning: true,
      } as unknown as IToolState,
    ];
    const frame = frameOf(<StreamingIndicator text="" activeTools={tools} />);
    expect(frame).toContain('Read');
    expect(carriesPayload(frame)).toBe(false);
  });

  it('StreamingIndicator: the streamed assistant text', () => {
    expect(
      carriesPayload(frameOf(<StreamingIndicator text={`hello ${POISON}`} activeTools={[]} />)),
    ).toBe(false);
  });

  it('the poison is detectable when nothing sanitizes it — the detector is not vacuous', () => {
    // Without this the whole file passes for a detector that always returns false.
    expect(carriesPayload(`before${POISON}after`)).toBe(true);
  });
});
