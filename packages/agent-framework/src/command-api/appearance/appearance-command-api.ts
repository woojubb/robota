import { readSettings, writeSettings } from '../../config/settings-io.js';

import type { TSettingsData } from '../../config/settings-io.js';
import type { TUniversalValue } from '@robota-sdk/agent-core';
import type {
  IAppearanceSettings,
  TAppearanceSettingsPatch,
} from '@robota-sdk/agent-interface-command';

export type { IAppearanceSettings, TAppearanceSettingsPatch };

/**
 * SCREEN-2002 — the appearance settings, read and written in one place.
 *
 * Three FLAT keys, not one nested object: this is the shape `screenReader`, `promptHistory` and
 * `outputStyle` already use, it is what a user hand-editing the settings file expects, and
 * it keeps each key independently settable — a run can pin reduced motion without also pinning a
 * theme.
 *
 * The theme is stored by ID. The settings document never holds a colour VALUE, so a theme that is
 * renamed, removed or made invalid degrades to the default plus a visible notice instead of
 * persisting colours nothing owns any more.
 */
export const APPEARANCE_SETTINGS_KEYS = Object.freeze({
  theme: 'theme',
  syntaxHighlighting: 'syntaxHighlighting',
  reducedMotion: 'reducedMotion',
} as const);

/**
 * What a user who has set nothing gets. `theme` names the terminal's own default built-in — the two
 * are pinned together by a test in `agent-ui-terminal`, because this package cannot import the
 * catalogue (the dependency runs the other way) and a silently diverged id would show up only as an
 * unknown-theme notice on every startup.
 */
export const DEFAULT_APPEARANCE_SETTINGS: Readonly<IAppearanceSettings> = Object.freeze({
  theme: 'dark',
  syntaxHighlighting: true,
  reducedMotion: false,
});

/**
 * Whether a patch carries only appearance fields of the right type. A patch that fails this is
 * REFUSED by the host applier rather than partially written — the same rule the statusline patch
 * follows, and the reason a malformed `/theme` result cannot corrupt the settings document.
 */
export function isAppearanceSettingsPatch(
  value: Record<string, TUniversalValue>,
): value is TAppearanceSettingsPatch {
  return (
    (value.theme === undefined || (typeof value.theme === 'string' && value.theme.length > 0)) &&
    (value.syntaxHighlighting === undefined || typeof value.syntaxHighlighting === 'boolean') &&
    (value.reducedMotion === undefined || typeof value.reducedMotion === 'boolean')
  );
}

/**
 * The appearance a settings document asks for, with every absent or wrong-typed key falling back to
 * its default INDEPENDENTLY. A document whose `reducedMotion` is the string `"yes"` still gets its
 * valid `theme` — one bad key is not a reason to discard the others, because the user can only fix
 * what they can still see taking effect.
 */
export function readAppearanceSettings(settings: TSettingsData): IAppearanceSettings {
  const theme = settings[APPEARANCE_SETTINGS_KEYS.theme];
  const syntaxHighlighting = settings[APPEARANCE_SETTINGS_KEYS.syntaxHighlighting];
  const reducedMotion = settings[APPEARANCE_SETTINGS_KEYS.reducedMotion];
  return {
    theme:
      typeof theme === 'string' && theme.length > 0 ? theme : DEFAULT_APPEARANCE_SETTINGS.theme,
    syntaxHighlighting:
      typeof syntaxHighlighting === 'boolean'
        ? syntaxHighlighting
        : DEFAULT_APPEARANCE_SETTINGS.syntaxHighlighting,
    reducedMotion:
      typeof reducedMotion === 'boolean'
        ? reducedMotion
        : DEFAULT_APPEARANCE_SETTINGS.reducedMotion,
  };
}

/** Merge a patch into the document's appearance keys and persist it. Returns what is now stored. */
export function applyAppearanceSettings(
  settingsPath: string,
  patch: TAppearanceSettingsPatch,
): IAppearanceSettings {
  const settings = readSettings(settingsPath);
  const next: IAppearanceSettings = { ...readAppearanceSettings(settings), ...patch };
  settings[APPEARANCE_SETTINGS_KEYS.theme] = next.theme;
  settings[APPEARANCE_SETTINGS_KEYS.syntaxHighlighting] = next.syntaxHighlighting;
  settings[APPEARANCE_SETTINGS_KEYS.reducedMotion] = next.reducedMotion;
  writeSettings(settingsPath, settings);
  return next;
}
