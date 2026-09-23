import { describe, expect, it } from 'vitest';

import { FRAMEWORK_TOOL_PERMISSION_PROFILES } from '../tool-permission-profiles.js';

/**
 * CORE-049 (issue #2350) — the kind is declared WITH the key for every tool this package defines,
 * so a missing declaration is red here rather than a silent fallback to the string glob.
 */
describe('CORE-049 — this package declares the kind of every argument it scopes patterns to', () => {
  it('command tools are command-kind', () => {
    for (const tool of ['BackgroundProcess', 'ExecuteCommand']) {
      expect(FRAMEWORK_TOOL_PERMISSION_PROFILES[tool]?.argument?.kind, tool).toBe('command');
    }
  });
});
