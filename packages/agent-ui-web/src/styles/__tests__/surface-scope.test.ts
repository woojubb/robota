/**
 * A host may render the surface inside an app of its own whose tokens share the surface's names
 * (`--background`, `--card`, …). The surface's tokens therefore live under `.robota-ui`, never `:root`,
 * and a page that is only the surface opts its whole document in through `theme.css`.
 */

import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const stylesDir = fileURLToPath(new URL('..', import.meta.url));
const packageJson = JSON.parse(
  readFileSync(path.join(stylesDir, '..', '..', 'package.json'), 'utf8'),
) as { exports: Record<string, unknown> };
const read = (file: string): string => readFileSync(path.join(stylesDir, file), 'utf8');
/** The CSS with comments removed, so a selector named in prose does not count. */
const code = (file: string): string => read(file).replace(/\/\*[\s\S]*?\*\//gu, '');

describe('surface styles', () => {
  it('define the design tokens under .robota-ui and nowhere on :root', () => {
    const surface = code('surface.css');

    // No rule on the bare root: `:root {` or `:root[data-theme…] {`.
    expect(surface).not.toMatch(/(^|\})\s*:root(\[[^\]]*\])?\s*\{/u);
    expect(surface).toMatch(/\.robota-ui\s*\{[^}]*--background:/u);
  });

  it('style no bare element outside the scope', () => {
    const base = code('surface.css').match(/@layer base\s*\{([\s\S]*?)\n\}/u)?.[1] ?? '';
    const selectors = base
      .split('}')
      .map((rule) => rule.split('{')[0]?.trim() ?? '')
      .filter(Boolean)
      .flatMap((list) => list.split(',').map((selector) => selector.trim()));

    expect(selectors.length).toBeGreaterThan(0);
    expect(
      selectors.filter(
        (selector) => !selector.startsWith('.robota-ui') && !selector.startsWith(':root.robota-ui'),
      ),
    ).toEqual([]);
  });

  it('leave the root font size alone, so rem-based spacing keeps its size on a whole page', () => {
    const surface = code('surface.css');
    const tokens = surface.match(/\n\.robota-ui\s*\{([^}]*)\}/u)?.[1] ?? '';

    expect(tokens).toContain('--background:');
    expect(tokens).not.toMatch(/(^|[\s;])font(-size)?:/u);
    expect(surface).toMatch(
      /\.robota-ui:not\(:root\),\s*:root\.robota-ui > body\s*\{[^}]*font-size:/u,
    );
  });

  it('are importable on their own, and the page theme builds on them', () => {
    expect(packageJson.exports['./styles/surface.css']).toBe('./src/styles/surface.css');
    expect(code('theme.css')).toMatch(/@import '\.\/surface\.css';/u);
  });
});
