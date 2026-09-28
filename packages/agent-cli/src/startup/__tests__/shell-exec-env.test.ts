import { describe, expect, it } from 'vitest';

import { runShellCommand } from '../shell-exec.js';

describe.runIf(process.platform !== 'win32')('runShellCommand', () => {
  it('adds the given variables to the command’s environment for the shell to expand', () => {
    expect(
      runShellCommand('printf %s "$CLAUDE_SKILL_DIR"', { CLAUDE_SKILL_DIR: '/skills/a' }),
    ).toBe('/skills/a');
  });

  it('keeps the rest of the environment', () => {
    expect(runShellCommand('printf %s "$PATH"', { CLAUDE_SKILL_DIR: '/x' })).toBe(
      process.env.PATH ?? '',
    );
  });
});
