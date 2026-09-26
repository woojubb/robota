/**
 * CMD-004 Stage D (TC-05) — every `ui_intent` this surface asked for is answered with an explicit
 * "not available on this surface" line — NEVER a silent no-op. The GUI has no screen for any intent
 * yet, so each kind names the screen it could not open.
 */

import { describe, expect, it } from 'vitest';

import { describeUiIntentForGui } from '../ui-intent-state.js';

import type { TCommandUiIntent } from '@robota-sdk/agent-interface-command';

const ALL_INTENTS: readonly TCommandUiIntent[] = [
  { type: 'show-plugin-manager' },
  { type: 'show-settings' },
  { type: 'show-session-picker' },
  { type: 'show-agent-switcher' },
  { type: 'show-theme-picker' },
];

describe('CMD-004 TC-05 — ui_intent description (explicit, never silent)', () => {
  it('every intent kind names its own screen and says it is unavailable here', () => {
    const lines = ALL_INTENTS.map((intent) => describeUiIntentForGui(intent));
    for (const line of lines) expect(line).toMatch(/is not available on this surface/);
    expect(new Set(lines).size).toBe(ALL_INTENTS.length);
    expect(describeUiIntentForGui({ type: 'show-theme-picker' })).toMatch(/theme picker/);
  });

  it('an intent kind this build does not know is still named, not dropped', () => {
    const line = describeUiIntentForGui({ type: 'show-future-screen' } as unknown as TCommandUiIntent);
    expect(line).toMatch(/'show-future-screen' is not available on this surface/);
  });
});
