import chalk from 'chalk';
import { afterEach, describe, expect, it } from 'vitest';

import { renderMarkdown } from '../render-markdown.js';
import { DARK_DALTONIZED_THEME, DARK_THEME } from '../theme/built-in-themes.js';
import { foreground } from '../theme/index.js';

const ANSI_LIGHT_RED = '\u001b[38;5;210m';
const ANSI_LIGHT_GREEN = '\u001b[38;5;120m';
const ANSI_DARK_RED_BACKGROUND = '\u001b[48;5;52m';
const ANSI_DARK_GREEN_BACKGROUND = '\u001b[48;5;22m';
// SCREEN-2002: the rows are styled through chalk now, which closes a background+foreground pair with
// its own paired resets instead of the blanket `ESC[0m` the hand-written escapes used. The colours
// and their order are unchanged; this is the one recorded byte difference.
const ANSI_RESET_FOREGROUND = '\u001b[39m';
const ANSI_RESET_BACKGROUND = '\u001b[49m';
const CODE_BLOCK_INDENT = '    ';
/** Any SGR introducer — a plain block must carry none. */
const SGR_ANY = '\u001b[';

describe('renderMarkdown', () => {
  it('renders diff fenced code blocks with addition and removal colors', () => {
    const output = renderMarkdown(
      ['Before', '', '```diff', '- const oldValue = true;', '+ const newValue = true;', '```'].join(
        '\n',
      ),
      { color: true },
    );

    expect(output).toContain(`${ANSI_DARK_RED_BACKGROUND}${ANSI_LIGHT_RED}`);
    expect(output).toContain(`${CODE_BLOCK_INDENT}- const oldValue = true;`);
    expect(output).toContain(`${ANSI_DARK_GREEN_BACKGROUND}${ANSI_LIGHT_GREEN}`);
    expect(output).toContain(`${CODE_BLOCK_INDENT}+ const newValue = true;`);
  });

  it('pads added and removed diff rows before applying background colors', () => {
    const codeBlockWidth = 24;
    const removedRow = `${CODE_BLOCK_INDENT}- removed`.padEnd(codeBlockWidth);
    const addedRow = `${CODE_BLOCK_INDENT}+ added`.padEnd(codeBlockWidth);
    const output = renderMarkdown(['```diff', '- removed', '+ added', '```'].join('\n'), {
      color: true,
      codeBlockWidth,
    });

    expect(output).toContain(
      `${ANSI_DARK_RED_BACKGROUND}${ANSI_LIGHT_RED}${removedRow}${ANSI_RESET_FOREGROUND}${ANSI_RESET_BACKGROUND}`,
    );
    expect(output).toContain(
      `${ANSI_DARK_GREEN_BACKGROUND}${ANSI_LIGHT_GREEN}${addedRow}${ANSI_RESET_FOREGROUND}${ANSI_RESET_BACKGROUND}`,
    );
  });

  it('keeps diff fenced code block content readable when color is disabled', () => {
    const output = renderMarkdown(
      ['```diff', '- removed line', '+ added line', ' unchanged line', '```'].join('\n'),
      { color: false },
    );

    expect(output).toContain('- removed line');
    expect(output).toContain('+ added line');
    expect(output).toContain(' unchanged line');
    expect(output).not.toContain(ANSI_LIGHT_RED);
    expect(output).not.toContain(ANSI_LIGHT_GREEN);
    expect(output).not.toContain(ANSI_DARK_RED_BACKGROUND);
    expect(output).not.toContain(ANSI_DARK_GREEN_BACKGROUND);
  });

  it('keeps regular fenced code blocks as code output', () => {
    const output = renderMarkdown(['```ts', 'const value: string = "ok";', '```'].join('\n'), {
      color: false,
    });

    expect(output).toContain('const value: string = "ok";');
  });

  /**
   * SCREEN-2002 TC-03 — the theme reaches `cli-highlight`.
   *
   * This is the unit's most dependency-fragile claim, and the failure it guards against is SILENT:
   * `cli-highlight` falls back PER KEY to its own `DEFAULT_THEME`, whose `keyword` is red and whose
   * `addition` is green. If the theme stopped reaching it, a daltonized run would quietly get the
   * red/green pair back with every other surface still daltonized, and nothing else in the suite
   * would notice.
   */
  describe('SCREEN-2002 TC-03: syntax highlighting follows the theme', () => {
    const TS_BLOCK = ['```ts', 'const value = 1;', '```'].join('\n');
    const TRUECOLOR = 3;
    const previousLevel = chalk.level;
    afterEach(() => {
      chalk.level = previousLevel;
    });

    const openCode = (color: string): string => foreground(color)('x').split('x')[0] ?? '';

    it('colours a keyword with the theme s value, not cli-highlight s default', () => {
      chalk.level = TRUECOLOR;
      const daltonized = renderMarkdown(TS_BLOCK, {
        color: true,
        theme: DARK_DALTONIZED_THEME,
      });

      expect(daltonized).toContain(openCode(DARK_DALTONIZED_THEME.syntax.keyword));
      // cli-highlight's own default `keyword` — the colour a per-key fallback would restore.
      expect(daltonized).not.toContain(openCode(DARK_THEME.syntax.keyword));
    });

    it('renders a code block as plain indented text when highlighting is off', () => {
      chalk.level = TRUECOLOR;
      const plain = renderMarkdown(TS_BLOCK, {
        color: true,
        theme: DARK_DALTONIZED_THEME,
        syntaxHighlighting: false,
      });

      expect(plain).toContain(`${CODE_BLOCK_INDENT}const value = 1;`);
      expect(plain).not.toContain(openCode(DARK_DALTONIZED_THEME.syntax.keyword));
      expect(plain).not.toContain(SGR_ANY);
    });
  });

  /**
   * CLI-2004 TC-04 — the `Header: value` flattening, asserted at the single choke point every
   * render path shares. A box-drawn grid is read aloud as its rules; the pairing is the content.
   */
  describe('CLI-2004 TC-04: screen-reader table flattening', () => {
    const TABLE = ['| A | B |', '|---|---|', '| 1 | 2 |'].join('\n');
    const BOX_DRAWING = /[\u2502\u2500\u250c\u2510\u2514\u2518\u251c\u2524\u252c\u2534\u253c]/u;

    it('flattens a table to one `Header: value` line per cell in the mode', () => {
      const output = renderMarkdown(TABLE, { color: false, screenReader: true });

      const lines = output.split('\n').map((line) => line.trim());
      expect(lines).toContain('A: 1');
      expect(lines).toContain('B: 2');
      expect(lines.indexOf('A: 1')).toBeLessThan(lines.indexOf('B: 2'));
      expect(output).not.toMatch(BOX_DRAWING);
    });

    it('separates rows with a blank line so the row boundary is audible', () => {
      const twoRows = ['| A | B |', '|---|---|', '| 1 | 2 |', '| 3 | 4 |'].join('\n');
      const output = renderMarkdown(twoRows, { color: false, screenReader: true });

      expect(output).toContain('A: 1\nB: 2\n\nA: 3\nB: 4');
    });

    it('leaves the box-drawn grid exactly as it is outside the mode', () => {
      const output = renderMarkdown(TABLE, { color: false });

      expect(output).toMatch(BOX_DRAWING);
      expect(output).not.toContain('A: 1');
    });
  });

  it('keeps inline markdown formatting readable', () => {
    const output = renderMarkdown('Use **bold** and `code` here.', { color: false });

    expect(output).toContain('bold');
    expect(output).toContain('code');
  });
});
