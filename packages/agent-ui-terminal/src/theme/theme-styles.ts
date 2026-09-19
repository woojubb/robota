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
 */
const CHALK_STYLES: Record<string, ChalkInstance | undefined> = Object.fromEntries(
  [...foregroundColorNames, ...backgroundColorNames].map((name) => [name, chalk[name]]),
);

/** A chalk name Ink would accept. */
function isChalkColorName(value: string): boolean {
  return typeof CHALK_STYLES[value] === 'function';
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
  return CHALK_STYLES[name] ?? chalk.reset;
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
  const named = CHALK_STYLES[color];
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
 * with its own `color` flag — so they are styled through a level-forced instance rather than
 * chalk's ambient detection. That is the behaviour the renderer had when it wrote the escapes by
 * hand, and the reason `renderMarkdown(md, { color: true })` still emits them off a TTY.
 */
const TRUECOLOR = 3;
const FORCED_CHALK = new Chalk({ level: TRUECOLOR });

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
    // `type` is dim in cli-highlight's own theme; the modifier is structure, the colour is the theme's.
    // `type` is `<colour>.dim` in cli-highlight's own theme — the modifier is structure, the colour
    // is the theme's, and the order is the dependency's so the `dark` theme is byte-identical.
    theme[key] = key === 'type' ? foreground(syntax[key]).dim : foreground(syntax[key]);
  }
  return theme;
}

/** The styles the diff renderer writes around a row: background and foreground composed per row. */
export interface IDiffRowStyles {
  readonly added: (row: string) => string;
  readonly removed: (row: string) => string;
  readonly hunk: (row: string) => string;
  readonly meta: (row: string) => string;
}

export function diffRowStyles(theme: ITuiTheme): IDiffRowStyles {
  const { markdown } = theme;
  const base = FORCED_CHALK;
  const addedBackground = background(markdown.diffAddedBackground, base);
  const addedForeground = foreground(markdown.diffAdded, base);
  const removedBackground = background(markdown.diffRemovedBackground, base);
  const removedForeground = foreground(markdown.diffRemoved, base);
  return {
    added: (row) => addedBackground(addedForeground(row)),
    removed: (row) => removedBackground(removedForeground(row)),
    hunk: foreground(markdown.diffHunk, base),
    meta: foreground(markdown.diffMeta, base).dim,
  };
}
