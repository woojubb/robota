/**
 * SCREEN-2002 — the run's theme surface, assembled once.
 *
 * One registry reaches two consumers: the `/theme` command, through its catalogue port, and
 * `renderApp`. They must be the same instance or a listing and a switch can disagree about which
 * themes exist — the arrangement `keybindingsSource` already uses for the same reason.
 *
 * Assembled here rather than inline in `cli.ts` because that file sits at its `file-size` floor and
 * because a composition belongs beside its siblings in `startup/`, not in the shell that calls it.
 */
import { getUserSettingsPath, readSettings } from '@robota-sdk/agent-framework';
import { createThemeCataloguePort, createThemeRegistry } from '@robota-sdk/agent-ui-terminal';

import { resolveAppearanceRenderFields } from './appearance-enablement.js';

import type { IThemeRegistry } from '@robota-sdk/agent-ui-terminal';
import type { TSettingsData } from '@robota-sdk/agent-framework';
import type { IThemeCataloguePort, TReducedMotionOverride } from '@robota-sdk/agent-command';

export interface IThemeSurfaceOptions {
  /**
   * Whether this run renders a terminal UI at all. Print mode, `--goal` and `--serve` render no
   * themes, so they get no registry and no command — the same absence that keeps `/keybindings`
   * unregistered there.
   */
  readonly enabled: boolean;
  /** The settings document already read at startup, for the values this run begins with. */
  readonly settings: TSettingsData | undefined;
  /** `--reduced-motion` / `--no-reduced-motion`; `undefined` when neither was given. */
  readonly reducedMotionFlag: boolean | undefined;
  readonly env: Readonly<Record<string, string | undefined>>;
}

export interface IThemeSurface {
  readonly registry: IThemeRegistry | undefined;
  readonly cataloguePort: IThemeCataloguePort | undefined;
  /** What this run renders with, after settings ← env ← flag. */
  readonly reducedMotion: boolean;
  /**
   * Which tier decided it, when that was not the settings. The picker renders this, the same way
   * `/theme list` and `/theme motion` report it — without it the picker is the one surface of the
   * three that can show `motion on` on a visibly still run.
   */
  readonly reducedMotionOverride?: TReducedMotionOverride | undefined;
}

export function createThemeSurface(options: IThemeSurfaceOptions): IThemeSurface {
  const resolved = resolveAppearanceRenderFields(
    options.settings,
    options.reducedMotionFlag,
    options.env,
  );
  const motion = {
    reducedMotion: resolved.reducedMotion,
    ...(resolved.reducedMotionOverride === undefined
      ? {}
      : { reducedMotionOverride: resolved.reducedMotionOverride }),
  };
  if (!options.enabled) {
    return { registry: undefined, cataloguePort: undefined, ...motion };
  }
  const registry = createThemeRegistry();
  const cataloguePort = createThemeCataloguePort({
    registry,
    // Re-read per call, never the startup snapshot: the host writes the settings document when it
    // applies an `appearance-settings-patch`, so a captured value would make `/theme list` report
    // the change the user just made as not having happened.
    readAppearance: () =>
      resolveAppearanceRenderFields(readSettings(getUserSettingsPath()), undefined, {}).appearance,
    ...(resolved.reducedMotionOverride === undefined
      ? {}
      : { reducedMotionOverride: resolved.reducedMotionOverride }),
  });
  return { registry, cataloguePort, ...motion };
}
