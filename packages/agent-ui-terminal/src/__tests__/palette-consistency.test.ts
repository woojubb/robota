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
 * Recorded limit (widened by SCREEN-2002 work unit 3): the package now EXPORTS `listBuiltInThemes`,
 * so a caller can obtain a built-in's colour values through the accessor without naming a constant
 * or the data module — the floor does not see that, exactly as it does not see a colour-name string
 * returned by a pure helper. The accessor exists for one composition root, which puts the built-ins
 * in a registry; reading a colour off it is the case this floor cannot catch, and it is written down
 * rather than claimed away.
 *
 * Recorded limit: a bare word matches anywhere, so PROSE naming a theme constant in a comment
 * outside `src/theme/` fails the floor too. That is the strict direction — it fails loudly and is
 * rewritten in a sentence, rather than passing silently — so it is left as is.
 */
const BUILT_IN_THEME_IMPORT =
  /\b(?:BUILT_IN_THEMES|DARK_THEME|LIGHT_THEME|DARK_DALTONIZED_THEME|LIGHT_DALTONIZED_THEME)\b|from\s+'[^']*built-in-themes\.js'/g;
/** SCREEN-2002: a chalk COLOUR call outside `src/theme/` decides a colour the theme should own. */
const CHALK_COLOR_CALL = /\bchalk\.(?!inverse\b|level\b)[A-Za-z]+[.(]/g;
/** SCREEN-2002: the three inputs `<ThemeProvider>` must be fed from the resolved view model. */
const THEME_PROVIDER_PROPS = ['theme', 'reducedMotion', 'syntaxHighlighting'] as const;

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

  /**
   * SCREEN-2002: the provider's three inputs must all be WIRED, and every markdown render site must
   * READ the one that is not a colour.
   *
   * `/theme syntax off` shipped in this package's first draft persisting a setting that reached no
   * render site — the command reported success for a no-op, and every context-level test still
   * passed, because the context was fine; it was the one line feeding it that was missing.
   *
   * The first version of this floor was itself half-real: it matched `prop={viewModel.theme.` on the
   * RAW file, so a commented-out provider stayed green and so did moving all three props onto a
   * different element. Both halves below are anchored and comment-blind, and the fixture test at the
   * end proves each one fires.
   */
  const themeProviderElement = (source: string): string =>
    /<ThemeProvider\b[\s\S]*?>/u.exec(blankComments(source))?.[0] ?? '';

  /**
   * The consumer end, as a PROPERTY rather than a proxy for one.
   *
   * `/theme syntax off` shipped persisting a setting no render site passed, so the command reported
   * success and changed nothing. Four guards were written for it, and each measured something
   * standing in for "every call site passes the setting" — the prop appears in the file, the file
   * matched the regex, the identifier occurs N times. Each held for exactly one review round,
   * because a closer proxy is still a proxy.
   *
   * So the obligation is gone instead: `useRenderMarkdown()` binds the theme, the setting and
   * screen-reader mode, and there is no per-call-site argument left to forget. What remains to
   * check is that nothing goes around it — the single-consumer shape the motion gate already uses
   * below.
   */
  const RENDER_MARKDOWN_OWNER = 'hooks/useRenderMarkdown.ts';
  const RAW_RENDERER_SPECIFIER = /(?:from|import\()\s*'[^']*render-markdown\.js'/u;
  /**
   * `from` AND `import(` — a dynamic import reaches the same function, and a check whose whole job
   * is that there is no way around it must see one. A TYPE-only import is exempt: it reaches no
   * call, and a guard that fires on correct work is how a guard stops being read.
   */
  const importsRawRenderer = (source: string): boolean =>
    source
      .split('\n')
      .some(
        (line) =>
          RAW_RENDERER_SPECIFIER.test(line) && !/^\s*(?:import|export)\s+type\b/u.test(line),
      );
  const RAW_RENDERER_IMPORT = /(?<!import type )(?:from|import\()\s*'[^']*render-markdown\.js'/u;

  it('SCREEN-2002: AppView feeds the theme provider all three resolved inputs', () => {
    const element = themeProviderElement(readFileSync(join(SRC_ROOT, 'AppView.tsx'), 'utf8'));

    expect(element, 'AppView must render a <ThemeProvider> — it is the only live one').not.toBe('');
    for (const prop of THEME_PROVIDER_PROPS) {
      expect(
        new RegExp(`${prop}=\\{viewModel\\.theme\\.`, 'u').test(element),
        `<ThemeProvider> must be passed ${prop} — the resolved value reaches components only here`,
      ).toBe(true);
    }
  });

  it('SCREEN-2002: the markdown renderer has one consumer, which binds the appearance', () => {
    const importers = sourceFiles
      .map((file) => ({
        file: relative(SRC_ROOT, file),
        source: blankComments(readFileSync(file, 'utf8')),
      }))
      .filter(({ file }) => file !== 'render-markdown.ts')
      // `from` AND `import(` — a dynamic import is a way around a check whose whole job is that
      // there is no way around it. A TYPE-only import is exempt: it reaches no call, and a guard
      // that fires on correct work is how a guard stops being read (the reason `blankComments`
      // exists a few lines up).
      .filter(({ source }) => importsRawRenderer(source))
      .map(({ file }) => file)
      .sort();

    expect(
      importers,
      `Only ${RENDER_MARKDOWN_OWNER} may import the raw renderer — everything else goes through ` +
        `\`useRenderMarkdown()\`, which binds the theme, the syntax-highlighting setting and ` +
        `screen-reader mode. A direct import is a call site that can forget one of them.`,
    ).toEqual([RENDER_MARKDOWN_OWNER]);
  });

  it('the wiring floors fire on a violating fixture', () => {
    // (a) A commented-out provider is not a provider.
    expect(themeProviderElement('// <ThemeProvider theme={viewModel.theme.resolved}>')).toBe('');
    expect(themeProviderElement('/* <ThemeProvider theme={viewModel.theme.resolved}> */')).toBe('');
    // (b) The props must be on the PROVIDER, not on whatever element happens to follow it.
    const moved = [
      '<ThemeProvider>',
      '  <AppPresentation theme={viewModel.theme.resolved} />',
      '</ThemeProvider>',
    ].join('\n');
    expect(/theme=\{viewModel\.theme\./u.test(themeProviderElement(moved))).toBe(false);
    // (c) The real shape passes.
    const wired = [
      '<ThemeProvider',
      '  theme={viewModel.theme.resolved}',
      '  reducedMotion={viewModel.theme.reducedMotion}',
      '  syntaxHighlighting={viewModel.theme.syntaxHighlighting}',
      '>',
    ].join('\n');
    const element = themeProviderElement(wired);
    for (const prop of THEME_PROVIDER_PROPS) {
      expect(new RegExp(`${prop}=\\{viewModel\\.theme\\.`, 'u').test(element)).toBe(true);
    }
    // (d) The consumer half is an IMPORT check, so it cannot be satisfied by an identifier that
    // merely occurs — a dependency array, a destructure, a sibling component's props.
    const shapes: [string, boolean][] = [
      ["import { renderMarkdown } from './render-markdown.js';", true],
      ["import * as md from './render-markdown.js';", true],
      ["import { renderMarkdown } from '../../render-markdown.js';", true],
      ["export { renderMarkdown } from './render-markdown.js';", true],
      // A dynamic import reaches the same function; the check must see it.
      ["const { renderMarkdown } = await import('./render-markdown.js');", true],
      // A TYPE-only import reaches no call, so flagging it would be a false red.
      ["import type { IRenderMarkdownOptions } from './render-markdown.js';", false],
      ["import { useRenderMarkdown } from './hooks/useRenderMarkdown.js';", false],
    ];
    for (const [shape, flagged] of shapes) {
      expect(importsRawRenderer(shape), shape).toBe(flagged);
    }
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
