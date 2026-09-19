/**
 * SCREEN-2002 TC-08 — the run's theme surface.
 *
 * Its job is to hand ONE registry to two consumers and to carry the motion decision to both. The
 * assertion that matters is the second one: the picker renders `reducedMotionOverride`, and a fold
 * that wired it through five files while leaving this function silent would have produced a picker
 * that shows `motion on` on a `--reduced-motion` run — the one surface of three that hides the pin.
 */
import { describe, expect, it } from 'vitest';

import { createThemeSurface } from '../theme-surface.js';

const SETTINGS = { theme: 'light', syntaxHighlighting: false, reducedMotion: false };

describe('the theme surface (SCREEN-2002 TC-08)', () => {
  it('hands the SAME registry to the command port and the renderer', () => {
    const surface = createThemeSurface({
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
      enabled: true,
      settings: SETTINGS,
      reducedMotionFlag: true,
      env: {},
    });

    expect(surface.reducedMotion).toBe(true);
    expect(surface.reducedMotionOverride).toBe('flag');
    // Both consumers see the same pin.
    expect(surface.cataloguePort?.getAppearance().reducedMotionOverride).toBe('flag');
  });

  it('carries an environment override the same way', () => {
    const surface = createThemeSurface({
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
