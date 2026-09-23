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
import { readSettings } from '@robota-sdk/agent-framework';
import { robotaUserSettingsPath } from '../product/robota-user-settings.js';
import {
  createThemeCataloguePort,
  createThemeRegistry,
  listBuiltInThemes,
} from '@robota-sdk/agent-ui-terminal';

import { resolveAppearanceRenderFields } from './appearance-enablement.js';
import { loadThemeSources } from './theme-sources.js';

import type { IThemeRegistry, IThemeSkip } from '@robota-sdk/agent-ui-terminal';
import type { TSettingsData, TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';
import type { IThemeCataloguePort, TReducedMotionOverride } from '@robota-sdk/agent-command';

export interface IThemeSurfaceOptions {
  /** Where the run was started, for the plugin scopes. `undefined` leaves the user scope alone. */
  readonly cwd: string | undefined;
  /** Project plugin themes are visible only after workspace trust is granted. */
  readonly projectAccess?: TWorkspaceProjectAccess;
  /** The home directory `~/.robota/themes` is read from. Home-only, like `~/.robota/output-styles`. */
  readonly userHome: string;
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
  /**
   * The theme files that were found and refused. Printed once at startup, and carried on the
   * registry so the picker can show the same file as a disabled row — one list, two surfaces,
   * rather than a printed line the picker knows nothing about.
   */
  readonly skipped: readonly IThemeSkip[];
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
    // No terminal UI, so no theme is rendered and no file is read: a print-mode run must not spend
    // a directory walk, and must not print a skip line about a file nothing was going to use.
    return { registry: undefined, cataloguePort: undefined, skipped: [], ...motion };
  }
  const sources = loadThemeSources({
    cwd: options.cwd,
    userHome: options.userHome,
    ...(options.projectAccess === undefined ? {} : { projectAccess: options.projectAccess }),
  });
  const registry = createThemeRegistry(
    [...listBuiltInThemes(), ...sources.themes],
    sources.skipped,
  );
  const cataloguePort = createThemeCataloguePort({
    registry,
    // Re-read per call, never the startup snapshot: the host writes the settings document when it
    // applies an `appearance-settings-patch`, so a captured value would make `/theme list` report
    // the change the user just made as not having happened.
    readAppearance: () =>
      resolveAppearanceRenderFields(readSettings(robotaUserSettingsPath()), undefined, {}).appearance,
    ...(resolved.reducedMotionOverride === undefined
      ? {}
      : {
          reducedMotionPin: {
            tier: resolved.reducedMotionOverride,
            reducedMotion: resolved.reducedMotion,
          },
        }),
  });
  return { registry, cataloguePort, skipped: sources.skipped, ...motion };
}
