/**
 * SEC-019 (issue #2022) — what actually reaches the terminal, measured rather than assumed.
 *
 * ## The oracle, and why it is not `lastFrame()`
 *
 * The first version of this file asserted against `ink-testing-library`'s `lastFrame()`. That is not
 * what the terminal receives. Ink strips most control sequences on its way out — a side effect of
 * slicing text for layout, not a documented guarantee — so a frame assertion is green whether the
 * code sanitizes or not, for every sequence Ink happens to remove. Mutation exposed it: removing the
 * sanitization from three call sites left every frame-based case passing.
 *
 * So these tests render through REAL Ink into a fake TTY and read the bytes it writes.
 *
 * ## What Ink removes and what it does not — measured on this dependency version
 *
 *   stripped   OSC 52 (clipboard), OSC 0 (title), CSI erase/cursor/alt-screen, DCS, APC, 8-bit CSI
 *   REACHES    SGR colour, OSC 8 hyperlink, a bare carriage return
 *
 * The two that reach are the live attack surface through `<Text>`: a link whose visible text and
 * target differ, and a CR that overwrites the line the transcript just printed. `useTerminalTitle`
 * writes to stdout directly and is subject to none of Ink's filtering.
 *
 * The sanitizer covers the whole class anyway, and the reason is the measurement itself: Ink's
 * stripping is incidental. It is not in Ink's contract, no test of Ink's asserts it, and a dependency
 * upgrade can return the entire class silently. A security boundary that rests on another project's
 * implementation detail is a boundary in name.
 */

import { render as inkRender, Text } from 'ink';
import React from 'react';
import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';

import { createToolMessage, messageToHistoryEntry } from '@robota-sdk/agent-core';

import MessageList from '../MessageList.js';
import StreamingIndicator from '../StreamingIndicator.js';

import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type { IToolState } from '@robota-sdk/agent-interface-session';

const ESC = String.fromCharCode(27);
const BEL = String.fromCharCode(7);

/** OSC 8 renders a link whose visible text and target differ — and Ink passes it through. */
const LINK_MARKER = 'pwn-link-marker-8f3a';
const DECEPTIVE_LINK = `${ESC}]8;;https://evil.example/${LINK_MARKER}${BEL}`;
/** A bare CR returns the cursor to column zero and overwrites what was printed. */
const OVERWRITE = `\rpwn-overwrite-4c1e`;
/** Stripped by this Ink version; included because the sanitizer must not depend on that. */
const CLIPBOARD_WRITE = `${ESC}]52;c;cG93bmVk${BEL}`;
const ERASE_DISPLAY = `${ESC}[2J`;

const POISON = `${CLIPBOARD_WRITE}${DECEPTIVE_LINK}${ERASE_DISPLAY}${OVERWRITE}`;

/** The markers whose presence in the byte stream proves the payload reached the terminal. */
function carriesPayload(stream: string): boolean {
  return (
    stream.includes(LINK_MARKER) ||
    // The CR immediately before the marker, not the marker alone: once the CR is gone the words are
    // ordinary content and printing them is correct. Asserting on the text would have failed a
    // correct sanitizer, which is the mirror of asserting on nothing.
    stream.includes(OVERWRITE) ||
    stream.includes('52;c;cG93bmVk') ||
    stream.includes(`${ESC}]52`) ||
    stream.includes(`${ESC}[2J`)
  );
}

/** Every byte Ink writes for one render, through a stream that claims to be a terminal. */
async function streamOf(element: React.ReactElement): Promise<string> {
  const chunks: string[] = [];
  const stdout = new Writable({
    write(chunk, _encoding, done) {
      chunks.push(String(chunk));
      done();
    },
  }) as unknown as NodeJS.WriteStream;
  Object.assign(stdout, { isTTY: true, columns: 80, rows: 24 });
  const app = inkRender(element, { stdout, patchConsole: false });
  await new Promise((resolve) => setTimeout(resolve, 40));
  app.unmount();
  return chunks.join('');
}

const toolEntry = (content: string): IHistoryEntry =>
  messageToHistoryEntry(
    createToolMessage(content, { toolCallId: 'call-1', name: `Read${POISON}` }),
  );

const eventEntry = (id: string, type: string, data: unknown): IHistoryEntry =>
  ({ id, timestamp: new Date(), category: 'event', type, data }) as unknown as IHistoryEntry;

describe('SEC-019 — the terminal stream carries no payload from poisoned session data', () => {
  it('the oracle is not vacuous: an unsanitized render DOES leak', async () => {
    // Without this the whole file passes for a `carriesPayload` that always answers false, and for
    // an Ink that removed everything. It also pins WHY this module exists: if this case ever goes
    // green, Ink's own behaviour changed and the threat model needs re-reading — that is a signal
    // worth a failing test, not a false alarm.
    const stream = await streamOf(<Text>{`before${POISON}after`}</Text>);
    expect(carriesPayload(stream), JSON.stringify(stream)).toBe(true);
  });

  it('MessageList: structured tool summary branch (the branch review found unguarded)', async () => {
    const stream = await streamOf(
      <MessageList history={[toolEntry(JSON.stringify([{ line: 'read ok' }]))]} />,
    );
    expect(stream).toContain('Read');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('MessageList: plain-text tool branch', async () => {
    const stream = await streamOf(<MessageList history={[toolEntry(`not json ${POISON}`)]} />);
    expect(stream).toContain('Read');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('MessageList: the tool-summary event label, name and first argument both', async () => {
    const stream = await streamOf(
      <MessageList
        history={[
          eventEntry('evt-1', 'tool-summary', {
            tools: [
              {
                toolName: `Read${POISON}`,
                firstArg: `file.ts${POISON}`,
                isRunning: false,
                result: 'success',
              },
            ],
            summary: `✓ Read(file.ts)${POISON}`,
          }),
        ]}
      />,
    );
    expect(stream).toContain('Read');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('MessageList: an event entry message (skill activation, memory topic)', async () => {
    const stream = await streamOf(
      <MessageList
        history={[
          eventEntry('evt-2', 'skill-activation', {
            message: `Invoking plugin skill: ${POISON}`,
          }),
        ]}
      />,
    );
    expect(stream).toContain('Invoking plugin skill');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('MessageList: an event entry that carries content instead of message', async () => {
    const stream = await streamOf(
      <MessageList history={[eventEntry('evt-3', 'note', { content: `note ${POISON}` })]} />,
    );
    expect(stream).toContain('note');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('MessageList: the tool-summary fallback lines, taken when the entry lists no tools', async () => {
    const stream = await streamOf(
      <MessageList
        history={[eventEntry('evt-4', 'tool-summary', { summary: `line one ${POISON}\nline two` })]}
      />,
    );
    expect(stream).toContain('line one');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('MessageList: command output preview lines, which are raw stdout', async () => {
    const stream = await streamOf(
      <MessageList
        history={[
          eventEntry('evt-5', 'tool-summary', {
            tools: [
              {
                toolName: 'Shell',
                firstArg: 'ls',
                result: 'error',
                toolResultData: JSON.stringify({ exitCode: 1, stdout: `oops ${POISON}` }),
              },
            ],
            summary: '',
          }),
        ]}
      />,
    );
    expect(stream).toContain('oops');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('StreamingIndicator: the live tool line, name and first argument both', async () => {
    const tools = [
      { toolName: `Read${POISON}`, firstArg: `file.ts${POISON}`, isRunning: true },
    ] as unknown as IToolState[];
    const stream = await streamOf(<StreamingIndicator text="" activeTools={tools} />);
    expect(stream).toContain('Read');
    expect(carriesPayload(stream)).toBe(false);
  });

  it('StreamingIndicator: the streamed assistant text', async () => {
    const stream = await streamOf(<StreamingIndicator text={`hello ${POISON}`} activeTools={[]} />);
    expect(carriesPayload(stream)).toBe(false);
  });
});
