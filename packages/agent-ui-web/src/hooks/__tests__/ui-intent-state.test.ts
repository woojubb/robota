/**
 * CMD-004 Stage D (TC-05) — every `ui_intent` this surface asked for is answered visibly, never a
 * silent no-op, and never with the literal "not available on this surface" line. The session picker
 * is the session sidebar (#3189), settings is the Settings modal (#3282 §4a), the plugin manager
 * opens that same modal on its Plugins section (#3282 §4 part b-2), and the agent switcher is a sheet
 * (#3282 §4 part b-3) — all four always have a screen. #3282 §4e: a screen this HOST cannot back
 * right now (a session picker with no session list) gets its own honest sentence instead, and so does
 * an intent kind this build does not know at all.
 */

import { describe, expect, it } from 'vitest';

import { describeUiIntentForGui, guiScreenForUiIntent } from '../ui-intent-state.js';

import type { TCommandUiIntent } from '@robota-sdk/agent-interface-command';

/**
 * Intents with no GUI screen — `show-session-picker`, `show-settings`, `show-plugin-manager` and
 * `show-agent-switcher` are asserted separately.
 */
const UNSUPPORTED_INTENTS: readonly TCommandUiIntent[] = [
  { type: 'show-theme-picker' },
];

describe('CMD-004 TC-05 — ui_intent description (explicit, never silent, never "not available")', () => {
  it('every unsupported intent kind gets its own plain sentence, never the banned phrase', () => {
    const lines = UNSUPPORTED_INTENTS.map((intent) => describeUiIntentForGui(intent));
    for (const line of lines) expect(line).not.toMatch(/not available on this surface/);
    expect(new Set(lines).size).toBe(UNSUPPORTED_INTENTS.length);
  });

  it('the theme picker reuses the exclusion sentence — the GUI follows system appearance', () => {
    expect(describeUiIntentForGui({ type: 'show-theme-picker' })).toBe(
      'This app follows your system appearance.',
    );
  });

  it('a session picker this HOST cannot back names the host, not a missing GUI feature', () => {
    const line = describeUiIntentForGui({ type: 'show-session-picker' });
    expect(line).toMatch(/cannot list sessions/);
    expect(line).not.toMatch(/not available on this surface/);
  });

  it('an intent kind this build does not know is still named, not dropped, and not the banned phrase', () => {
    const line = describeUiIntentForGui({ type: 'show-future-screen' } as unknown as TCommandUiIntent);
    expect(line).toMatch(/'show-future-screen'/);
    expect(line).not.toMatch(/not available on this surface/);
  });
});

describe('#3189 — the session picker opens the GUI session sidebar', () => {
  it('show-session-picker has a GUI screen; the unsupported intents have none', () => {
    expect(guiScreenForUiIntent({ type: 'show-session-picker' })).toBe('session-sidebar');
    for (const intent of UNSUPPORTED_INTENTS) {
      expect(guiScreenForUiIntent(intent)).toBeNull();
    }
  });
});

describe('#3282 §4a — settings opens the GUI Settings screen', () => {
  it('show-settings has a GUI screen, distinct from the session sidebar', () => {
    expect(guiScreenForUiIntent({ type: 'show-settings' })).toBe('settings');
  });
});

describe('#3282 §4 part b-2 — the plugin manager opens the Settings screen, on Plugins', () => {
  it('show-plugin-manager has a GUI screen, distinct from settings itself and the session sidebar', () => {
    expect(guiScreenForUiIntent({ type: 'show-plugin-manager' })).toBe('settings-plugins');
  });
});

describe('#3282 §4 part b-3 — the agent switcher opens a sheet', () => {
  it('show-agent-switcher has a GUI screen, distinct from settings and the session sidebar', () => {
    expect(guiScreenForUiIntent({ type: 'show-agent-switcher' })).toBe('agent-switcher');
  });
});
