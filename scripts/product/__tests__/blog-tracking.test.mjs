import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { describe, expect, it } from 'vitest';

const blogRequire = createRequire(new URL('../../../apps/blog/package.json', import.meta.url));
const astroRequire = createRequire(blogRequire.resolve('astro/package.json'));
const { transform } = await import(pathToFileURL(astroRequire.resolve('@astrojs/compiler-rs')).href);
const { experimental_AstroContainer: AstroContainer } = await import(pathToFileURL(blogRequire.resolve('astro/container')).href);

async function renderLayout(layout, measurementId) {
  const root = await mkdtemp(path.join(os.tmpdir(), 'blog-analytics-test-'));
  try {
    const config = { identity: { displayName: 'Fixture' }, services: { analyticsMeasurementId: measurementId } };
    const configFile = path.join(root, 'config.mjs');
    await writeFile(configFile, `export const productPublicConfig = ${JSON.stringify(config)};`);
    const source = await readFile(new URL(`../../../apps/blog/src/layouts/${layout}.astro`, import.meta.url), 'utf8');
    const { code } = await transform(source.replace(/<style[\s\S]*?<\/style>/gu, ''), { filename: `${layout}.astro`, resultScopedSlot: true, resolvePath: (specifier) => specifier, astroGlobalArgs: 'undefined', internalURL: pathToFileURL(blogRequire.resolve('astro/compiler-runtime')).href });
    const module = code.replaceAll('"astro/runtime/server/index.js"', JSON.stringify(pathToFileURL(blogRequire.resolve('astro/runtime/server/index.js')).href))
      .replaceAll('../lib/product-config.generated.mjs', pathToFileURL(configFile).href);
    const file = path.join(root, 'layout.mjs');
    await writeFile(file, module);
    const component = (await import(pathToFileURL(file).href)).default;
    const container = await AstroContainer.create();
    return await container.renderToString(component, {
      props: { title: 'Fixture', frontmatter: { title: 'Fixture', date: '2026-01-01' } },
    });
  } finally { await rm(root, { recursive: true, force: true }); }
}

describe('product-owned blog analytics', () => {
  it.each(['Base', 'BlogPost'])('%s omits tracking when no account was selected', async (layout) => {
    expect(await renderLayout(layout)).not.toContain('googletagmanager.com');
  });
  it.each(['Base', 'BlogPost'])('%s uses only the selected account', async (layout) => {
    const html = await renderLayout(layout, 'G-CEDARTEST');
    expect(html).toContain('id=G-CEDARTEST');
    expect(html).toContain('measurementId = "G-CEDARTEST"');
  });
});
