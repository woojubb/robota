/**
 * SCREEN-2002 — the TUI's one theme token model.
 *
 * Before this, five things decided a colour: `PALETTE` (Ink names), `ANSI` (raw SGR for the markdown
 * pipeline), `marked-terminal`'s own chalk defaults, `cli-highlight`'s `DEFAULT_THEME`, and a handful
 * of `chalk.<name>` calls. A theme that rewrote only the first two would leave a daltonized run with
 * red/green code blocks, because `cli-highlight` falls back PER KEY to its own theme. So the model
 * carries every group a renderer reads, and the style builder derives every encoding from it through
 * chalk — which is exactly what Ink's own `colorize` does, so no mapping layer is invented.
 *
 * Values use INK'S colour grammar verbatim (`<chalk name> | #rrggbb | ansi256(n) | rgb(r,g,b)`), so a
 * theme file, a built-in and a component all speak one language and the grammar doubles as the
 * injection floor: no raw escape sequence can enter through a theme.
 */

/** A colour in Ink's grammar. Validated at the boundary, never parsed twice. */
export type TThemeColor = string;

/** Foreground and border roles every Ink component reads. */
export interface IThemeColors {
  readonly text: {
    readonly accent: TThemeColor;
    readonly emphasis: TThemeColor;
    readonly success: TThemeColor;
    readonly warning: TThemeColor;
    readonly error: TThemeColor;
    readonly session: TThemeColor;
    readonly muted: TThemeColor;
    readonly onAccent: TThemeColor;
  };
  readonly border: {
    readonly attention: TThemeColor;
    readonly focused: TThemeColor;
    readonly active: TThemeColor;
    readonly muted: TThemeColor;
    readonly error: TThemeColor;
  };
  readonly status: {
    readonly running: TThemeColor;
    readonly success: TThemeColor;
    readonly error: TThemeColor;
    readonly denied: TThemeColor;
    readonly waiting: TThemeColor;
    readonly cancelled: TThemeColor;
    readonly idle: TThemeColor;
  };
}

/**
 * Every key `marked-terminal` colours by default, including `html` — a key left out would keep that
 * dependency's own gray under every theme.
 *
 * Deliberately absent, because they carry no colour today and giving them one would change rendering
 * rather than theme it: `strong` (`chalk.bold`), `em` (`chalk.italic`), `listitem` and `hr`
 * (`chalk.reset`), and a diff's `diff `/`index ` metadata rows, which this package writes itself as
 * dim over the inherited foreground.
 */
export interface IThemeMarkdown {
  readonly heading: TThemeColor;
  readonly firstHeading: TThemeColor;
  readonly code: TThemeColor;
  readonly codespan: TThemeColor;
  readonly link: TThemeColor;
  readonly href: TThemeColor;
  readonly blockquote: TThemeColor;
  readonly del: TThemeColor;
  readonly html: TThemeColor;
  readonly diffAdded: TThemeColor;
  readonly diffRemoved: TThemeColor;
  readonly diffAddedBackground: TThemeColor;
  readonly diffRemovedBackground: TThemeColor;
  readonly diffHunk: TThemeColor;
}

/**
 * `cli-highlight`'s seventeen coloured keys, ALL REQUIRED. Its `colorizeNode` reads
 * `theme[token] || DEFAULT_THEME[token] || plain`, so one missing key restores that dependency's
 * red/green pair — the exact thing a daltonized theme exists to remove.
 */
export interface IThemeSyntax {
  readonly keyword: TThemeColor;
  readonly built_in: TThemeColor;
  readonly type: TThemeColor;
  readonly literal: TThemeColor;
  readonly number: TThemeColor;
  readonly regexp: TThemeColor;
  readonly string: TThemeColor;
  readonly class: TThemeColor;
  readonly function: TThemeColor;
  readonly comment: TThemeColor;
  readonly doctag: TThemeColor;
  readonly meta: TThemeColor;
  readonly tag: TThemeColor;
  readonly name: TThemeColor;
  readonly attr: TThemeColor;
  readonly addition: TThemeColor;
  readonly deletion: TThemeColor;
}

/** The colour ramp of the package's one animation. Cadence is not themed. */
export interface IThemeMotion {
  readonly wave: readonly [TThemeColor, TThemeColor, TThemeColor, TThemeColor];
}

export type TThemeAppearance = 'dark' | 'light';
export type TThemeSource = 'built-in' | 'user' | 'plugin';

export interface ITuiTheme {
  /** `dark`, `light`, `dark-daltonized`, `light-daltonized`, `custom:<slug>`, `custom:<plugin>:<slug>`. */
  readonly id: string;
  readonly name: string;
  readonly appearance: TThemeAppearance;
  readonly source: TThemeSource;
  readonly colors: IThemeColors;
  readonly markdown: IThemeMarkdown;
  readonly syntax: IThemeSyntax;
  readonly motion: IThemeMotion;
}

/** The seventeen `syntax` keys, in the order `cli-highlight` declares them. */
export const THEME_SYNTAX_KEYS: readonly (keyof IThemeSyntax)[] = [
  'keyword',
  'built_in',
  'type',
  'literal',
  'number',
  'regexp',
  'string',
  'class',
  'function',
  'comment',
  'doctag',
  'meta',
  'tag',
  'name',
  'attr',
  'addition',
  'deletion',
];
