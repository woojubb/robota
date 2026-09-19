/**
 * SCREEN-2002 — one theme, every encoding.
 *
 * Ink reads `colors` directly. `marked-terminal` wants chalk STYLE FUNCTIONS and `cli-highlight` wants
 * a token→function map, so both are built here from the same values. Ink's own `colorize` is this
 * mapping (`chalk[name]` / `chalk.hex` / `chalk.ansi256` / `chalk.rgb`), which is why deriving them is
 * not the "name→SGR layer" SCREEN-006 refused to invent — chalk is already the layer, and a direct
 * dependency.
 *
 * The STRUCTURE of a markdown or syntax token is fixed here, not themed: a heading is bold, a first
 * heading underlined and bold, a blockquote italic, a deletion dim and struck through, an href
 * underlined, and a syntax `type` dim — exactly what the two dependencies do today. A theme changes
 * the colour and nothing else, which is what keeps the `dark` theme's rendering the one users know.
 */
import chalk, { Chalk, backgroundColorNames, foregroundColorNames } from 'chalk';

import { THEME_SYNTAX_KEYS } from './theme-contracts.js';

import type { IThemeMarkdown, IThemeSyntax, ITuiTheme, TThemeColor } from './theme-contracts.js';
import type { ChalkInstance } from 'chalk';

const HEX = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu;
const ANSI256 = /^ansi256\((\d{1,3})\)$/iu;
const RGB = /^rgb\((\d{1,3}),\s*(\d{1,3}),\s*(\d{1,3})\)$/iu;
const ANSI256_MAX = 255;

/**
 * chalk's own name tables, which it exports; its styles are prototype getters, so a table has to be
 * built from the names rather than from `Object.keys(chalk)`. This is the same set Ink's `colorize`
 * accepts, which is why the grammar needs no list of its own.
 *
 * A `Map`, not an object literal: an object built by `Object.fromEntries` inherits `Object.prototype`,
 * so a lookup of `constructor`, `toString`, `valueOf` or `__proto__` answers TRUTHY and the
 * `undefined` guard below never fires — a value that is not a colour name would be handed back as
 * though it were a style. That value becomes reachable the moment a parsed user theme (work unit 3)
 * reaches this builder.
 */
const CHALK_STYLES = new Map<string, ChalkInstance>(
  [...foregroundColorNames, ...backgroundColorNames].map((name) => [name, chalk[name]]),
);
const FOREGROUND_NAMES = new Set<string>(foregroundColorNames);

/** A FOREGROUND chalk name Ink would accept — a `bg…` name is not a token value. */
function isChalkColorName(value: string): boolean {
  return FOREGROUND_NAMES.has(value);
}

/** Whether a string is a colour in Ink's grammar. The one place the grammar is decided. */
export function isThemeColor(value: string): boolean {
  if (HEX.test(value)) return true;
  const ansi = ANSI256.exec(value);
  if (ansi) return Number(ansi[1]) <= ANSI256_MAX;
  const rgb = RGB.exec(value);
  if (rgb) return rgb.slice(1).every((part) => Number(part) <= ANSI256_MAX);
  return isChalkColorName(value);
}

function chalkNamed(name: string): ChalkInstance {
  return CHALK_STYLES.get(name) ?? chalk.reset;
}

/**
 * A foreground style for one theme value, optionally continuing a chain. The base matters: chalk
 * emits its SGR in chain order, so `chalk.dim` + a colour is not the same bytes as a colour + `.dim`,
 * and reproducing a dependency's own default means reproducing its order.
 */
export function foreground(color: TThemeColor, base: ChalkInstance = chalk): ChalkInstance {
  if (HEX.test(color)) return base.hex(color);
  const ansi = ANSI256.exec(color);
  if (ansi) return base.ansi256(Number(ansi[1]));
  const rgb = RGB.exec(color);
  if (rgb) return base.rgb(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  // Gated on the FOREGROUND names, not on the shared table: the table also holds the `bg…` entries
  // that `background()` needs, so asking it alone would answer `foreground('bgRed')` with a
  // background style — a name `isThemeColor` already refuses as a token value.
  const named = isChalkColorName(color) ? CHALK_STYLES.get(color) : undefined;
  if (named === undefined) return base;
  // A named colour continues the chain through chalk's own getter on the base instance.
  const chained = Reflect.get(base, color) as ChalkInstance | undefined;
  return chained ?? named;
}

/** A background style for one theme value. */
export function background(color: TThemeColor, base: ChalkInstance = chalk): ChalkInstance {
  if (HEX.test(color)) return base.bgHex(color);
  const ansi = ANSI256.exec(color);
  if (ansi) return base.bgAnsi256(Number(ansi[1]));
  const rgb = RGB.exec(color);
  if (rgb) return base.bgRgb(Number(rgb[1]), Number(rgb[2]), Number(rgb[3]));
  const capitalised = `bg${color.charAt(0).toUpperCase()}${color.slice(1)}`;
  const chained = Reflect.get(base, capitalised) as ChalkInstance | undefined;
  return chained ?? chalkNamed(capitalised);
}

/**
 * The diff rows are written by this package, not by a dependency, and their caller decides colour
 * with its own `color` flag — so a caller that asked for colour gets it even where chalk's own
 * detection says level 0. That is the behaviour the renderer had when it wrote the escapes by hand,
 * and the reason `renderMarkdown(md, { color: true })` still emits them off a TTY.
 *
 * What is forced is colour, NOT depth. Overriding a DETECTED level would downsample the rest of the
 * frame while these rows alone emit truecolor — visible on a 256-colour terminal with a hex-valued
 * theme, where `#56b4e9` is `ESC[38;5;117m` at level 2 and `ESC[38;2;86;180;233m` at level 3. So the
 * ambient level is kept whenever there is one, and only the OFF case is overridden.
 */
const TRUECOLOR = 3;
const FORCED_CHALK = new Chalk({ level: TRUECOLOR });

function diffRowBase(): ChalkInstance {
  return chalk.level === 0 ? FORCED_CHALK : chalk;
}

/** The `marked-terminal` constructor options: theme colour + the structure that is not themed. */
export function markdownRendererOptions(markdown: IThemeMarkdown): Record<string, ChalkInstance> {
  return {
    // Each chain reproduces marked-terminal's own default order, so the `dark` theme is byte-identical.
    heading: foreground(markdown.heading).bold,
    firstHeading: foreground(markdown.firstHeading).underline.bold,
    code: foreground(markdown.code),
    codespan: foreground(markdown.codespan),
    link: foreground(markdown.link),
    href: foreground(markdown.href).underline,
    blockquote: foreground(markdown.blockquote).italic,
    del: foreground(markdown.del, chalk.dim).strikethrough,
    html: foreground(markdown.html),
  };
}

/** The `cli-highlight` theme: every one of its seventeen coloured keys, so none falls back. */
export function syntaxHighlightTheme(syntax: IThemeSyntax): Record<string, ChalkInstance> {
  const theme: Record<string, ChalkInstance> = {};
  for (const key of THEME_SYNTAX_KEYS) {
    // `type` is `<colour>.dim` in cli-highlight's own theme: the modifier is structure, the colour is
    // the theme's, and the order is the dependency's, so the `dark` theme is byte-identical.
    theme[key] = key === 'type' ? foreground(syntax[key]).dim : foreground(syntax[key]);
  }
  return theme;
}

/** The styles the diff renderer writes around a row: background and foreground composed per row. */
export interface IDiffRowStyles {
  readonly added: (row: string) => string;
  readonly removed: (row: string) => string;
  readonly hunk: (row: string) => string;
  /** Structure only: dim over the inherited foreground, never a theme colour. */
  readonly meta: (row: string) => string;
}

export function diffRowStyles(theme: ITuiTheme): IDiffRowStyles {
  const { markdown } = theme;
  const base = diffRowBase();
  const addedBackground = background(markdown.diffAddedBackground, base);
  const addedForeground = foreground(markdown.diffAdded, base);
  const removedBackground = background(markdown.diffRemovedBackground, base);
  const removedForeground = foreground(markdown.diffRemoved, base);
  return {
    added: (row) => addedBackground(addedForeground(row)),
    removed: (row) => removedBackground(removedForeground(row)),
    hunk: foreground(markdown.diffHunk, base),
    // Dim over the INHERITED foreground, as this renderer always wrote it — colouring it would be a
    // rendering change dressed as a theme.
    meta: (row) => base.dim(row),
  };
}
