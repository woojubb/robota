/**
 * SCREEN-2002 TC-09 — `/theme`.
 *
 * Three properties carry this command. It emits EXACTLY ONE patch per invocation, so a submission
 * cannot half-apply. An unknown id writes NOTHING — not the theme, and not the toggles submitted
 * beside it — because a user who mistyped an id did not also ask for the rest. And `motion on`
 * means `reducedMotion: false`: the inversion is the easy thing to read backwards, and a user
 * asking for motion and getting stillness would look like the command doing nothing at all.
 */
import { describe, expect, it } from 'vitest';

import { executeThemeCommand } from '../theme-command-module.js';

import type { TAppearanceSettingsPatch } from '@robota-sdk/agent-framework';
import type {
  IThemeAppearanceState,
  IThemeCatalogueEntry,
  IThemeCataloguePort,
  TReducedMotionOverride,
} from '@robota-sdk/agent-interface-command';

const THEMES: IThemeCatalogueEntry[] = [
  { id: 'dark', name: 'Dark', appearance: 'dark', source: 'built-in' },
  { id: 'light', name: 'Light', appearance: 'light', source: 'built-in' },
  {
    id: 'dark-daltonized',
    name: 'Dark (daltonized)',
    appearance: 'dark',
    source: 'built-in',
  },
];

function catalogue(
  state: Partial<IThemeAppearanceState['settings']> = {},
  reducedMotionOverride?: TReducedMotionOverride,
): IThemeCataloguePort {
  const settings = {
    theme: 'dark',
    syntaxHighlighting: true,
    reducedMotion: false,
    ...state,
  };
  return {
    listThemes: () => THEMES,
    getTheme: (id) => THEMES.find((theme) => theme.id === id),
    getAppearance: () => ({
      settings,
      ...(reducedMotionOverride === undefined ? {} : { reducedMotionOverride }),
    }),
  };
}

function patchOf(result: { hostActions?: readonly unknown[] }): TAppearanceSettingsPatch {
  expect(result.hostActions).toHaveLength(1);
  const action = result.hostActions?.[0] as {
    type: string;
    patch: TAppearanceSettingsPatch;
  };
  expect(action.type).toBe('appearance-settings-patch');
  return action.patch;
}

describe('/theme without a catalogue (SCREEN-2002 TC-09)', () => {
  it('reports its unavailability instead of failing silently or writing anything', () => {
    const result = executeThemeCommand(undefined, 'light');

    expect(result.success).toBe(false);
    expect(result.message).toBe('Themes are not available in this environment.');
    expect(result.hostActions).toBeUndefined();
  });
});

describe('/theme with no argument (SCREEN-2002 TC-09)', () => {
  it('asks the surface for the picker rather than changing anything', () => {
    const result = executeThemeCommand(catalogue(), '   ');

    expect(result.success).toBe(true);
    expect(result.uiIntents).toEqual([{ type: 'show-theme-picker' }]);
    expect(result.hostActions).toBeUndefined();
  });
});

describe('/theme list (SCREEN-2002 TC-09)', () => {
  it('marks the active theme and names each source, and writes nothing', () => {
    const result = executeThemeCommand(catalogue({ theme: 'light' }), 'list');

    expect(result.success).toBe(true);
    expect(result.message).toContain('* light — Light (light, built-in)');
    expect(result.message).toContain('  dark — Dark (dark, built-in)');
    expect(result.message).toContain('syntax highlighting: on');
    expect(result.message).toContain('reduced motion: off');
    expect(result.hostActions).toBeUndefined();
  });

  it('says so when this run s motion is pinned by something outside the settings', () => {
    const result = executeThemeCommand(catalogue({ reducedMotion: false }, 'flag'), 'list');

    expect(result.message).toContain(
      'reduced motion: off (this run: reduced motion pinned by flag)',
    );
  });
});

describe('/theme <id> (SCREEN-2002 TC-09)', () => {
  it('emits exactly one patch naming the theme', () => {
    const result = executeThemeCommand(catalogue(), 'dark-daltonized');

    expect(result.success).toBe(true);
    expect(patchOf(result)).toEqual({ theme: 'dark-daltonized' });
    expect(result.message).toContain('Dark (daltonized)');
  });

  it('refuses an unknown id, names the catalogue, and writes NOTHING', () => {
    const result = executeThemeCommand(catalogue(), 'solarized');

    expect(result.success).toBe(false);
    expect(result.message).toContain('Unknown theme "solarized"');
    expect(result.message).toContain('dark, light, dark-daltonized');
    expect(result.hostActions).toBeUndefined();
  });

  it('does not apply the toggles submitted beside an unknown id', () => {
    const result = executeThemeCommand(catalogue(), 'solarized syntax off');

    expect(result.success).toBe(false);
    expect(result.hostActions).toBeUndefined();
  });

  it('carries the theme and its toggles in ONE patch', () => {
    const result = executeThemeCommand(catalogue(), 'light syntax off motion off');

    expect(patchOf(result)).toEqual({
      theme: 'light',
      syntaxHighlighting: false,
      reducedMotion: true,
    });
  });
});

describe('the motion inversion (SCREEN-2002 TC-09)', () => {
  it('reads `motion on` as animation, which is reducedMotion FALSE', () => {
    expect(patchOf(executeThemeCommand(catalogue({ reducedMotion: true }), 'motion on'))).toEqual({
      reducedMotion: false,
    });
  });

  it('reads `motion off` as stillness, which is reducedMotion TRUE', () => {
    expect(patchOf(executeThemeCommand(catalogue(), 'motion off'))).toEqual({
      reducedMotion: true,
    });
  });

  it('reports the change in the user s words, not the settings key s', () => {
    expect(executeThemeCommand(catalogue(), 'motion off').message).toContain('motion off');
  });

  it('persists the setting but says this run keeps what pinned it', () => {
    const result = executeThemeCommand(catalogue({ reducedMotion: true }, 'flag'), 'motion on');

    expect(patchOf(result)).toEqual({ reducedMotion: false });
    expect(result.message).toContain('Saved, but this run keeps reduced motion pinned by flag');
  });
});

describe('/theme syntax (SCREEN-2002 TC-09)', () => {
  it('toggles highlighting without touching the theme', () => {
    expect(patchOf(executeThemeCommand(catalogue(), 'syntax off'))).toEqual({
      syntaxHighlighting: false,
    });
  });
});

describe('a malformed argument (SCREEN-2002 TC-09)', () => {
  it.each(['motion', 'syntax', 'motion yes', 'syntax enable', 'light motion', 'light nonsense on'])(
    'refuses %o with the usage line rather than guessing',
    (args) => {
      const result = executeThemeCommand(catalogue(), args);

      expect(result.success).toBe(false);
      expect(result.message).toContain('Usage: /theme');
      expect(result.hostActions).toBeUndefined();
    },
  );
});
