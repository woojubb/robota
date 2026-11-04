/**
 * Tailwind resolves a package stylesheet `@import` with the `style` export condition only, so a CSS
 * subpath without it cannot be imported from a consumer's stylesheet (apps/agent-web did not build).
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

const packageDir = fileURLToPath(new URL('../../..', import.meta.url));
const manifest = JSON.parse(readFileSync(path.join(packageDir, 'package.json'), 'utf8')) as {
  exports: Record<string, unknown>;
};
const stylesheets = Object.entries(manifest.exports).filter(([subpath]) =>
  subpath.endsWith('.css'),
);

describe('stylesheet exports', () => {
  it('exports at least one stylesheet', () => {
    expect(stylesheets.length).toBeGreaterThan(0);
  });

  it.each(stylesheets)('%s resolves under the style condition', (_subpath, conditions) => {
    const target = (conditions as Record<string, unknown>)['style'];
    expect(typeof target).toBe('string');
    expect(existsSync(path.join(packageDir, target as string))).toBe(true);
  });
});
