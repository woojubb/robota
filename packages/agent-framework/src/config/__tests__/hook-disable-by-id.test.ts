/**
 * Issue #2320 — a hook can be named (`id`) and disabled from an EARLIER, higher-trust layer
 * (`disabledHooks`); a later layer naming an earlier layer's guard changes nothing.
 *
 * Both halves of the issue's falsification: the user-level disable works, and the project-level
 * attempt on a user guard is refused — by construction, since the guard was merged before the
 * disable was read.
 */
import { describe, expect, it } from 'vitest';

import { mergeSettings } from '../config-merge.js';
import { SettingsSchema } from '../config-types.js';

import type { TEnvResolvedSettings } from '../config-types.js';

const guard = {
  id: 'user-guard',
  matcher: '',
  hooks: [{ type: 'command' as const, command: 'g' }],
};
const lint = {
  id: 'project-lint',
  matcher: '',
  hooks: [{ type: 'command' as const, command: 'l' }],
};
const anonymous = { matcher: '', hooks: [{ type: 'command' as const, command: 'a' }] };

function groupIds(settings: TEnvResolvedSettings): Array<string | undefined> {
  return (settings.hooks?.PreToolUse ?? []).map((group) => group.id);
}

describe('hook disable by id (issue #2320)', () => {
  it('a user layer disables a named project hook', () => {
    const user: TEnvResolvedSettings = { disabledHooks: ['project-lint'] };
    const project: TEnvResolvedSettings = { hooks: { PreToolUse: [lint, anonymous] } };
    expect(groupIds(mergeSettings([user, project]))).toEqual([undefined]);
  });

  it('a project layer cannot disable a user guard merged before it', () => {
    const user: TEnvResolvedSettings = { hooks: { PreToolUse: [guard] } };
    const project: TEnvResolvedSettings = {
      disabledHooks: ['user-guard'],
      hooks: { PreToolUse: [lint] },
    };
    expect(groupIds(mergeSettings([user, project]))).toEqual(['user-guard', 'project-lint']);
  });

  it('a disable persists across every later layer', () => {
    const user: TEnvResolvedSettings = { disabledHooks: ['project-lint'] };
    const project: TEnvResolvedSettings = { hooks: { PreToolUse: [lint] } };
    const local: TEnvResolvedSettings = { hooks: { PreToolUse: [lint] } };
    expect(groupIds(mergeSettings([user, project, local]))).toEqual([]);
  });

  it('the schema accepts an id and a disabledHooks list, and a group without either', () => {
    expect(
      SettingsSchema.safeParse({ disabledHooks: ['x'], hooks: { PreToolUse: [guard, anonymous] } })
        .success,
    ).toBe(true);
  });
});
