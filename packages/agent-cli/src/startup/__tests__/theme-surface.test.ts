/**
 * SCREEN-2002 TC-08 — the run's theme surface.
 *
 * Its job is to hand ONE registry to two consumers and to carry the motion decision to both. The
 * assertion that matters is the second one: the picker renders `reducedMotionOverride`, and a fold
 * that wired it through five files while leaving this function silent would have produced a picker
 * that shows `motion on` on a `--reduced-motion` run — the one surface of three that hides the pin.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { createThemeSurface } from '../theme-surface.js';

const SETTINGS = { theme: 'light', syntaxHighlighting: false, reducedMotion: false };

const temporaryRoots: string[] = [];

/** An isolated HOME, so a developer's own `~/.robota/themes` cannot change what these assert. */
function emptyHome(): string {
  const root = mkdtempSync(join(tmpdir(), 'robota-surface-home-'));
  temporaryRoots.push(root);
  return root;
}

afterEach(() => {
  for (const root of temporaryRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('the theme surface (SCREEN-2002 TC-08)', () => {
  it('hands the SAME registry to the command port and the renderer', () => {
    const surface = createThemeSurface({
      cwd: undefined,
      userHome: emptyHome(),
      enabled: true,
      settings: SETTINGS,
      reducedMotionFlag: undefined,
      env: {},
    });

    expect(surface.registry).toBeDefined();
    expect(surface.cataloguePort).toBeDefined();
    // A listing and a switch must never disagree about which themes exist.
    expect(surface.cataloguePort?.listThemes().map((theme) => theme.id)).toEqual(
      surface.registry?.list().map((theme) => theme.id),
    );
  });

  it('carries the flag s override to the RENDERER, not only to the command port', () => {
    const surface = createThemeSurface({
      cwd: undefined,
      userHome: emptyHome(),
      enabled: true,
      settings: SETTINGS,
      reducedMotionFlag: true,
      env: {},
    });

    expect(surface.reducedMotion).toBe(true);
    expect(surface.reducedMotionOverride).toBe('flag');
    // Both consumers see the same pin.
    expect(surface.cataloguePort?.getAppearance().reducedMotionPin?.tier).toBe('flag');
  });

  it('carries an environment override the same way', () => {
    const surface = createThemeSurface({
      cwd: undefined,
      userHome: emptyHome(),
      enabled: true,
      settings: SETTINGS,
      reducedMotionFlag: undefined,
      env: { ROBOTA_REDUCED_MOTION: '1' },
    });

    expect(surface.reducedMotion).toBe(true);
    expect(surface.reducedMotionOverride).toBe('environment');
  });

  it('omits the override entirely when the settings decided', () => {
    const surface = createThemeSurface({
      cwd: undefined,
      userHome: emptyHome(),
      enabled: true,
      settings: { ...SETTINGS, reducedMotion: true },
      reducedMotionFlag: undefined,
      env: {},
    });

    expect(surface.reducedMotion).toBe(true);
    expect('reducedMotionOverride' in surface).toBe(false);
  });

  it('renders no themes and registers no command when the surface is disabled', () => {
    const surface = createThemeSurface({
      cwd: undefined,
      userHome: emptyHome(),
      enabled: false,
      settings: SETTINGS,
      reducedMotionFlag: true,
      env: {},
    });

    // Print mode and `--serve`: a command that cannot do anything is better absent.
    expect(surface.registry).toBeUndefined();
    expect(surface.cataloguePort).toBeUndefined();
    // The motion decision still applies — it is not a theme feature.
    expect(surface.reducedMotion).toBe(true);
    expect(surface.reducedMotionOverride).toBe('flag');
  });
});

describe('the theme surface over real theme files (SCREEN-2002 TC-11)', () => {
  it('puts user themes in the same registry as the built-ins, and skips beside them', () => {
    const home = emptyHome();
    const directory = join(home, '.robota', 'themes');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'mine.json'), JSON.stringify({ name: 'Mine' }));
    writeFileSync(join(directory, 'broken.json'), '{ not json');

    const surface = createThemeSurface({
      cwd: undefined,
      userHome: home,
      enabled: true,
      settings: SETTINGS,
      reducedMotionFlag: undefined,
      env: {},
    });

    const ids = surface.registry?.list().map((theme) => theme.id) ?? [];
    expect(ids).toContain('dark');
    expect(ids).toContain('custom:mine');
    // `/theme list` and the picker read the same instance, so both see the user's theme.
    expect(surface.cataloguePort?.listThemes().map((theme) => theme.id)).toEqual(ids);
    expect(surface.skipped.map((skip) => skip.fileName)).toEqual(['broken.json']);
    expect(surface.registry?.skipped()).toEqual(surface.skipped);
  });

  it('composes no registry and reports no skip when this run renders no terminal UI', () => {
    const home = emptyHome();
    const directory = join(home, '.robota', 'themes');
    mkdirSync(directory, { recursive: true });
    writeFileSync(join(directory, 'mine.json'), JSON.stringify({ name: 'Mine' }));

    const surface = createThemeSurface({
      cwd: undefined,
      userHome: home,
      enabled: false,
      settings: SETTINGS,
      reducedMotionFlag: undefined,
      env: {},
    });

    // The assertion is on the COMPOSITION, not on whether a directory was walked: a read whose
    // result is discarded would satisfy both of these, and the observable contract is that a print
    // run has no theme registry and prints no skip line about a file nothing was going to use.
    expect(surface.registry).toBeUndefined();
    expect(surface.cataloguePort).toBeUndefined();
    expect(surface.skipped).toEqual([]);
  });
});
