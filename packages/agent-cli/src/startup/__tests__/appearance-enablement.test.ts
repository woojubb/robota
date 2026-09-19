/**
 * SCREEN-2002 TC-08 — the reduced-motion precedence chain.
 *
 * The property that matters is that an override is REPORTED, not just applied. A user who runs
 * `/theme motion on` while a flag pins stillness must be told the setting was saved and why this run
 * ignores it; silently obeying either side is how a setting acquires a reputation for not working.
 */
import { describe, expect, it } from 'vitest';

import { resolveAppearanceRenderFields, resolveReducedMotion } from '../appearance-enablement.js';

describe('reduced-motion precedence (SCREEN-2002 TC-08)', () => {
  it('uses the settings when nothing above them has an opinion', () => {
    expect(resolveReducedMotion({ settings: true })).toEqual({ reducedMotion: true });
    expect(resolveReducedMotion({ settings: false })).toEqual({ reducedMotion: false });
  });

  it('lets the environment override the settings, and says so', () => {
    expect(resolveReducedMotion({ settings: false, env: '1' })).toEqual({
      reducedMotion: true,
      override: 'environment',
    });
    expect(resolveReducedMotion({ settings: true, env: '0' })).toEqual({
      reducedMotion: false,
      override: 'environment',
    });
  });

  it('ignores an environment value that is not an opinion', () => {
    for (const env of ['', 'yes', 'true', '2']) {
      expect(resolveReducedMotion({ settings: true, env })).toEqual({ reducedMotion: true });
    }
  });

  it('lets the flag win over both, so one run can decide on any machine', () => {
    expect(resolveReducedMotion({ settings: false, env: '0', flag: true })).toEqual({
      reducedMotion: true,
      override: 'flag',
    });
    expect(resolveReducedMotion({ settings: true, env: '1', flag: false })).toEqual({
      reducedMotion: false,
      override: 'flag',
    });
  });

  it('counts a flag that AGREES with the settings as an override', () => {
    // The user pinned it for this run. `/theme motion on` must report that its write cannot take
    // effect until the next run, and it can only do that if the pin is visible.
    expect(resolveReducedMotion({ settings: true, flag: true })).toEqual({
      reducedMotion: true,
      override: 'flag',
    });
  });
});

describe('the render fields the CLI passes down (SCREEN-2002 TC-08)', () => {
  it('reports the PERSISTED appearance alongside what this run uses', () => {
    const fields = resolveAppearanceRenderFields(
      { theme: 'light', syntaxHighlighting: false, reducedMotion: false },
      true,
      {},
    );

    // What is stored is unchanged by the flag — `/theme` reports this.
    expect(fields.appearance).toEqual({
      theme: 'light',
      syntaxHighlighting: false,
      reducedMotion: false,
    });
    // What this run does is the flag's answer, and the tier is named.
    expect(fields.reducedMotion).toBe(true);
    expect(fields.reducedMotionOverride).toBe('flag');
  });

  it('omits the override entirely when the settings decided', () => {
    const fields = resolveAppearanceRenderFields({ reducedMotion: true }, undefined, {});

    expect(fields.reducedMotion).toBe(true);
    expect('reducedMotionOverride' in fields).toBe(false);
  });

  it('falls back to the defaults for an absent document', () => {
    const fields = resolveAppearanceRenderFields(undefined, undefined, {});

    expect(fields.appearance).toEqual({
      theme: 'dark',
      syntaxHighlighting: true,
      reducedMotion: false,
    });
    expect(fields.reducedMotion).toBe(false);
  });

  it('reads the environment variable by its documented name', () => {
    const fields = resolveAppearanceRenderFields({}, undefined, { ROBOTA_REDUCED_MOTION: '1' });

    expect(fields.reducedMotion).toBe(true);
    expect(fields.reducedMotionOverride).toBe('environment');
  });
});
