import { describe, expect, it } from 'vitest';

import { collectHookRegistrationFacts } from '../hook-registration-facts.mjs';

describe('collectHookRegistrationFacts', () => {
  it('preserves one fact for each command registration instead of collapsing a shared source file', () => {
    const facts = collectHookRegistrationFacts({
      hooks: {
        PreToolUse: [
          {
            matcher: 'Bash',
            hooks: [
              {
                command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/bulk-edit-guard.sh --bash',
              },
            ],
          },
          {
            matcher: 'Edit|Write',
            hooks: [
              {
                command: '"$CLAUDE_PROJECT_DIR"/.claude/hooks/bulk-edit-guard.sh --edit',
              },
            ],
          },
        ],
      },
    });

    expect(facts).toEqual([
      {
        event: 'PreToolUse',
        matcher: 'Bash',
        commandPath: 'bulk-edit-guard.sh',
        occurrence: 1,
        sourceId: 'bulk-edit-guard.sh',
      },
      {
        event: 'PreToolUse',
        matcher: 'Edit|Write',
        commandPath: 'bulk-edit-guard.sh',
        occurrence: 1,
        sourceId: 'bulk-edit-guard.sh',
      },
    ]);
  });
});
