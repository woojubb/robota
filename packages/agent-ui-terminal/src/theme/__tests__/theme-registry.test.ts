/**
 * SCREEN-2002 TC-09/TC-10 — the registry and the catalogue port.
 *
 * The property worth guarding is that an unknown id NAMES itself. Resolving silently would make a
 * removed plugin theme look like a theme that stopped working, and the id is the only thing that
 * can point at the cause.
 */
import { describe, expect, it } from 'vitest';

import { DARK_THEME, LIGHT_THEME, listBuiltInThemes } from '../built-in-themes.js';
import {
  createThemeCataloguePort,
  createThemeRegistry,
  formatUnknownThemeNotice,
} from '../theme-registry.js';

import type { IAppearanceSettings } from '@robota-sdk/agent-interface-command';

const APPEARANCE: IAppearanceSettings = {
  theme: 'dark',
  syntaxHighlighting: true,
  reducedMotion: false,
};

describe('the theme registry (SCREEN-2002 TC-09)', () => {
  it('lists the built-ins and finds one by id', () => {
    const registry = createThemeRegistry();

    expect(registry.list().map((theme) => theme.id)).toEqual([
      'dark',
      'light',
      'dark-daltonized',
      'light-daltonized',
    ]);
    expect(registry.get('light')?.name).toBe(LIGHT_THEME.name);
    expect(registry.get('nope')).toBeUndefined();
  });

  it('resolves a known id without naming a miss', () => {
    const resolution = createThemeRegistry().resolve('light');

    expect(resolution.theme.id).toBe('light');
    expect(resolution.unknownId).toBeUndefined();
  });

  it('falls back to the default AND names the id it could not find', () => {
    const resolution = createThemeRegistry().resolve('solarized');

    expect(resolution.theme.id).toBe(DARK_THEME.id);
    // The whole point: the caller can say WHICH theme is missing.
    expect(resolution.unknownId).toBe('solarized');
    expect(formatUnknownThemeNotice('solarized')).toContain('solarized');
  });

  it('treats an absent id as no request at all, not as a miss', () => {
    const resolution = createThemeRegistry().resolve(undefined);

    expect(resolution.theme.id).toBe(DARK_THEME.id);
    expect(resolution.unknownId).toBeUndefined();
  });

  it('carries a caller-supplied catalogue, which is how work unit 3 adds user themes', () => {
    const registry = createThemeRegistry([LIGHT_THEME]);

    expect(registry.list()).toEqual([LIGHT_THEME]);
    expect(registry.get('dark')).toBeUndefined();
  });
});

describe('the catalogue port (SCREEN-2002 TC-09)', () => {
  it('projects identity and source, never a colour', () => {
    const port = createThemeCataloguePort({
      registry: createThemeRegistry(),
      readAppearance: () => APPEARANCE,
    });

    const entry = port.getTheme('dark');

    expect(entry).toEqual({
      id: 'dark',
      name: DARK_THEME.name,
      appearance: DARK_THEME.appearance,
      source: DARK_THEME.source,
    });
    // A command asks about ids; colours belong to whatever is rendering.
    expect(Object.keys(entry ?? {})).not.toContain('colors');
  });

  it('RE-READS the appearance on every call, so a just-applied patch is visible', () => {
    let stored: IAppearanceSettings = { ...APPEARANCE };
    const port = createThemeCataloguePort({
      registry: createThemeRegistry(),
      readAppearance: () => stored,
    });

    expect(port.getAppearance().settings.theme).toBe('dark');
    // The host wrote the settings document between the two calls.
    stored = { ...stored, theme: 'light' };
    expect(port.getAppearance().settings.theme).toBe('light');
  });

  it('omits the override entirely when nothing pinned this run', () => {
    const port = createThemeCataloguePort({
      registry: createThemeRegistry(),
      readAppearance: () => APPEARANCE,
    });

    expect('reducedMotionOverride' in port.getAppearance()).toBe(false);
  });

  it('reports the tier that pinned reduced motion AND what it pinned', () => {
    // One pair, not two optional fields: a tier alone cannot say which way a run went, because
    // `--no-reduced-motion` is an override too. The shape makes the half-supplied case unwritable.
    const port = createThemeCataloguePort({
      registry: createThemeRegistry(),
      readAppearance: () => APPEARANCE,
      reducedMotionPin: { tier: 'flag', reducedMotion: false },
    });

    expect(port.getAppearance().reducedMotionOverride).toBe('flag');
    expect(port.getAppearance().reducedMotionForRun).toBe(false);
  });
});

describe('a registry that also carries what it could not load (SCREEN-2002 TC-11)', () => {
  const skip = { id: 'custom:broken', fileName: 'broken.json', reason: '$.overrides: boom' };

  it('keeps skipped files out of the themes it can resolve', () => {
    const registry = createThemeRegistry(listBuiltInThemes(), [skip]);
    expect(registry.get('custom:broken')).toBeUndefined();
    expect(registry.list().some((theme) => theme.id === 'custom:broken')).toBe(false);
    expect(registry.resolve('custom:broken').unknownId).toBe('custom:broken');
  });

  it('reports them separately, so a surface can SHOW a file it will not apply', () => {
    expect(createThemeRegistry(listBuiltInThemes(), [skip]).skipped()).toEqual([skip]);
    expect(createThemeRegistry().skipped()).toEqual([]);
  });
});
