/**
 * SCREEN-2002 — the appearance a run renders with (agent-cli owned).
 *
 * Two of the three appearance settings are read and passed through unchanged; the third,
 * `reducedMotion`, is the one a single run can override, so it gets a precedence chain:
 *
 *   settings.json `reducedMotion` ← `ROBOTA_REDUCED_MOTION=1|0` ← `--reduced-motion` /
 *   `--no-reduced-motion` (the flag wins).
 *
 * Flag-wins, matching `screen-reader-enablement.ts` rather than the env-wins `memory-enablement.ts`:
 * the reason accessibility inverts the older precedent is that a per-invocation flag must be able to
 * decide the mode for ONE run on a machine whose environment says otherwise, and that argument
 * applies to motion exactly as it does to the screen reader.
 *
 * What this module does NOT do is decide whether motion actually happens. The colour gate and
 * screen-reader mode still win over every tier here — that rule lives in `useMotion()`, and keeping
 * it there is what stops two places from disagreeing about the same question. This resolver answers
 * only "what did the user ask for, and who asked".
 */

import { readAppearanceSettings } from '@robota-sdk/agent-framework';

import type { IAppearanceSettings, TSettingsData } from '@robota-sdk/agent-framework';
import type { TReducedMotionOverride } from '@robota-sdk/agent-command';

/** `1` enables, `0` disables; anything else is not an opinion. */
const REDUCED_MOTION_ENV = 'ROBOTA_REDUCED_MOTION';

export interface IReducedMotionInputs {
  /** What the settings document persists. */
  settings: boolean;
  /** `--reduced-motion` (true) / `--no-reduced-motion` (false); `undefined` when neither is given. */
  flag?: boolean | undefined;
  /** Raw `ROBOTA_REDUCED_MOTION` value. */
  env?: string | undefined;
}

export interface IResolvedReducedMotion {
  /** What this run uses. */
  readonly reducedMotion: boolean;
  /**
   * Set when a tier ABOVE the settings decided it. The picker and `/theme` report this so a user who
   * changes the setting and sees no effect is told why, rather than concluding the setting is broken.
   */
  readonly override?: TReducedMotionOverride;
}

function readEnv(value: string | undefined): boolean | undefined {
  if (value === '1') return true;
  if (value === '0') return false;
  return undefined;
}

export function resolveReducedMotion(inputs: IReducedMotionInputs): IResolvedReducedMotion {
  if (inputs.flag !== undefined) {
    // An explicit flag is an override even when it AGREES with the settings: the user pinned it for
    // this run, and `/theme motion on` must report that it cannot take effect until the next one.
    return { reducedMotion: inputs.flag, override: 'flag' };
  }
  const env = readEnv(inputs.env);
  if (env !== undefined) return { reducedMotion: env, override: 'environment' };
  return { reducedMotion: inputs.settings };
}

export interface IAppearanceRenderFields {
  /** The persisted appearance, unchanged — what `/theme` reports as stored. */
  readonly appearance: IAppearanceSettings;
  /** What this run renders with, which may differ from `appearance.reducedMotion`. */
  readonly reducedMotion: boolean;
  /** Which tier decided it, when that was not the settings. */
  readonly reducedMotionOverride?: TReducedMotionOverride;
}

/** The one call the CLI startup path makes: settings document + flag + environment ⇒ render fields. */
export function resolveAppearanceRenderFields(
  settings: TSettingsData | undefined,
  flag: boolean | undefined,
  env: Readonly<Record<string, string | undefined>>,
): IAppearanceRenderFields {
  const appearance = readAppearanceSettings(settings ?? {});
  const resolved = resolveReducedMotion({
    settings: appearance.reducedMotion,
    flag,
    env: env[REDUCED_MOTION_ENV],
  });
  return {
    appearance,
    reducedMotion: resolved.reducedMotion,
    ...(resolved.override === undefined ? {} : { reducedMotionOverride: resolved.override }),
  };
}
