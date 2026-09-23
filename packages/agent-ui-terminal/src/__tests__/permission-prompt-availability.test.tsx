import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';

import PermissionPrompt from '../PermissionPrompt.js';

describe('project permission availability in the terminal', () => {
  it('labels the project choice unavailable before selection', () => {
    const frame = render(
      <PermissionPrompt
        request={{
          toolName: 'Bash',
          toolArgs: { command: 'git status' },
          canPersistProjectPermission: false,
          resolve: () => {},
        }}
      />,
    ).lastFrame();

    expect(frame).toContain('Project-wide approval unavailable');
    expect(frame).not.toContain('always (this project)');
  });
});
