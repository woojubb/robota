import { describe, expect, it } from 'vitest';

import { buildTuiSessionOptions } from '../tui-session-options.js';

import type { ITuiInteractionChannelOptions } from '../TuiInteractionChannel.js';

/**
 * ARCH-013 — a preset's `effort` is resolved at startup and then dropped.
 *
 * `TPresetEffort` is defined as `NonNullable<ICreateSessionOptions['effort']>` precisely so a preset
 * can thread onto that seam, and three of the four built-in presets set it —
 * `neutral-executor` asks for `'medium'`. At startup none of it arrives: no hop between the resolved
 * preset and `createSession` carried the field, so the core applied its own `'high'` default.
 *
 * The same preset selected mid-session with `/preset` DOES apply it
 * (`command-api/preset/preset-application.ts:91` → `applyModelOptions`), so one session could hold
 * two different answers for the same preset depending on when it was chosen. That is the observable
 * this pins, at the projection hop the TUI actually uses.
 */
function channelOptions(
  overrides: Partial<ITuiInteractionChannelOptions> = {},
): ITuiInteractionChannelOptions {
  return { cwd: '/tmp', ...overrides } as ITuiInteractionChannelOptions;
}

describe('the TUI projection carries effort (ARCH-013)', () => {
  it('forwards a resolved effort onto the session options', () => {
    // Against the defect `effort` is not a key of the target type at all, so it is simply absent.
    // Asserted over the entries rather than through a cast: the declared return type is the
    // standard|injected union and only the standard arm can carry a construction-time option, but a
    // double cast to reach the key would be the same "trust me" this whole item is about.
    const built = buildTuiSessionOptions(channelOptions({ effort: 'medium' }));
    expect(Object.entries(built)).toContainEqual(['effort', 'medium']);
  });

  it('omits the key entirely when no effort was resolved', () => {
    // Not `undefined` — absent. The framework→provider seam owns the default, and a present-but-
    // undefined key would claim a decision nobody made.
    expect('effort' in buildTuiSessionOptions(channelOptions())).toBe(false);
  });
});
