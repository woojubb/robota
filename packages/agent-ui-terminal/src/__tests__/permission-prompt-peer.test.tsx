import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import PermissionPrompt from '../PermissionPrompt.js';

describe('a permission asked for in a peer turn', () => {
  it('names the session whose message the call is serving, and shows the full reply', () => {
    const text = 'The project is called Lumen and its token budget is 4096.';
    const frame = render(
      <PermissionPrompt
        request={{
          toolName: 'peer_reply',
          toolArgs: { text },
          requestedByPeer: 'peer:session-a',
          resolve: () => {},
        }}
      />,
    ).lastFrame();

    expect(frame).toContain('peer:session-a');
    expect(frame?.replace(/\s+/g, ' ')).toContain(text);
  });

  it('says nothing about a peer for the operator’s own call', () => {
    const frame = render(
      <PermissionPrompt
        request={{ toolName: 'Bash', toolArgs: { command: 'ls' }, resolve: () => {} }}
      />,
    ).lastFrame();

    expect(frame).not.toContain('peer');
  });
});
