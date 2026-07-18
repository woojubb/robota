import { describe, it, expect } from 'vitest';

import { SettingsSchema } from '../config-types.js';

/**
 * SELFHOST-005 — a `{ type: 'guardrail' }` hook must be accepted by the settings schema. Before the
 * guardrail variant was added to the Zod discriminated union, such a hook failed `safeParse` and made
 * config loading HARD-THROW; this locks the config path open for guardrail hooks.
 */
describe('SELFHOST-005 — guardrail hook parses through the settings schema', () => {
  it('accepts a PreToolUse guardrail hook (no names = all)', () => {
    const result = SettingsSchema.safeParse({
      hooks: { PreToolUse: [{ matcher: '', hooks: [{ type: 'guardrail' }] }] },
    });
    expect(result.success).toBe(true);
  });

  it('accepts a guardrail hook with an explicit name list', () => {
    const result = SettingsSchema.safeParse({
      hooks: {
        PreToolUse: [{ matcher: '', hooks: [{ type: 'guardrail', guardrails: ['secrets'] }] }],
      },
    });
    expect(result.success).toBe(true);
  });

  it('still accepts the pre-existing command hook (no regression)', () => {
    const result = SettingsSchema.safeParse({
      hooks: {
        PreToolUse: [{ matcher: 'Bash', hooks: [{ type: 'command', command: 'echo ok' }] }],
      },
    });
    expect(result.success).toBe(true);
  });
});
