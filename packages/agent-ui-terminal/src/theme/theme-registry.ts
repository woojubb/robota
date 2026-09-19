/**
 * SCREEN-2002 — the theme catalogue, and the port the command layer asks through.
 *
 * The registry is the only thing that turns an ID into a theme. Work unit 1 put the built-ins
 * behind `listBuiltInThemes()`; work unit 3 adds user and plugin themes to the same list, and
 * nothing downstream has to learn where a theme came from — a row carries its `source` so the
 * picker and `/theme list` can SAY where it came from, which is a different question.
 *
 * An unknown id resolves to the default and reports the id it could not find. Resolving silently
 * would make a removed plugin look like a theme that stopped working, and the id is the only thing
 * that can name the cause.
 */
import { DEFAULT_THEME_ID, listBuiltInThemes, resolveTheme } from './built-in-themes.js';

// The registry's default source, re-exported from the module that USES it. The package's public
// surface takes this route rather than the theme barrel: the barrel re-exports `theme-context.tsx`,
// and a public re-export chain that reaches a `.tsx` is what `sdk-public-surface` refuses.
export { listBuiltInThemes } from './built-in-themes.js';

import type { ITuiTheme } from './theme-contracts.js';
import type {
  IThemeAppearanceState,
  IThemeCatalogueEntry,
  IThemeCataloguePort,
  TReducedMotionOverride,
} from '@robota-sdk/agent-interface-command';

/**
 * A theme file that was found and refused. It is carried BESIDE the themes rather than among them,
 * because a surface must be able to show the file without ever resolving to it — an id that can be
 * listed and cannot be applied is the shape of the bug this avoids.
 */
export interface IThemeSkip {
  /**
   * The id the file WOULD have had, so a `/theme <id>` that fails has a visible reason — or, when
   * the file's own NAME is what made an id impossible, the quoted name in its place. It is a label,
   * not a key: two files can carry the same one.
   */
  readonly id: string;
  readonly fileName: string;
  /** The path-named diagnostic, verbatim from `parseThemeDocument`. */
  readonly reason: string;
}

export interface IThemeResolution {
  readonly theme: ITuiTheme;
  /** The id that was asked for and not found. Absent ⇒ the request was satisfied. */
  readonly unknownId?: string;
}

export interface IThemeRegistry {
  list(): readonly ITuiTheme[];
  get(id: string): ITuiTheme | undefined;
  /** The theme for an id, falling back to the default and NAMING what it could not find. */
  resolve(id: string | undefined): IThemeResolution;
  /** The theme files that were found and refused, with the reason each was refused for. */
  skipped(): readonly IThemeSkip[];
}

export function createThemeRegistry(
  themes: readonly ITuiTheme[] = listBuiltInThemes(),
  skipped: readonly IThemeSkip[] = [],
): IThemeRegistry {
  const byId = new Map(themes.map((theme) => [theme.id, theme]));
  return {
    list: () => themes,
    skipped: () => skipped,
    get: (id) => byId.get(id),
    resolve: (id) => {
      if (id === undefined || id === DEFAULT_THEME_ID) {
        return { theme: resolveTheme(byId.get(DEFAULT_THEME_ID)) };
      }
      const found = byId.get(id);
      if (found) return { theme: found };
      return { theme: resolveTheme(byId.get(DEFAULT_THEME_ID)), unknownId: id };
    },
  };
}

/** The line a run prints once when its persisted theme is not installed. */
export function formatUnknownThemeNotice(id: string): string {
  return `Theme "${id}" is not installed — using "${DEFAULT_THEME_ID}".`;
}

function toEntry(theme: ITuiTheme): IThemeCatalogueEntry {
  return {
    id: theme.id,
    name: theme.name,
    appearance: theme.appearance,
    source: theme.source,
  };
}

export interface IThemeCataloguePortOptions {
  readonly registry: IThemeRegistry;
  /**
   * Re-read on every call, not captured once: `/theme` reports what is PERSISTED, and the host
   * applies a patch by writing the settings document. A snapshot would answer with the appearance
   * the process started with, so the command would report the change it just made as not having
   * happened.
   */
  readonly readAppearance: () => IThemeAppearanceState['settings'];
  /**
   * The pin on reduced motion for this run, when something above the settings applied one — WHICH
   * tier and WHAT it pinned, as one value. Two optional fields would let a caller supply the tier
   * alone, and a default for the missing half is exactly the wrong answer this pair exists to stop:
   * `--no-reduced-motion` is an override too and pins the opposite value.
   */
  readonly reducedMotionPin?:
    { readonly tier: TReducedMotionOverride; readonly reducedMotion: boolean } | undefined;
}

export function createThemeCataloguePort(options: IThemeCataloguePortOptions): IThemeCataloguePort {
  return {
    listThemes: () => options.registry.list().map(toEntry),
    getTheme: (id) => {
      const theme = options.registry.get(id);
      return theme ? toEntry(theme) : undefined;
    },
    getAppearance: () => ({
      settings: options.readAppearance(),
      ...(options.reducedMotionPin === undefined
        ? {}
        : {
            reducedMotionOverride: options.reducedMotionPin.tier,
            reducedMotionForRun: options.reducedMotionPin.reducedMotion,
          }),
    }),
  };
}
