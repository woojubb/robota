// @vitest-environment jsdom
import { render } from '../../testing/product-provider.js';
import { cleanup, screen } from '@testing-library/react';
import React from 'react';
import { afterEach, describe, expect, it } from 'vitest';

import { ConversationView } from '../ConversationView.js';

import type { TConversationEntry } from '../../hooks/useSessionClient.js';

/**
 * #3289 §2 — a command's outcome card reads as normal text (proportional font, normal size), not
 * terminal monospace, unless it is an actual long listing (the same measure the card already uses to
 * decide whether to fold: many raw lines), which stays monospace so columns still line up.
 */

function commandEntry(content: string, name = 'mode'): TConversationEntry {
  return { id: `c-${name}`, role: 'command', name, content, tone: 'success' };
}

afterEach(cleanup);

describe('CommandCard text style (#3289 §2)', () => {
  it('a short outcome reads as normal proportional text, not monospace', () => {
    render(
      <ConversationView
        messages={[commandEntry('Permission mode: acceptEdits')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    const card = screen.getByTestId('command-output');
    const body = card.querySelector('pre') as HTMLPreElement;
    expect(body.className).toContain('font-sans');
    expect(body.className).not.toContain('font-mono');
  });

  it('a long listing (many raw lines) stays monospace so its columns still line up', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `Command ${i + 1} (/c${i + 1})`);
    render(
      <ConversationView
        messages={[commandEntry(lines.join('\n'), 'help')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    const card = screen.getByTestId('command-output');
    const body = card.querySelector('pre') as HTMLPreElement;
    expect(body.className).toContain('font-mono');
  });

  it('the command header (the /name label) stays monospace either way', () => {
    render(
      <ConversationView
        messages={[commandEntry('ok')]}
        activeTools={[]}
        streamingText=""
        isThinking={false}
        ownDriverId={null}
      />,
    );
    const header = screen.getByText('/mode');
    expect(header.className).toContain('font-mono');
  });
});
