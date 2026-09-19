/**
 * SCREEN-2002 TC-01/TC-02 — the token model and the style builder.
 *
 * The load-bearing assertion is the `dark` theme against the values the package shipped before the
 * theme existed: the whole unit is only safe if a user who sets nothing sees the same colours. The
 * four recorded byte exceptions (chalk's paired closers, the builder's SGR chain order, `type` keeping
 * `dim`, and `strong`/`em`/`listitem` not being theme tokens) are asserted by name here rather than
 * discovered later.
 */
import chalk from 'chalk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { BUILT_IN_THEMES, DARK_THEME } from '../built-in-themes.js';
import { THEME_SYNTAX_KEYS } from '../theme-contracts.js';
import {
  background,
  diffRowStyles,
  foreground,
  isThemeColor,
  markdownRendererOptions,
  syntaxHighlightTheme,
} from '../theme-styles.js';

/** cli-highlight's own coloured keys, read from the dependency when this test was written. */
const CLI_HIGHLIGHT_COLOURED_KEYS = [
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

const SGR = '\u001b[';
const TRUECOLOR = 3;

// chalk emits nothing when the test process has no TTY; these assertions are ABOUT the bytes, so the
// level is forced for the file and restored afterwards.
const originalLevel = chalk.level;
beforeAll(() => {
  chalk.level = TRUECOLOR;
});
afterAll(() => {
  chalk.level = originalLevel;
});

describe('theme colour grammar (SCREEN-2002 TC-01)', () => {
  it('accepts Inks grammar and nothing else', () => {
    for (const value of [
      'cyan',
      'yellowBright',
      'gray',
      '#abc',
      '#123456',
      'ansi256(22)',
      'rgb(1, 2, 3)',
    ]) {
      expect(isThemeColor(value)).toBe(true);
    }
    for (const value of [
      '',
      'nosuchcolour',
      '#12345',
      'ansi256(256)',
      'rgb(1,2)',
      `${SGR}31m`,
      'cyan bold',
      // A chalk BACKGROUND name is a real chalk style but never a token value: every token in the
      // model is a foreground, and `background()` derives the `bg…` name from it.
      'bgRed',
      'bgCyan',
    ]) {
      expect(isThemeColor(value)).toBe(false);
    }
  });

  it('builds a complete cli-highlight theme so no key falls back to its red/green default', () => {
    expect([...THEME_SYNTAX_KEYS]).toEqual(CLI_HIGHLIGHT_COLOURED_KEYS);
    for (const theme of BUILT_IN_THEMES) {
      const built = syntaxHighlightTheme(theme.syntax);
      expect(Object.keys(built).sort()).toEqual([...CLI_HIGHLIGHT_COLOURED_KEYS].sort());
    }
  });
});

describe('the dark theme reproduces todays rendering (SCREEN-2002 TC-02)', () => {
  it('keeps every Ink colour value the package shipped', () => {
    expect(DARK_THEME.colors).toEqual({
      text: {
        accent: 'cyan',
        emphasis: 'white',
        success: 'green',
        warning: 'yellow',
        error: 'red',
        session: 'magenta',
        muted: 'gray',
        onAccent: 'black',
      },
      border: {
        attention: 'yellow',
        focused: 'cyan',
        active: 'green',
        muted: 'gray',
        error: 'red',
      },
      status: {
        running: 'yellow',
        success: 'green',
        error: 'red',
        denied: 'yellowBright',
        waiting: 'yellow',
        cancelled: 'yellow',
        idle: 'gray',
      },
    });
    expect(DARK_THEME.motion.wave).toEqual(['#555555', '#777777', '#999999', '#bbbbbb']);
  });

  it('renders each markdown token in marked-terminals own colour, with its structure fixed', () => {
    const options = markdownRendererOptions(DARK_THEME.markdown);
    // Byte equality against marked-terminal's own defaults: the builder reproduces each chain in the
    // dependency's order, so the `dark` theme leaves markdown rendering untouched.
    expect(options.heading?.('H')).toBe(chalk.green.bold('H'));
    expect(options.code?.('C')).toBe(chalk.yellow('C'));
    expect(options.codespan?.('C')).toBe(chalk.yellow('C'));
    expect(options.link?.('L')).toBe(chalk.blue('L'));
    expect(options.html?.('X')).toBe(chalk.gray('X'));
    expect(options.firstHeading?.('F')).toBe(chalk.magenta.underline.bold('F'));
    expect(options.blockquote?.('B')).toBe(chalk.gray.italic('B'));
    expect(options.del?.('D')).toBe(chalk.dim.gray.strikethrough('D'));
    expect(options.href?.('A')).toBe(chalk.blue.underline('A'));
    // `strong`, `em`, `listitem` and `hr` are NOT theme tokens: the builder never supplies them, so
    // marked-terminal keeps `chalk.bold` / `chalk.italic` / `chalk.reset` under every theme.
    expect(options.strong).toBeUndefined();
    expect(options.em).toBeUndefined();
    expect(options.listitem).toBeUndefined();
    expect(options.hr).toBeUndefined();
  });

  it('keeps cli-highlights `type` dim while taking its colour from the theme', () => {
    const syntax = syntaxHighlightTheme(DARK_THEME.syntax);
    expect(syntax.type?.('T')).toBe(chalk.cyan.dim('T'));
    expect(syntax.keyword?.('K')).toBe(chalk.blue('K'));
    expect(syntax.string?.('S')).toBe(chalk.red('S'));
  });

  it('paints diff rows with the former ANSI background/foreground pair', () => {
    const styles = diffRowStyles(DARK_THEME);
    const added = styles.added('+row');
    // The former literal escapes: 48;5;22 background, 38;5;120 foreground.
    expect(added).toContain(`${SGR}48;5;22m`);
    expect(added).toContain(`${SGR}38;5;120m`);
    const removed = styles.removed('-row');
    expect(removed).toContain(`${SGR}48;5;52m`);
    expect(removed).toContain(`${SGR}38;5;210m`);
    // The hunk header takes the theme's colour; the `diff `/`index ` metadata rows take dim over the
    // INHERITED foreground, exactly as this renderer always wrote them — no colour, no exception.
    expect(styles.hunk('@@ -1 +1 @@')).toBe(chalk.cyan('@@ -1 +1 @@'));
    expect(styles.meta('diff --git a/x b/x')).toBe(chalk.dim('diff --git a/x b/x'));
    // Recorded exception: chalk closes with the paired resets, not the blanket reset.
    expect(added.endsWith(`${SGR}0m`)).toBe(false);
    expect(added).toContain(`${SGR}39m`);
    expect(added).toContain(`${SGR}49m`);
  });

  it('refuses a background name where a foreground was asked for', () => {
    // `isThemeColor` refuses `bgRed` as a token value; the builder must agree rather than hand back
    // a background style. The style table holds the `bg…` entries for `background()`'s use.
    expect(() => foreground('bgRed')).toThrow(/bgRed/u);
    expect(background('red')('x')).toBe(chalk.bgRed('x'));
  });

  it('THROWS on a value outside the grammar rather than answering with a default style', () => {
    // SCREEN-2002 work unit 3. These two answered the same question differently and silently —
    // `foreground` with its base, `background` with `chalk.reset` — so a value neither could encode
    // rendered as unstyled text in one place and as a reset in another. Unreachable while every
    // value came from a validated built-in; reachable the moment a parsed file reaches the builder,
    // which is why `parseThemeDocument` refuses a file WHOLE and this refuses what gets past it.
    expect(() => foreground('not-a-colour')).toThrow(/not-a-colour/u);
    expect(() => background('not-a-colour')).toThrow(/not-a-colour/u);
    // The refusal names the grammar, because the value came from a file someone has to fix — and
    // it names it COMPLETELY. `HEX` has always accepted the three-digit form, so a grammar string
    // that lists only `#rrggbb` tells an author a value the builder accepts is invalid, in the one
    // message they will read about it.
    expect(() => foreground('not-a-colour')).toThrow(/#rgb \| #rrggbb/u);
  });

  it('accepts the three-digit hex form the grammar advertises', () => {
    expect(isThemeColor('#0f0')).toBe(true);
    expect(foreground('#0f0')('x')).toBe(chalk.hex('#0f0')('x'));
    expect(background('#0f0')('x')).toBe(chalk.bgHex('#0f0')('x'));
  });

  it('keeps the terminals own colour DEPTH for diff rows when there is one', () => {
    const daltonized = BUILT_IN_THEMES.find((theme) => theme.id === 'dark-daltonized');
    expect(daltonized).toBeDefined();
    const ANSI256 = 2;
    const previous = chalk.level;
    try {
      // A 256-colour terminal: the row must downsample with the rest of the frame, not emit
      // truecolor on its own because the diff renderer forced a level.
      chalk.level = ANSI256;
      const row = diffRowStyles(daltonized ?? DARK_THEME).added('+row');
      expect(row).toContain(`${SGR}38;5;`);
      expect(row).not.toContain(`${SGR}38;2;`);
      // Colour OFF is the one case that IS overridden — the caller asked for colour.
      chalk.level = 0;
      const forced = diffRowStyles(daltonized ?? DARK_THEME).added('+row');
      expect(forced).toContain(`${SGR}38;2;`);
    } finally {
      chalk.level = previous;
    }
  });

  it('renders a light theme in different bytes from the dark one', () => {
    const light = BUILT_IN_THEMES.find((theme) => theme.id === 'light');
    expect(light).toBeDefined();
    expect(foreground(light?.colors.text.accent ?? 'cyan')('x')).not.toBe(
      foreground(DARK_THEME.colors.text.accent)('x'),
    );
  });
});
