/**
 * SCREEN-006 anti-drift consistency floor — the mechanical floor for the color-token SSOT.
 *
 * Every component must consume `PALETTE`/`MOTION` tokens (src/tui-palette.ts) instead of
 * spelling Ink color names or hex values inline. This scan reads every source file in the
 * package (excluding the two token modules themselves and tests) and fails on any
 * `color="…"` / `borderColor="…"` / `backgroundColor="…"` JSX string literal and on any
 * `#rrggbb` hex literal. Precedent: `key-hint-consistency.test.tsx` (the SCREEN-005 floor).
 *
 * Known limit (recorded decision, docs/SPEC.md "Color & Motion Contract"): the floor catches
 * JSX attribute literals and hex, but not a future TS helper returning a bare color-name
 * string (the old `getContextColor` shape). Today's instances of that shape were removed by
 * the SCREEN-006 adoption pass; extending the floor to bare strings is deferred until one
 * actually recurs.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const SRC_ROOT = fileURLToPath(new URL('..', import.meta.url));

/** The token modules themselves are the only files allowed to hold raw color values. */
const EXCLUDED_FILES = new Set(['tui-palette.ts', 'tui-ansi-palette.ts']);
const EXCLUDED_DIRS = new Set(['__tests__']);
const SOURCE_EXTENSIONS = ['.ts', '.tsx'];

const COLOR_ATTR_LITERAL = /\b(?:color|borderColor|backgroundColor)="[^"]*"/g;
const HEX_LITERAL = /#[0-9a-fA-F]{6}\b/g;

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
    if (EXCLUDED_FILES.has(entry.name)) continue;
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
  const sourceFiles = collectSourceFiles(SRC_ROOT);

  it('scans a non-empty source inventory', () => {
    expect(sourceFiles.length).toBeGreaterThan(0);
  });

  it('has zero color/borderColor/backgroundColor JSX string literals outside the token modules', () => {
    const findings = sourceFiles.flatMap((file) => scanFile(file, COLOR_ATTR_LITERAL));
    expect(
      findings,
      `Inline color attribute literals found — use PALETTE tokens from src/tui-palette.ts:\n${formatFindings(findings)}`,
    ).toEqual([]);
  });

  it('has zero #rrggbb hex literals outside the token modules', () => {
    const findings = sourceFiles.flatMap((file) => scanFile(file, HEX_LITERAL));
    expect(
      findings,
      `Inline hex color literals found — use PALETTE/MOTION tokens from src/tui-palette.ts:\n${formatFindings(findings)}`,
    ).toEqual([]);
  });
});
