/**
 * SCREEN-006 anti-drift consistency floor — the mechanical floor for the color-token SSOT.
 *
 * Every component must consume `PALETTE`/`MOTION` tokens (src/tui-palette.ts) instead of
 * spelling Ink color names or hex values inline. This scan reads every source file in the
 * package (excluding the two token modules themselves and tests) and fails on any
 * `color="…"` / `borderColor="…"` / `backgroundColor="…"` JSX string literal and on any
 * `#rrggbb` hex literal. Precedent: `key-hint-consistency.test.tsx` (the SCREEN-005 floor).
 *
 * SCREEN-2002 added the two ratchets the SCREEN-006 limit predicted. The deferred case — "a future
 * TS helper returning a bare color-name string" — recurred twice (`getContextColor`,
 * `STATUS_GLYPH[...].color`), so the floor now also refuses any file outside `src/theme/` that
 * imports the built-in theme data or calls a chalk COLOUR function. `chalk.inverse` (a modifier, the
 * drawn cursor) and `chalk.level` (the colour gate) are deliberately untouched: they choose no colour.
 *
 * What the floor still cannot see: a colour-name string returned from a helper that neither imports
 * the theme data nor calls chalk — e.g. a literal `'cyan'` returned by a pure function. The type
 * system covers the tokens it flows into; this limit is recorded rather than claimed away.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** `src/theme/` holds the token data and the one chalk boundary; nothing else may. */
const THEME_DIR = 'theme';
const EXCLUDED_DIRS = new Set(['__tests__']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

const COLOR_ATTR_LITERAL = /\b(?:color|borderColor|backgroundColor)="[^"]*"/g;
const HEX_LITERAL = /#[0-9a-fA-F]{6}\b/g;
/** SCREEN-2002: the built-in colour DATA may be imported only from inside `src/theme/`. */
const BUILT_IN_THEME_IMPORT = /from\s+'[^']*built-in-themes\.js'/g;
/** SCREEN-2002: a chalk COLOUR call outside `src/theme/` decides a colour the theme should own. */
const CHALK_COLOR_CALL = /\bchalk\.(?!inverse\b|level\b|reset\b)[A-Za-z]+[.(]/g;

interface IFinding {
  file: string;
  line: number;
  match: string;
}

function collectSourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (EXCLUDED_DIRS.has(entry.name)) continue;
      files.push(...collectSourceFiles(join(dir, entry.name)));
      continue;
    }
    if (!SOURCE_EXTENSIONS.some((ext) => entry.name.endsWith(ext))) continue;
    files.push(join(dir, entry.name));
  }
  return files;
}

function scanFile(filePath: string, pattern: RegExp): IFinding[] {
  const findings: IFinding[] = [];
  const lines = readFileSync(filePath, 'utf8').split('\n');
  lines.forEach((line, index) => {
    for (const match of line.matchAll(pattern)) {
      findings.push({
        file: relative(SRC_ROOT, filePath),
        line: index + 1,
        match: match[0],
      });
    }
  });
  return findings;
}

function formatFindings(findings: IFinding[]): string {
  return findings.map((f) => `  ${f.file}:${f.line}  ${f.match}`).join('\n');
}

describe('SCREEN-006 palette consistency floor', () => {
  const allFiles = collectSourceFiles(SRC_ROOT);
  // `src/theme/` is the one place a colour value or a chalk colour call may appear.
  const sourceFiles = allFiles.filter(
    (file) => !relative(SRC_ROOT, file).split('/').includes(THEME_DIR),
  );

  it('scans a non-empty source inventory', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('has zero color/borderColor/backgroundColor JSX string literals outside the token modules', () => {
    const findings = sourceFiles.flatMap((file) => scanFile(file, COLOR_ATTR_LITERAL));
    expect(
      findings,
      `Inline color attribute literals found — read the theme with usePalette():\n${formatFindings(findings)}`,
    ).toEqual([]);
  });

  it('has zero #rrggbb hex literals outside the token modules', () => {
    const findings = sourceFiles.flatMap((file) => scanFile(file, HEX_LITERAL));
    expect(
      findings,
      `Inline hex color literals found — put the value in src/theme/built-in-themes.ts:\n${formatFindings(findings)}`,
    ).toEqual([]);
  });

  it('SCREEN-2002: only src/theme/ imports the built-in theme data', () => {
    const findings = sourceFiles.flatMap((file) => scanFile(file, BUILT_IN_THEME_IMPORT));
    expect(
      findings,
      `The dark theme's values are data, not a palette — read the live theme instead:\n${formatFindings(findings)}`,
    ).toEqual([]);
  });

  it('SCREEN-2002: only src/theme/ calls a chalk colour', () => {
    const findings = sourceFiles.flatMap((file) => scanFile(file, CHALK_COLOR_CALL));
    expect(
      findings,
      `A chalk colour call decides a colour the theme owns — go through src/theme/:\n${formatFindings(findings)}`,
    ).toEqual([]);
  });

  it('both ratchets actually fire on a violating fixture', () => {
    const violation = [
      "import { DARK_THEME } from './theme/built-in-themes.js';",
      "const label = chalk.cyan('x');",
    ].join('\n');
    expect([...violation.matchAll(BUILT_IN_THEME_IMPORT)]).toHaveLength(1);
    expect([...violation.matchAll(CHALK_COLOR_CALL)]).toHaveLength(1);
    // The two deliberate exemptions stay green.
    expect([...'chalk.inverse(c) + (chalk.level = 0)'.matchAll(CHALK_COLOR_CALL)]).toHaveLength(0);
  });
});
