import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import PermissionPrompt from '../PermissionPrompt.js';

describe('issue #3288 §1: a background agent names itself on its own permission request', () => {
  it('says which background agent is asking, instead of an unattributed prompt', () => {
    const frame = render(
      <PermissionPrompt
        request={{
          toolName: 'Glob',
          toolArgs: { pattern: '**/*' },
          requester: { kind: 'background-agent', label: 'general-purpose', taskId: 'agent_1' },
          resolve: () => {},
        }}
      />,
    ).lastFrame();

    expect(frame).toContain('Background agent');
    expect(frame).toContain('general-purpose');
    expect(frame).toContain('Glob');
  });

  it('reads as an ordinary ask when no requester is present', () => {
    const frame = render(
      <PermissionPrompt
        request={{ toolName: 'Bash', toolArgs: { command: 'ls' }, resolve: () => {} }}
      />,
    ).lastFrame();

    expect(frame).not.toContain('Background agent');
  });
});
