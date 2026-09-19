/**
 * SCREEN-006 anti-drift consistency floor — the mechanical floor for the color-token SSOT.
 *
 * Every component must consume the resolved theme (`usePalette()` / `useMotionTokens()`, whose data
 * lives in `src/theme/`) instead of spelling Ink color names or hex values inline. This scan reads
 * every source file in the package (excluding `src/theme/` itself and tests) and fails on any
 * `color="…"` / `borderColor="…"` / `backgroundColor="…"` JSX string literal and on any
 * `#rrggbb` hex literal. Precedent: `key-hint-consistency.test.tsx` (the SCREEN-005 floor).
 *
 * SCREEN-2002 added the two ratchets the SCREEN-006 limit predicted. The deferred case — "a future
 * TS helper returning a bare color-name string" — recurred twice (`getContextColor`, the status
 * glyph's colour), so the floor now also refuses any file outside `src/theme/` that names the
 * built-in theme data or calls a chalk COLOUR function. `chalk.inverse` (a modifier, the
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
/**
 * SCREEN-2002: the built-in colour DATA may be imported only from inside `src/theme/`. The SYMBOL is
 * what the ratchet matches, not the module path — matching the path alone let the `src/theme/index.js`
 * barrel re-export the data straight past the floor, which is exactly the route every migrated
 * component already imports through.
 *
 * Recorded limit: a bare word matches anywhere, so PROSE naming a theme constant in a comment
 * outside `src/theme/` fails the floor too. That is the strict direction — it fails loudly and is
 * rewritten in a sentence, rather than passing silently — so it is left as is.
 */
const BUILT_IN_THEME_IMPORT =
  /\b(?:BUILT_IN_THEMES|DARK_THEME|LIGHT_THEME|DARK_DALTONIZED_THEME|LIGHT_DALTONIZED_THEME)\b|from\s+'[^']*built-in-themes\.js'/g;
/** SCREEN-2002: a chalk COLOUR call outside `src/theme/` decides a colour the theme should own. */
const CHALK_COLOR_CALL = /\bchalk\.(?!inverse\b|level\b)[A-Za-z]+[.(]/g;

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

/**
 * Blank out comment CONTENT before scanning, keeping every newline and every character position so
 * a finding's line number still points at the real line.
 *
 * The floor is about CODE. Matching a bare symbol anywhere was recorded as a known limit when these
 * ratchets were written — "it fails loudly rather than passing silently, so leave it" — and then it
 * failed on a comment that correctly EXPLAINS the rule it was named in (`useMotion()` in a docblock
 * about the motion gate). A guard that fires on correct work is how a guard stops being read, so
 * the limit is closed rather than re-recorded.
 */
function blankComments(source: string): string {
  const blank = (match: string): string => match.replace(/[^\n]/gu, ' ');
  return source
    .replace(/\/\*[\s\S]*?\*\//gu, blank)
    .replace(
      /(^|[^:])\/\/[^\n]*/gu,
      (match, prefix: string) => prefix + blank(match.slice(prefix.length)),
    );
}

function scanFile(filePath: string, pattern: RegExp): IFinding[] {
  const findings: IFinding[] = [];
  const lines = blankComments(readFileSync(filePath, 'utf8')).split('\n');
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

  /**
   * SCREEN-2002 TC-06 carve-out, made mechanical. The motion gate has exactly ONE consumer, and the
   * carve-outs depend on that: the sleeping-task countdown still advances under reduced motion
   * (it reports a fact, it is not decoration) and `StreamingIndicator`'s collapse follows
   * screen-reader mode alone. A second consumer would quietly widen what the setting turns off.
   */
  it('SCREEN-2002: the motion gate has one consumer', () => {
    const consumers = sourceFiles.filter((file) =>
      /\buseMotion\(\)/u.test(blankComments(readFileSync(file, 'utf8'))),
    );
    expect(consumers.map((file) => relative(SRC_ROOT, file)).sort()).toEqual(['WaveText.tsx']);
  });

  it('both ratchets actually fire on a violating fixture', () => {
    const violation = [
      "import { DARK_THEME } from './theme/built-in-themes.js';",
      "const label = chalk.cyan('x');",
    ].join('\n');
    // Two matches: the symbol and the path. Either alone is a violation.
    expect([...violation.matchAll(BUILT_IN_THEME_IMPORT)]).toHaveLength(2);
    expect([...violation.matchAll(CHALK_COLOR_CALL)]).toHaveLength(1);
    // The route the path-only ratchet could not see: the barrel re-exporting the same data.
    const throughTheBarrel = "import { DARK_THEME } from './theme/index.js';";
    expect([...throughTheBarrel.matchAll(BUILT_IN_THEME_IMPORT)]).toHaveLength(1);
    // The two deliberate exemptions — and only those two — stay green.
    expect([...'chalk.inverse(c) + (chalk.level = 0)'.matchAll(CHALK_COLOR_CALL)]).toHaveLength(0);
    // `chalk.reset` is NOT among them: it clears whatever style the caller established, which is a
    // rendering decision, not a colour-free modifier.
    expect([...'chalk.reset(row)'.matchAll(CHALK_COLOR_CALL)]).toHaveLength(1);
    // `resolveTheme` is the sanctioned way to ask for a theme one did not receive.
    expect([...'resolveTheme(options.theme)'.matchAll(BUILT_IN_THEME_IMPORT)]).toHaveLength(0);
  });

  it('reads CODE, not the comments that explain it', () => {
    const explained = [
      '// `useMotion()` gates on the colour gate above this.',
      '/* DARK_THEME is the default; see built-in-themes.ts. */',
      'const label = value; // chalk.cyan(x) would be a violation here',
    ].join('\n');
    const code = blankComments(explained);

    expect([...code.matchAll(BUILT_IN_THEME_IMPORT)]).toHaveLength(0);
    expect([...code.matchAll(CHALK_COLOR_CALL)]).toHaveLength(0);
    expect(/\buseMotion\(\)/u.test(code)).toBe(false);
    // Line positions survive, so a finding still points at the line it came from.
    expect(code.split('\n')).toHaveLength(3);
  });
});
