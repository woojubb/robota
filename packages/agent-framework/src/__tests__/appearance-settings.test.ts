/**
 * SCREEN-2002 TC-07 — the appearance settings reader, its defaults and its guard.
 *
 * The load-bearing property is INDEPENDENCE: three flat keys, each falling back on its own. A
 * document with one bad key still applies the other two, because a user can only correct what they
 * can still see taking effect — discarding the whole document would make a typo in `reducedMotion`
 * look like a theme that stopped working.
 */
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import {
  applyAppearanceSettings,
  DEFAULT_APPEARANCE_SETTINGS,
  isAppearanceSettingsPatch,
  readAppearanceSettings,
} from '../command-api/appearance/appearance-command-api.js';

const TMP_BASE = realpathSync(mkdtempSync(join(tmpdir(), 'robota-appearance-settings-test-')));

function settingsFile(contents: Record<string, unknown>): string {
  const path = join(TMP_BASE, '.robota', 'settings.json');
  mkdirSync(join(TMP_BASE, '.robota'), { recursive: true });
  writeFileSync(path, JSON.stringify(contents), 'utf8');
  return path;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>;
}

afterEach(() => {
  rmSync(TMP_BASE, { recursive: true, force: true });
});

describe('reading the appearance settings (SCREEN-2002 TC-07)', () => {
  it('answers with the defaults when the document says nothing', () => {
    expect(readAppearanceSettings({})).toEqual({
      theme: 'dark',
      syntaxHighlighting: true,
      reducedMotion: false,
    });
    expect(readAppearanceSettings({})).toEqual(DEFAULT_APPEARANCE_SETTINGS);
  });

  it('reads the three keys FLAT, beside the other settings rather than nested', () => {
    const appearance = readAppearanceSettings({
      language: 'ko',
      theme: 'light-daltonized',
      syntaxHighlighting: false,
      reducedMotion: true,
    });

    expect(appearance).toEqual({
      theme: 'light-daltonized',
      syntaxHighlighting: false,
      reducedMotion: true,
    });
  });

  it('falls back PER KEY, so one bad value does not discard the others', () => {
    const appearance = readAppearanceSettings({
      theme: 'light',
      // Both of these are the wrong type — a hand-edited document's most likely mistake.
      syntaxHighlighting: 'yes',
      reducedMotion: 1,
    });

    expect(appearance.theme).toBe('light');
    expect(appearance.syntaxHighlighting).toBe(DEFAULT_APPEARANCE_SETTINGS.syntaxHighlighting);
    expect(appearance.reducedMotion).toBe(DEFAULT_APPEARANCE_SETTINGS.reducedMotion);
  });

  it('refuses an empty theme id rather than persisting a run with no theme', () => {
    expect(readAppearanceSettings({ theme: '' }).theme).toBe(DEFAULT_APPEARANCE_SETTINGS.theme);
  });

  it('does NOT validate the theme id against a catalogue — that is the registry s job', () => {
    // An id this build does not know is carried through, so the resolver can name it in its notice.
    // Swallowing it here would turn "theme `foo` is not installed" into a silent default.
    expect(readAppearanceSettings({ theme: 'no-such-theme' }).theme).toBe('no-such-theme');
  });
});

describe('the appearance patch guard (SCREEN-2002 TC-07)', () => {
  it('accepts a sparse patch of the right types', () => {
    expect(isAppearanceSettingsPatch({})).toBe(true);
    expect(isAppearanceSettingsPatch({ theme: 'light' })).toBe(true);
    expect(isAppearanceSettingsPatch({ reducedMotion: true, syntaxHighlighting: false })).toBe(
      true,
    );
  });

  it('refuses a foreign shape, so a malformed result cannot reach the document', () => {
    expect(isAppearanceSettingsPatch({ theme: 42 })).toBe(false);
    expect(isAppearanceSettingsPatch({ theme: '' })).toBe(false);
    expect(isAppearanceSettingsPatch({ syntaxHighlighting: 'on' })).toBe(false);
    expect(isAppearanceSettingsPatch({ reducedMotion: 'yes' })).toBe(false);
  });
});

describe('applying an appearance patch (SCREEN-2002 TC-07)', () => {
  it('writes the three keys flat and leaves every other setting alone', () => {
    const path = settingsFile({ language: 'ko', statusline: { enabled: false } });

    const next = applyAppearanceSettings(path, { theme: 'dark-daltonized', reducedMotion: true });

    expect(next).toEqual({
      theme: 'dark-daltonized',
      syntaxHighlighting: true,
      reducedMotion: true,
    });
    const document = readJson(path);
    expect(document.theme).toBe('dark-daltonized');
    expect(document.reducedMotion).toBe(true);
    expect(document.syntaxHighlighting).toBe(true);
    // Untouched neighbours — the patch owns three keys and nothing else.
    expect(document.language).toBe('ko');
    expect(document.statusline).toEqual({ enabled: false });
  });

  it('merges over what is already stored rather than replacing it', () => {
    const path = settingsFile({ theme: 'light', syntaxHighlighting: false, reducedMotion: true });

    const next = applyAppearanceSettings(path, { syntaxHighlighting: true });

    expect(next).toEqual({ theme: 'light', syntaxHighlighting: true, reducedMotion: true });
  });
});
