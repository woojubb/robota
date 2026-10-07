import { mkdtemp, mkdir, readFile, rm, writeFile, access } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, expect, it } from 'vitest';
import { productEnvironment } from '../../../packages/product-config/src/__tests__/product-environment.ts';
import { buildSite } from '../build-site.mjs';

const roots = [];
const siteEnvironment = () => ({
  ...productEnvironment('cedar'),
  PROJECT_HOMEPAGE_URL: 'https://cedar.example',
  PROJECT_REPOSITORY_URL: 'https://github.com/example/cedar',
  PROJECT_DOCS_URL: 'https://docs.cedar.example',
  PROJECT_BLOG_URL: 'https://blog.cedar.example',
  DEPLOY_PROJECT_NAME: 'cedar-www',
  DEPLOY_DOCS_PROJECT_NAME: 'cedar-docs',
  DEPLOY_BLOG_PROJECT_NAME: 'cedar-blog',
});
afterEach(async () => {
  await Promise.all(roots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'site-build-test-'));
  roots.push(root);
  await writeFile(
    path.join(root, 'package.json'),
    JSON.stringify({ name: 'fixture', private: true }),
  );
  await mkdir(path.join(root, 'packages/agent-cli/scripts'), { recursive: true });
  await writeFile(
    path.join(root, 'packages/agent-cli/package.json'),
    JSON.stringify({ name: '@robota-sdk/agent-cli', bin: { agent: './dist/index.js' } }),
  );
  await writeFile(path.join(root, 'packages/agent-cli/tsdown.config.ts'), 'const define = {};');
  await writeFile(
    path.join(root, 'packages/agent-cli/scripts/build-bun.mjs'),
    'Bun.build({ define: {} });',
  );
  for (const app of ['www', 'docs', 'blog']) {
    await mkdir(path.join(root, 'apps', app, 'src'), { recursive: true });
    await writeFile(
      path.join(root, 'apps', app, 'package.json'),
      JSON.stringify({ name: `site-${app}`, private: true }),
    );
    await writeFile(
      path.join(root, 'apps', app, 'src', 'page.txt'),
      '__PRODUCT_DISPLAY_NAME__ __PRODUCT_CLI_NAME__ __PROJECT_DOCS_URL__ __PROJECT_BLOG_URL__',
    );
  }
  return root;
}

it.each(['www', 'docs', 'blog'])(
  'builds %s with selected product strings and preserves neutral source',
  async (app) => {
    const root = await fixture();
    const values = siteEnvironment();
    let generated;
    const result = await buildSite({
      app,
      sourceRoot: root,
      environment: {
        PRODUCT_BUILD_ENV: Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      },
      run: async (command, args, cwd) => {
        generated = cwd;
        if (args[0] === 'install') return;
        const dir = path.join(cwd, 'apps', app);
        const config = await readFile(
          path.join(dir, 'src/lib/product-config.generated.ts'),
          'utf8',
        );
        expect(config).toContain('cedar Agent');
        expect(config).not.toContain('masterKeyDerivationPath');
        const content = await readFile(path.join(dir, 'src/page.txt'), 'utf8');
        await mkdir(path.join(dir, app === 'blog' ? 'dist' : 'out'), { recursive: true });
        await writeFile(path.join(dir, app === 'blog' ? 'dist' : 'out', 'index.html'), content);
      },
    });
    expect(await readFile(path.join(result, 'index.html'), 'utf8')).toBe(
      'cedar Agent cedar https://docs.cedar.example/ https://blog.cedar.example/',
    );
    expect(await readFile(path.join(root, 'apps', app, 'src/page.txt'), 'utf8')).toContain(
      '__PRODUCT_DISPLAY_NAME__',
    );
    await expect(access(generated)).rejects.toThrow();
  },
);

it('refuses a missing selection before any build can publish raw templates', async () => {
  const root = await fixture();
  let invoked = false;
  await expect(
    buildSite({
      app: 'www',
      sourceRoot: root,
      environment: {},
      run: async () => {
        invoked = true;
      },
    }),
  ).rejects.toThrow('PRODUCT_CONFIG_FILE or PRODUCT_BUILD_ENV');
  expect(invoked).toBe(false);
});

it('keeps the previous output and cleans the workspace after a failed build', async () => {
  const root = await fixture();
  const config = path.join(root, 'selected.env');
  await writeFile(
    config,
    Object.entries(siteEnvironment())
      .map(([k, v]) => `${k}=${v}`)
      .join('\n'),
  );
  await mkdir(path.join(root, 'apps/www/out'));
  await writeFile(path.join(root, 'apps/www/out/index.html'), 'previous');
  let generated;
  await expect(
    buildSite({
      app: 'www',
      sourceRoot: root,
      environment: { PRODUCT_CONFIG_FILE: config },
      run: async (_command, args, cwd) => {
        generated = cwd;
        if (args[0] !== 'install') throw new Error('Build failed');
      },
    }),
  ).rejects.toThrow('Build failed');
  expect(await readFile(path.join(root, 'apps/www/out/index.html'), 'utf8')).toBe('previous');
  await expect(access(generated)).rejects.toThrow();
});

it('rejects missing public site URLs and project selection', async () => {
  const root = await fixture();
  const values = siteEnvironment();
  delete values.PROJECT_DOCS_URL;
  await expect(
    buildSite({
      app: 'www',
      sourceRoot: root,
      environment: {
        PRODUCT_BUILD_ENV: Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      },
    }),
  ).rejects.toThrow('PROJECT_DOCS_URL');
});

it('rejects unresolved placeholders in built HTML before replacing the previous output', async () => {
  const root = await fixture();
  await expect(
    buildSite({
      app: 'www',
      sourceRoot: root,
      environment: {
        PRODUCT_BUILD_ENV: Object.entries(siteEnvironment())
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      },
      run: async (_command, args, cwd) => {
        if (args[0] === 'install') return;
        await mkdir(path.join(cwd, 'apps/www/out'), { recursive: true });
        await writeFile(path.join(cwd, 'apps/www/out/index.html'), '__PRODUCT_DISPLAY_NAME__');
      },
    }),
  ).rejects.toThrow('Unresolved product placeholder');
});

it.each([
  ['www', 'cedar-www'],
  ['docs', 'cedar-docs'],
  ['blog', 'cedar-blog'],
])(
  'selects the %s Pages project independently of the Worker deployment name',
  async (app, name) => {
    const { loadProductConfig } = await import('../../../packages/product-config/src/node.ts');
    const { publicProductConfig } = await import('../../../packages/product-config/src/index.ts');
    const { fillProductContent } = await import('../generate-workspace.mjs');
    const config = loadProductConfig({
      environment: { ...siteEnvironment(), DEPLOY_WORKER_NAME: 'other-worker' },
    });
    const file = `apps/${app}/wrangler.toml`;
    const source = await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
    expect(fillProductContent(file, source, publicProductConfig(config), config)).toContain(
      `name = "${name}"`,
    );
  },
);

it.each(
  ['www', 'docs', 'blog'].flatMap((app) =>
    ['PROJECT_HOMEPAGE_URL', 'PROJECT_DOCS_URL', 'PROJECT_BLOG_URL'].map((variable) => [
      app,
      variable,
    ]),
  ),
)('rejects missing %s public URL %s before building cross-site links', async (app, variable) => {
  const root = await fixture();
  const values = siteEnvironment();
  delete values[variable];
  await expect(
    buildSite({
      app,
      sourceRoot: root,
      environment: {
        PRODUCT_BUILD_ENV: Object.entries(values)
          .map(([k, v]) => `${k}=${v}`)
          .join('\n'),
      },
      run: async () => {
        throw new Error('Build must not start');
      },
    }),
  ).rejects.toThrow(variable);
});

it.each(['_redirects', '_headers'])(
  'rejects unresolved placeholders in Pages control file %s',
  async (file) => {
    const root = await fixture();
    await expect(
      buildSite({
        app: 'www',
        sourceRoot: root,
        environment: {
          PRODUCT_BUILD_ENV: Object.entries(siteEnvironment())
            .map(([k, v]) => `${k}=${v}`)
            .join('\n'),
        },
        run: async (_command, args, cwd) => {
          if (args[0] === 'install') return;
          await mkdir(path.join(cwd, 'apps/www/out'), { recursive: true });
          await writeFile(path.join(cwd, 'apps/www/out', file), '__PROJECT_DOCS_URL__');
        },
      }),
    ).rejects.toThrow('Unresolved product placeholder');
  },
);

it('fills adjacent underscore suffixes in actual published documentation', async () => {
  const { loadProductConfig } = await import('../../../packages/product-config/src/node.ts');
  const { publicProductConfig } = await import('../../../packages/product-config/src/index.ts');
  const { fillProductContent } = await import('../generate-workspace.mjs');
  const config = loadProductConfig({ environment: siteEnvironment() });
  const file = 'content/examples/mcp-transport.md';
  const source = await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
  const filled = fillProductContent(file, source, publicProductConfig(config), config);
  expect(filled).not.toMatch(/__PRODUCT_[A-Z_]+__/u);
  expect(filled).toContain(`${config.identity.modelCommandToolPrefix}_submit`);
});

it('publishes only verified generated output to the selected Pages project', async () => {
  const root = await fixture();
  const calls = [];
  await buildSite({
    app: 'www',
    deploy: true,
    sourceRoot: root,
    environment: {
      PRODUCT_BUILD_ENV: Object.entries(siteEnvironment())
        .map(([k, v]) => `${k}=${v}`)
        .join('\n'),
    },
    run: async (_command, args, cwd) => {
      calls.push(args);
      if (args.at(-1) === 'build') {
        await mkdir(path.join(cwd, 'apps/www/out'), { recursive: true });
        await writeFile(path.join(cwd, 'apps/www/out/index.html'), 'cedar Agent');
      }
    },
  });
  expect(calls.at(-1)).toEqual([
    '--dir',
    'apps/www',
    'exec',
    'wrangler',
    'pages',
    'deploy',
    'out',
    '--project-name',
    'cedar-www',
    '--branch',
    'main',
  ]);
});
