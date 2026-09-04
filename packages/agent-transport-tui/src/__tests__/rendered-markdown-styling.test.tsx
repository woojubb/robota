/**
 * SCREEN-006 × #2222: the markdown renderer's own SGR must SURVIVE to the frame.
 *
 * `renderMarkdown` sanitizes untrusted markdown BEFORE `marked-terminal` styles it, so the escape
 * codes in its OUTPUT are this package's own — the `tui-ansi-palette` diff pairs, heading emphasis.
 * Routing that output back through `SafeText` sanitizes it a second time and strips exactly those
 * codes, and it does so silently: the text still renders, just colourless. Every assertion in
 * `streaming-indicator.test.tsx` and the tool-diff suite is on TEXT, so all of them stay green
 * while the colour is gone — which is how the regression reached a release.
 *
 * These are the assertions that go red for that, one per render site that renders markdown.
 */

import React from 'react';
import { render } from 'ink-testing-library';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import StreamingIndicator from '../StreamingIndicator.js';
import ToolDiffBlock from '../ToolDiffBlock.js';
import { ANSI } from '../tui-ansi-palette.js';

import type { IDiffLine } from '@robota-sdk/agent-interface-session';

const DIFF_LINES: IDiffLine[] = [
  { type: 'hunk', text: '@@ -1,2 +1,2 @@', lineNumber: 1 },
  { type: 'remove', text: 'const a = 1;', lineNumber: 1 },
  { type: 'add', text: 'const a = 2;', lineNumber: 1 },
];

const DIFF_MARKDOWN = [
  '```diff',
  '@@ -1,2 +1,2 @@',
  '- const a = 1;',
  '+ const a = 2;',
  '```',
].join('\n');

describe('markdown styling survives the render site (SCREEN-006)', () => {
  let originalForceColor: string | undefined;

  beforeEach(() => {
    // `renderMarkdown` colours only for an interactive colour terminal; the test process is not one.
    originalForceColor = process.env.FORCE_COLOR;
    process.env.FORCE_COLOR = '1';
  });

  afterEach(() => {
    if (originalForceColor === undefined) delete process.env.FORCE_COLOR;
    else process.env.FORCE_COLOR = originalForceColor;
  });

  it('ToolDiffBlock keeps the added/removed diff colours', () => {
    const { lastFrame } = render(<ToolDiffBlock file="src/a.ts" lines={DIFF_LINES} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('const a = 2;');
    expect(frame).toContain(ANSI.lightGreen);
    expect(frame).toContain(ANSI.lightRed);
    expect(frame).toContain(ANSI.cyan); // the @@ hunk header
  });

  it('StreamingIndicator keeps the colours of a diff block in streamed text', () => {
    const { lastFrame } = render(<StreamingIndicator text={DIFF_MARKDOWN} activeTools={[]} />);
    const frame = lastFrame() ?? '';

    expect(frame).toContain('const a = 2;');
    expect(frame).toContain(ANSI.lightGreen);
    expect(frame).toContain(ANSI.lightRed);
  });

  it('StreamingIndicator still sanitizes what arrives from OUTSIDE the renderer', () => {
    // The other direction of the same boundary: `renderMarkdown` sanitizes its INPUT, so an escape
    // sequence in the model's text is gone before `marked-terminal` ever sees it. Switching this
    // site to `RenderedText` must not reopen that.
    const { lastFrame } = render(
      <StreamingIndicator text={`before]8;;https://evil.exampleclick]8;;after`} activeTools={[]} />,
    );
    const frame = lastFrame() ?? '';

    expect(frame).not.toContain('evil.example');
    expect(frame).not.toContain(']8;;');
    expect(frame).toContain('before');
  });
});
