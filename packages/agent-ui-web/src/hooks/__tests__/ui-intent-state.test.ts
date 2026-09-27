/**
 * CMD-004 Stage D (TC-05) — every `ui_intent` this surface asked for is answered with an explicit
 * "not available on this surface" line — NEVER a silent no-op — unless the GUI has a screen for it.
 * The session picker is the session sidebar (#3189), settings is the Settings modal (#3282 §4a), the
 * plugin manager opens that same modal on its Plugins section (#3282 §4 part b-2), and the agent
 * switcher is a sheet (#3282 §4 part b-3); every other kind names the screen it could not open.
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

describe('CMD-004 TC-05 — ui_intent description (explicit, never silent)', () => {
  it('every unsupported intent kind names its own screen and says it is unavailable here', () => {
    const lines = UNSUPPORTED_INTENTS.map((intent) => describeUiIntentForGui(intent));
    for (const line of lines) expect(line).toMatch(/is not available on this surface/);
    expect(new Set(lines).size).toBe(UNSUPPORTED_INTENTS.length);
    expect(describeUiIntentForGui({ type: 'show-theme-picker' })).toMatch(/theme picker/);
  });

  it('an intent kind this build does not know is still named, not dropped', () => {
    const line = describeUiIntentForGui({ type: 'show-future-screen' } as unknown as TCommandUiIntent);
    expect(line).toMatch(/'show-future-screen' is not available on this surface/);
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
