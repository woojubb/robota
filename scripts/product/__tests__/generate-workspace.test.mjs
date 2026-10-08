import { mkdtemp, mkdir, readFile, readdir, rm, symlink, writeFile } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
import ts from 'typescript';
import { parseDocument } from 'yaml';

import { afterEach, describe, expect, it, vi } from 'vitest';
import { nativeBuildSelection } from '../../../packages/agent-cli/scripts/build-bun.mjs';
import {
  embeddedProductIdentity,
  generateDefaultEnvironment,
  publicProductConfig,
  resolveProductConfig,
} from '../../../packages/product-config/src/index.ts';

import {
  generateWorkspaceFromConfig,
  omitUnavailableContentLinks,
  rewriteContent,
  fillProductContent,
  workflowProductEnvironment,
  workflowProductOutputs,
} from '../generate-workspace.mjs';

const tempRoots = [];
const sourceSwap = vi.hoisted(() => ({ path: undefined, run: undefined }));

vi.mock('node:fs/promises', async (importOriginal) => {
  const actual = await importOriginal();
  const thenSwap = (operation) => async (...args) => {
    const result = await operation(...args);
    if (sourceSwap.path !== undefined && args[0] === sourceSwap.path) {
      const run = sourceSwap.run;
      sourceSwap.path = undefined;
      sourceSwap.run = undefined;
      await run?.();
    }
    return result;
  };
  return { ...actual, lstat: thenSwap(actual.lstat), open: thenSwap(actual.open) };
});

async function tinyCommittedSource(root) {
  const source = path.join(root, 'source');
  await mkdir(path.join(source, 'packages/agent-cli/scripts'), { recursive: true });
  await mkdir(path.join(source, 'packages/core'), { recursive: true });
  await mkdir(path.join(source, 'apps/agent-app'), { recursive: true });
  await writeFile(path.join(source, 'packages/core/package.json'), '{"name":"@robota-sdk/core"}\n');
  await writeFile(path.join(source, 'packages/agent-cli/package.json'), '{"name":"@robota-sdk/agent-cli","version":"1.2.3","bin":{"robota":"./bin/agent.cjs"}}\n');
  await writeFile(path.join(source, 'apps/agent-app/package.json'), '{"name":"@robota-sdk/agent-app","version":"1.0.0","description":"Robota","author":"Robota"}\n');
  await writeFile(path.join(source, 'packages/agent-cli/tsdown.config.ts'), 'const define = {}; export default { define };\n');
  await writeFile(path.join(source, 'packages/agent-cli/scripts/build-bun.mjs'), 'Bun.build({ define: {} });\n');
  await writeFile(path.join(source, '.npmrc'), 'workspace-concurrency=2\n');
  execFileSync('git', ['init', '-q', source]);
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'fixture']);
  return source;
}

it('generates only a clean committed tree with non-secret npmrc, version, bin and provenance', async () => {
  const root = await temporaryRoot();
  const source = await tinyCommittedSource(root);
  const base = resolveTestConfig({ scope: '@cedar', displayName: 'Cedar' });
  const config = {
    ...base,
    build: { ...base.build, cliPackageBin: 'none' },
    release: { ...base.release, productVersion: '9.8.7', buildMetadata: 'fixture-1' },
  };
  const out = path.join(root, 'out');
  await generateWorkspaceFromConfig({ sourceRoot: source, outDir: out, config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config), sourceMode: 'clean-tree' });
  const provenance = JSON.parse(await readFile(path.join(out, '.product/source.json'), 'utf8'));
  expect(provenance).toMatchObject({ mode: 'clean-tree', commit: expect.stringMatching(/^[a-f0-9]{40}$/u), tree: expect.stringMatching(/^[a-f0-9]{40}$/u) });
  expect(await readFile(path.join(out, '.npmrc'), 'utf8')).toBe('workspace-concurrency=2\n');
  expect(JSON.parse(await readFile(path.join(out, 'packages/agent-cli/package.json'), 'utf8'))).toMatchObject({ version: '9.8.7' });
  expect(JSON.parse(await readFile(path.join(out, 'packages/agent-cli/package.json'), 'utf8'))).not.toHaveProperty('bin');
  expect(JSON.parse(await readFile(path.join(out, 'apps/agent-app/package.json'), 'utf8'))).toMatchObject({ version: '9.8.7', author: 'Cedar', description: 'Cedar desktop app' });
  expect(JSON.parse(await readFile(path.join(out, '.product/artifact-metadata.json'), 'utf8'))).toEqual({ version: '9.8.7', sourceVersion: '1.2.3', buildMetadata: 'fixture-1', artifactName: 'cedar' });
  const manifest = JSON.parse(await readFile(path.join(out, '.product/generated-files.json'), 'utf8'));
  expect(manifest).toContainEqual({ path: '.npmrc', sha256: expect.stringMatching(/^[a-f0-9]{64}$/u) });
  sourceSwap.path = path.join(source, '.npmrc');
  sourceSwap.run = () => writeFile(path.join(source, 'changed-during-copy.txt'), 'changed');
  await expect(generateWorkspaceFromConfig({ sourceRoot: source, outDir: path.join(root, 'raced'), config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config), sourceMode: 'clean-tree' })).rejects.toThrow('clean checkout');
  expect(sourceSwap.path).toBeUndefined();
  await rm(path.join(source, 'changed-during-copy.txt'));
  await writeFile(path.join(source, 'untracked.txt'), 'outside commit');
  await expect(generateWorkspaceFromConfig({ sourceRoot: source, outDir: path.join(root, 'dirty'), config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config), sourceMode: 'clean-tree' })).rejects.toThrow('clean checkout');
});

it('refuses credential-like npmrc settings and unrelated outer repositories', async () => {
  const root = await temporaryRoot();
  const source = await tinyCommittedSource(root);
  const config = resolveTestConfig({ scope: '@amber', displayName: 'Amber' });
  await writeFile(path.join(source, '.npmrc'), '//registry.example.test/:_authToken=secret\n');
  await expect(generateWorkspaceFromConfig({ sourceRoot: source, outDir: path.join(root, 'unsafe'), config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config) })).rejects.toThrow('non-secret allowlist');
  const nested = path.join(source, 'nested');
  await mkdir(nested);
  await expect(generateWorkspaceFromConfig({ sourceRoot: nested, outDir: path.join(root, 'nested-out'), config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config), sourceMode: 'clean-tree' })).rejects.toThrow('repository root');
});

it('ignores package manifests and templates outside the committed inventory', async () => {
  const root = await temporaryRoot();
  const source = await tinyCommittedSource(root);
  await mkdir(path.join(source, 'packages/ghost'), { recursive: true });
  await mkdir(path.join(source, 'scripts/product/templates/packages/core'), { recursive: true });
  await writeFile(path.join(source, '.git/info/exclude'), 'packages/ghost/\nscripts/product/templates/\n');
  await writeFile(path.join(source, 'packages/ghost/package.json'), '{"name":"@robota-sdk/ghost"}\n');
  await writeFile(path.join(source, 'scripts/product/templates/packages/core/package.json'), '{"name":"@robota-sdk/wrong-template"}\n');
  const config = resolveTestConfig({ scope: '@cedar', displayName: 'Cedar' });
  const out = path.join(root, 'out');
  await generateWorkspaceFromConfig({ sourceRoot: source, outDir: out, config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config), sourceMode: 'clean-tree' });
  expect(JSON.parse(await readFile(path.join(out, '.product/package-map.json'), 'utf8'))).not.toHaveProperty('@robota-sdk/ghost');
  expect(JSON.parse(await readFile(path.join(out, 'packages/core/package.json'), 'utf8')).name).toBe('@cedar/core');
});

it('preserves whitespace at the beginning of a committed filename', async () => {
  const root = await temporaryRoot();
  const source = await tinyCommittedSource(root);
  await writeFile(path.join(source, ' leading-note.txt'), 'leading space survives\n');
  execFileSync('git', ['-C', source, 'add', '.']);
  execFileSync('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'whitespace path']);
  const config = resolveTestConfig({ scope: '@cedar', displayName: 'Cedar' });
  const out = path.join(root, 'out');
  await generateWorkspaceFromConfig({ sourceRoot: source, outDir: out, config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config), sourceMode: 'clean-tree' });
  expect(await readFile(path.join(out, ' leading-note.txt'), 'utf8')).toBe('leading space survives\n');
});

it('does not follow a committed package manifest symlink to an ignored source', async () => {
  const root = await temporaryRoot();
  const source = await tinyCommittedSource(root);
  await mkdir(path.join(source, 'packages/linked'), { recursive: true });
  await writeFile(path.join(source, '.git/info/exclude'), 'ignored-manifest.json\n');
  await writeFile(path.join(source, 'ignored-manifest.json'), '{"name":"@robota-sdk/ignored"}\n');
  await symlink('../../ignored-manifest.json', path.join(source, 'packages/linked/package.json'));
  execFileSync('git', ['-C', source, 'add', 'packages/linked/package.json']);
  execFileSync('git', ['-C', source, '-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.test', 'commit', '-qm', 'manifest link']);
  const config = resolveTestConfig({ scope: '@cedar', displayName: 'Cedar' });
  await expect(generateWorkspaceFromConfig({ sourceRoot: source, outDir: path.join(root, 'out'), config, publicConfig: publicProductConfig(config), embeddedIdentity: embeddedProductIdentity(config), sourceMode: 'clean-tree' })).rejects.toThrow();
});

describe('product strings in generated artifact syntax', () => {
  const name = 'O\'Reilly "Agent" \\ `${globalThis.INJECTED = true}` <tag>';
  const base = resolveTestConfig({ scope: '@alpha', displayName: 'Alpha' });
  const config = { ...base, identity: { ...base.identity, displayName: name } };
  const publicConfig = publicProductConfig(config);
  it('preserves the display name in the real JSON manifest and desktop YAML', async () => {
    for (const file of ['apps/docs/public/manifest.json', 'apps/agent-app/electron-builder.yml']) {
      const source = await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
      const filled = fillProductContent(file, source, publicConfig, config);
      if (file.endsWith('.json')) expect(JSON.parse(filled).short_name).toBe(name);
      else {
        const doc = parseDocument(filled);
        expect(doc.errors).toEqual([]);
        expect(doc.toJSON().productName).toBe(name);
      }
    }
  });
  it('preserves data instead of injecting code into the real blog strings and templates', async () => {
    const source = await readFile(new URL('../../../apps/blog/src/i18n/ui.ts', import.meta.url), 'utf8');
    const filled = fillProductContent('apps/blog/src/i18n/ui.ts', source, publicConfig, config);
    const ast = ts.createSourceFile('ui.ts', filled, ts.ScriptTarget.Latest, true);
    expect(ast.parseDiagnostics).toEqual([]);
    const module = { exports: {} };
    const compiled = ts.transpileModule(filled, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText;
    new Function('module', 'exports', compiled)(module, module.exports);
    expect(module.exports.ui.en['site.title']).toBe(`${name} Blog`);
    const template = fillProductContent('template.ts', 'export default `__PRODUCT_DISPLAY_NAME__ ${1}`;', publicConfig, config);
    const result = { exports: {} };
    new Function('module', 'exports', ts.transpileModule(template, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText)(result, result.exports);
    expect(result.exports.default).toBe(`${name} 1`);
    expect(globalThis.INJECTED).toBeUndefined();
  });
  it('preserves quoted frontmatter types in the actual Astro parser', async () => {
    const file = 'apps/blog/src/content/blog/en/build-your-own-claude-code.md';
    const source = await readFile(new URL(`../../../${file}`, import.meta.url), 'utf8');
    const blogRequire = createRequire(new URL('../../../apps/blog/package.json', import.meta.url));
    const { parseFrontmatter } = await import(pathToFileURL(blogRequire.resolve('@astrojs/markdown-remark')).href);
    const original = parseFrontmatter(source).frontmatter;
    const filled = parseFrontmatter(fillProductContent(file, source, publicConfig, config)).frontmatter;
    expect(filled).toEqual(original);
    expect(typeof filled.date).toBe('string');
  });
  it('reports the effective artifact prefix without changing the canonical optional configuration', () => {
    expect(workflowProductOutputs(base)).toContain('artifact_prefix=alpha\n');
    expect(workflowProductOutputs(resolveTestConfig({ scope: '@beta', displayName: 'Beta' }))).toContain('artifact_prefix=beta-bundle\n');
    expect(workflowProductEnvironment(base, '/tmp/file', '/tmp/workspace')).toContain('PRODUCT_ARTIFACT_PREFIX=\n');
  });
  it('transports the resolved contract into CI without exporting ambient credentials or allowing extra lines', () => {
    const text = workflowProductEnvironment(config, '/tmp/selected.env', '/tmp/selected-workspace');
    expect(text).toContain(`PRODUCT_DISPLAY_NAME=${name}\n`);
    expect(text).toContain('PRODUCT_PACKAGE_SCOPE=@alpha\n');
    expect(text).toContain('PRODUCT_CONFIG_FILE=/tmp/selected.env\n');
    expect(text).toContain('PRODUCT_WORKSPACE=/tmp/selected-workspace\n');
    expect(text).toContain('PROJECT_NPM_REGISTRY_URL=\n');
    expect(text).not.toContain('API_KEY');
    expect(() => workflowProductEnvironment(config, '/tmp/selected.env', '/tmp/path\nINJECTED=x')).toThrow('PRODUCT_WORKSPACE');
  });
});
async function temporaryRoot() {
  const root = await mkdtemp(path.join(os.tmpdir(), 'product-workspace-test-'));
  tempRoots.push(root);
  return root;
}

function resolveTestConfig({ scope, displayName }) {
  return resolveProductConfig({
    environment: {
      PRODUCT_ID: displayName.toLowerCase(),
      PRODUCT_DISPLAY_NAME: displayName,
      PRODUCT_CLI_NAME: displayName.toLowerCase(),
      PRODUCT_ENV_PREFIX: `${displayName.toUpperCase()}_`,
      PRODUCT_PACKAGE_SCOPE: scope,
      ...(displayName === 'Beta' ? { PRODUCT_ARTIFACT_PREFIX: 'beta-bundle' } : {}),
      PRODUCT_APP_ID: `com.example.${displayName.toLowerCase()}`,
      PRODUCT_PROTOCOL_SCHEME: displayName.toLowerCase(),
      PRODUCT_TELEMETRY_SERVICE_NAME: displayName.toLowerCase(),
      PRODUCT_DAEMON_NAMESPACE: displayName.toLowerCase(),
      PRODUCT_DESKTOP_EXECUTABLE: displayName.toLowerCase(),
      PRODUCT_MCP_CLIENT_NAME: displayName.toLowerCase(),
      PRODUCT_MODEL_TOOL_PREFIX: displayName.toLowerCase(),
      PRODUCT_PROMPT_TAG: displayName.toLowerCase(),
      PRODUCT_EDITOR_TEMP_PREFIX: displayName.toLowerCase(),
      PROJECT_REPOSITORY_URL: `https://github.com/${displayName.toLowerCase()}/runtime`,
      PROJECT_HOMEPAGE_URL: `https://${displayName.toLowerCase()}.example.test`,
      PROJECT_DOCS_URL: `https://docs.${displayName.toLowerCase()}.example.test`,
      PROJECT_BLOG_URL: `https://blog.${displayName.toLowerCase()}.example.test`,
      PRODUCT_DEFAULT_USER_STATE_DIR: `.${displayName.toLowerCase()}`,
      PRODUCT_DEFAULT_CACHE_DIR: `.${displayName.toLowerCase()}/cache`,
      PRODUCT_DEFAULT_LOG_DIR: `.${displayName.toLowerCase()}/logs`,
      PRODUCT_DEFAULT_PROJECT_STATE_DIR: `.${displayName.toLowerCase()}`,
      PRODUCT_USER_STATE_DIR: `/tmp/${displayName.toLowerCase()}`,
      PRODUCT_PROJECT_STATE_DIR: `.${displayName.toLowerCase()}`,
      PRODUCT_CACHE_DIR: `/tmp/${displayName.toLowerCase()}-cache`,
      PRODUCT_LOG_DIR: `/tmp/${displayName.toLowerCase()}-logs`,
      PRODUCT_BROWSER_NAMESPACE: displayName.toLowerCase(),
      PRODUCT_BROWSER_CREDENTIAL_DATABASE: `${displayName.toLowerCase()}-credentials`,
      PRODUCT_CREDENTIAL_SERVICE: displayName.toLowerCase(),
      PRODUCT_CRYPTO_NAMESPACE: displayName.toLowerCase(),
      SECURITY_MASTER_KEY_DERIVATION_PATH: '[1,2,3]',
      DEPLOY_PROJECT_NAME: `${displayName.toLowerCase()}-site`,
      DEPLOY_DOCS_PROJECT_NAME: `${displayName.toLowerCase()}-docs`,
      DEPLOY_BLOG_PROJECT_NAME: `${displayName.toLowerCase()}-blog`,
      DEPLOY_WORKER_NAME: `${displayName.toLowerCase()}-worker`,
      PROJECT_RELEASE_TAG_PREFIX: `${displayName.toLowerCase()}-release-`,
      PROJECT_PACKAGE_ACCESS: displayName === 'Beta' ? 'restricted' : 'public',
    },
  });
}

afterEach(async () => {
  sourceSwap.path = undefined;
  sourceSwap.run = undefined;
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

describe('generated workspace package remapping', () => {
  it('omits optional authored author links when the selected product has no repository URL', () => {
    const source = "---\nauthor: 'Example Author'\n---\nBody\n";
    expect(omitUnavailableContentLinks('apps/blog/src/content/blog/en/post.md', source, { identity: {} })).toBe(
      source,
    );
    expect(omitUnavailableContentLinks(
      'apps/blog/src/content/blog/en/post.md',
      source,
      { identity: { repositoryUrl: 'https://github.com/example/runtime' } },
    )).toBe("---\nauthor: 'Example Author'\nauthorUrl: \"https://github.com/example/runtime\"\n---\nBody\n");
  });

  it('remaps static, dynamic, require, type, test-mock and CSS specifiers without changing unrelated imports', () => {
    const map = new Map([
      ['@robota-sdk/core', '@alpha/core'],
      ['@robota-sdk/ui', '@alpha/ui'],
      ['@robota-sdk/cli', '@alpha/cli'],
    ]);
    const ts = [
      "import { run } from '@robota-sdk/core';",
      "export type { TRun } from '@robota-sdk/core';",
      "type M = typeof import('@robota-sdk/core');",
      "const p = import('@robota-sdk/core');",
      "const p3 = import(`@robota-sdk/${name}`);",
      "const message = `Use ${name} with @robota-sdk/core before continuing`;",
      "const p2 = require('@robota-sdk/core');",
      "vi.mock('@robota-sdk/core', () => ({}));",
      "vi.mocked(import('@robota-sdk/core'));",
      '// Documented in @robota-sdk/core and @robota-sdk/core/testing.',
      "import { x } from '@vendor/core';",
    ].join('\n');
    const css = "@import '@robota-sdk/ui/styles/surface.css';\n@import 'reset.css';";
    const jsx = `export const Install = () => <p>npx @robota-sdk/cli</p>;`;

    expect(rewriteContent('fixture.ts', ts, map)).toContain("import { run } from '@alpha/core';");
    expect(rewriteContent('fixture.ts', ts, map)).toContain("vi.mock('@alpha/core'");
    expect(rewriteContent('fixture.ts', ts, map)).toContain("import('@alpha/core')");
    expect(rewriteContent('fixture.ts', ts, map, '@alpha')).toContain('import(`@alpha/${name}`)');
    expect(rewriteContent('fixture.ts', ts, map, '@alpha')).toContain('Use ${name} with @alpha/core before continuing');
    expect(rewriteContent('fixture.ts', ts, map)).toContain("from '@vendor/core'");
    expect(rewriteContent('fixture.ts', ts, map, '@alpha')).toContain('// Documented in @alpha/core and @alpha/core/testing.');
    expect(rewriteContent('fixture.css', css, map)).toContain("@import '@alpha/ui/styles/surface.css'");
    expect(rewriteContent('fixture.css', css, map)).toContain("@import 'reset.css'");
    expect(rewriteContent('fixture.tsx', jsx, map, '@alpha')).toContain('npx @alpha/cli');
  });

  it('rewrites structured manifests, pnpm lock importer keys and external-scope regexes', () => {
    const map = new Map([
      ['@robota-sdk/core', '@alpha/core'],
      ['@robota-sdk/cli', '@alpha/cli'],
    ]);
    const manifest = JSON.stringify({
      name: '@robota-sdk/cli',
      dependencies: { '@robota-sdk/core': 'workspace:*' },
      bin: { runtime: './bin/runtime.cjs' },
    });
    const lock = [
      'lockfileVersion: "9.0"',
      'importers:',
      '  packages/cli:',
      '    dependencies:',
      '      "@robota-sdk/core":',
      '        specifier: workspace:*',
      '        version: link:../core',
      '  packages/consumer:',
      '    dependencies:',
      '      "@robota-sdk/core@workspace:packages/core":',
      '        specifier: workspace:*',
      '        version: link:../core',
    ].join('\n');
    const config = "external: [/^@robota-sdk\\/.*/]";
    const tsconfig = '{\n  // comments and trailing commas are valid in TS config files\n  "paths": { "@robota-sdk/core": ["./packages/core"], },\n}\n';

    expect(JSON.parse(rewriteContent('package.json', manifest, map))).toMatchObject({
      name: '@alpha/cli',
      dependencies: { '@alpha/core': 'workspace:*' },
    });
    expect(rewriteContent('pnpm-lock.yaml', lock, map)).toContain('"@alpha/core":');
    expect(rewriteContent('pnpm-lock.yaml', lock, map, '@alpha')).toContain('"@alpha/core@workspace:packages/core":');
    expect(rewriteContent('tsdown.config.ts', config, map, '@alpha')).toContain('/^@alpha\\/.*/');
    expect(JSON.parse(rewriteContent('tsconfig.json', tsconfig, map))).toMatchObject({
      paths: { '@alpha/core': ['./packages/core'] },
    });
  });
});

describe('generated product workspace isolation', () => {
  it('copies the file it checked when its source path becomes a private-file symlink', async () => {
    const root = await temporaryRoot();
    const source = path.join(root, 'source');
    const file = path.join(source, 'packages/core/index.ts');
    const privateFile = path.join(root, '.env.private');
    await mkdir(path.dirname(file), { recursive: true });
    await mkdir(path.join(source, 'packages/agent-cli/scripts'), { recursive: true });
    await writeFile(path.join(source, 'package.json'), '{}');
    await writeFile(path.join(source, 'packages/core/package.json'), '{"name":"@robota-sdk/core"}');
    await writeFile(path.join(source, 'packages/agent-cli/package.json'), '{"name":"@robota-sdk/agent-cli","bin":{"agent":"./bin/agent.cjs"}}');
    await writeFile(path.join(source, 'packages/agent-cli/tsdown.config.ts'), 'const define = {}; export default { define };');
    await writeFile(path.join(source, 'packages/agent-cli/scripts/build-bun.mjs'), 'Bun.build({ define: {} });');
    await writeFile(file, 'export const publicContent = true;\n');
    await writeFile(privateFile, 'PRIVATE_FILE_SENTINEL\n');
    sourceSwap.path = file;
    sourceSwap.run = async () => {
      await rm(file);
      await symlink(privateFile, file);
    };
    const config = resolveTestConfig({ scope: '@alpha', displayName: 'Alpha' });
    const stage = await generateWorkspaceFromConfig({
      sourceRoot: source,
      outDir: path.join(root, 'stage'),
      config,
      publicConfig: publicProductConfig(config),
      embeddedIdentity: embeddedProductIdentity(config),
    });
    expect(sourceSwap.path).toBeUndefined();
    expect(await readFile(path.join(stage, 'packages/core/index.ts'), 'utf8')).toBe(
      'export const publicContent = true;\n',
    );
  });

  it('selects a host entry and artifact name without requiring a generated product', async () => {
    const root = await temporaryRoot();
    const entry = path.join(root, 'host-entry.js');
    await writeFile(entry, 'export default 1;');
    expect(nativeBuildSelection(root, 'full', { entry, artifactName: 'cedar-native' })).toEqual({
      entry, artifactName: 'cedar-native',
    });
    expect(() => nativeBuildSelection(root, 'full', { entry, artifactName: '../escape' })).toThrow('Artifact name');
  });

  it('builds independent A/B/A stages, omits private env files, and leaves source bytes unchanged', async () => {
    const root = await temporaryRoot();
    const source = path.join(root, 'source');
    const out = path.join(root, 'generated');
    await mkdir(path.join(source, 'packages', 'core'), { recursive: true });
    await mkdir(path.join(source, 'packages', 'core', 'credentials'), { recursive: true });
    await mkdir(path.join(source, 'packages', 'util'), { recursive: true });
    await mkdir(path.join(source, 'packages', 'agent-cli'), { recursive: true });
    await mkdir(path.join(source, 'packages', 'agent-cli', 'scripts'), { recursive: true });
    await mkdir(path.join(source, 'apps', 'docs', 'src', 'lib'), { recursive: true });
    await mkdir(path.join(source, 'apps', 'agent-app'), { recursive: true });
    await mkdir(path.join(source, '.github', 'workflows'), { recursive: true });
    await mkdir(path.join(source, 'scripts', 'product'), { recursive: true });
    await mkdir(path.join(source, '.changeset'), { recursive: true });
    await writeFile(path.join(source, '.changeset', 'config.json'), JSON.stringify({ access: 'public' }));
    await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'canonical-root', private: true }));
    await writeFile(
      path.join(source, 'apps', 'docs', 'package.json'),
      JSON.stringify({ name: 'robota-docs', scripts: { deploy: 'wrangler pages deploy --project-name __DEPLOY_DOCS_PROJECT_NAME__' } }),
    );
    await writeFile(path.join(source, 'apps', 'docs', 'src', 'lib', 'site.ts'), "export const docs = '__PROJECT_DOCS_URL__';\n");
    await writeFile(
      path.join(source, 'apps', 'agent-app', 'electron-builder.yml'),
      "appId: '__PRODUCT_APP_ID__'\nproductName: '__PRODUCT_DISPLAY_NAME__'\nartifactName: '__PRODUCT_DESKTOP_ARTIFACT_PREFIX__-${version}-${arch}.${ext}'\nexecutableName: '__PRODUCT_DESKTOP_APP_EXECUTABLE__'\n",
    );
    await writeFile(path.join(source, 'pnpm-workspace.yaml'), 'packages:\n  - packages/*\n');
    await writeFile(
      path.join(source, 'packages', 'core', 'package.json'),
      JSON.stringify({ name: '@robota-sdk/core', private: false, publishConfig: { access: 'public' }, dependencies: { '@robota-sdk/util': 'workspace:*' } }),
    );
    await writeFile(
      path.join(source, 'packages', 'core', 'index.ts'),
      "import { value } from '@robota-sdk/util'; export { value };\n",
    );
    await writeFile(
      path.join(source, 'packages', 'core', 'credentials', 'credential-store.ts'),
      'export const credentialStoreModule = true;\n',
    );
    await writeFile(
      path.join(source, 'packages', 'core', 'credentials', 'private.pem'),
      'PRIVATE_KEY_SENTINEL\n',
    );
    await writeFile(
      path.join(source, 'packages', 'util', 'package.json'),
      JSON.stringify({ name: '@robota-sdk/util' }),
    );
    await writeFile(
      path.join(source, 'packages', 'agent-cli', 'package.json'),
      JSON.stringify({ name: '@robota-sdk/agent-cli', bin: { agent: './bin/agent.cjs' } }),
    );
    await writeFile(
      path.join(source, 'packages', 'agent-cli', 'tsdown.config.ts'),
      "const define = { __VERSION__: JSON.stringify('test') }; export default { define };\n",
    );
    await writeFile(
      path.join(source, 'packages', 'agent-cli', 'scripts', 'build-bun.mjs'),
      await readFile(new URL('../../../packages/agent-cli/scripts/build-bun.mjs', import.meta.url), 'utf8'),
    );
    await writeFile(
      path.join(source, '.github', 'workflows', 'release.yml'),
      'env:\n  ARTIFACT: __PRODUCT_ARTIFACT_PREFIX__\n  TAG_PREFIX: __PROJECT_RELEASE_TAG_PREFIX__\n  CREDENTIAL_SERVICE: __PRODUCT_CREDENTIAL_SERVICE__\n',
    );
    await writeFile(path.join(source, '.env.private'), 'PRIVATE_SENTINEL=do-not-copy\n');
    await writeFile(path.join(source, 'packages', 'core', '.env.local'), 'ANOTHER_PRIVATE_SENTINEL=do-not-copy\n');
    const before = await readFile(path.join(source, 'packages', 'core', 'index.ts'), 'utf8');
    const configA = resolveTestConfig({ scope: '@alpha', displayName: 'Alpha' });
    const configB = resolveTestConfig({ scope: '@beta', displayName: 'Beta' });
    const defaultEnvironment = generateDefaultEnvironment();

    const [stageA1, stageB, stageA2] = await Promise.all([
      generateWorkspaceFromConfig({
        sourceRoot: source,
        outDir: path.join(out, 'a1'),
        config: configA,
        publicConfig: publicProductConfig(configA),
        embeddedIdentity: embeddedProductIdentity(configA),
        defaultEnvironment,
      }),
      generateWorkspaceFromConfig({
        sourceRoot: source,
        outDir: path.join(out, 'b'),
        config: configB,
        publicConfig: publicProductConfig(configB),
        embeddedIdentity: embeddedProductIdentity(configB),
        defaultEnvironment,
      }),
      generateWorkspaceFromConfig({
        sourceRoot: source,
        outDir: path.join(out, 'a2'),
        config: configA,
        publicConfig: publicProductConfig(configA),
        embeddedIdentity: embeddedProductIdentity(configA),
        defaultEnvironment,
      }),
    ]);

    expect(JSON.parse(await readFile(path.join(stageA1, 'packages/core/package.json'), 'utf8')).name).toBe('@alpha/core');
    expect(JSON.parse(await readFile(path.join(stageB, 'packages/core/package.json'), 'utf8')).name).toBe('@beta/core');
    expect(JSON.parse(await readFile(path.join(stageB, 'packages/core/package.json'), 'utf8')).publishConfig.access).toBe('restricted');
    expect(JSON.parse(await readFile(path.join(stageB, '.changeset/config.json'), 'utf8')).access).toBe('restricted');
    expect(JSON.parse(await readFile(path.join(stageA1, 'packages/agent-cli/package.json'), 'utf8')).bin).toEqual({
      alpha: './bin/agent.cjs',
    });
    expect(JSON.parse(await readFile(path.join(stageB, 'packages/agent-cli/package.json'), 'utf8')).bin).toEqual({
      beta: './bin/agent.cjs',
    });
    expect(JSON.parse(await readFile(path.join(stageA1, '.product/identity.json'), 'utf8')).identity.displayName).toBe('Alpha');
    const runtimeDefaults = await readFile(path.join(stageA1, '.product/runtime-defaults.json'), 'utf8');
    expect(JSON.parse(runtimeDefaults).PRODUCT_USER_STATE_DIR).toBe('.alpha');
    expect(runtimeDefaults).not.toContain('/tmp/alpha');
    for (const file of ['packages/agent-cli/tsdown.config.ts', 'packages/agent-cli/scripts/build-bun.mjs']) {
      expect(await readFile(path.join(stageA1, file), 'utf8')).toContain('__PRODUCT_CONFIG_DEFAULTS__');
    }
    const publicProjection = JSON.parse(await readFile(path.join(stageA1, '.product/public-config.json'), 'utf8'));
    expect(publicProjection).not.toHaveProperty('secrets');
    expect(publicProjection).not.toHaveProperty('credentials');
    const stagedPublicConfig = await readFile(path.join(stageA1, '.product/public-config.json'), 'utf8');
    expect(stagedPublicConfig).not.toContain('/tmp/alpha');
    expect(stagedPublicConfig).not.toContain('serviceNamespace');
    expect(JSON.parse(await readFile(path.join(stageA1, 'package.json'), 'utf8'))).toMatchObject({
      repository: { url: 'https://github.com/alpha/runtime' },
      homepage: 'https://alpha.example.test/',
      bugs: { url: 'https://github.com/alpha/runtime/issues' },
    });
    expect(await readFile(path.join(stageA1, 'apps/docs/src/lib/site.ts'), 'utf8')).toContain(
      'https://docs.alpha.example.test',
    );
    expect(await readFile(path.join(stageA1, 'packages/core/credentials/credential-store.ts'), 'utf8')).toContain(
      'credentialStoreModule',
    );
    await expect(readFile(path.join(stageA1, 'packages/core/credentials/private.pem'), 'utf8')).rejects.toThrow();
    const electronBuilder = await readFile(path.join(stageA1, 'apps/agent-app/electron-builder.yml'), 'utf8');
    const releaseWorkflowA = await readFile(path.join(stageA1, '.github/workflows/release.yml'), 'utf8');
    const releaseWorkflowB = await readFile(path.join(stageB, '.github/workflows/release.yml'), 'utf8');
    expect(releaseWorkflowA).toContain('ARTIFACT: alpha');
    expect(releaseWorkflowA).toContain('TAG_PREFIX: alpha-release-');
    expect(releaseWorkflowA).toContain('CREDENTIAL_SERVICE: alpha');
    expect(releaseWorkflowB).toContain('ARTIFACT: beta');
    expect(releaseWorkflowB).toContain('TAG_PREFIX: beta-release-');
    expect(releaseWorkflowB).toContain('CREDENTIAL_SERVICE: beta');
    expect(electronBuilder).toContain('appId: com.example.alpha');
    expect(electronBuilder).toContain('productName: Alpha');
    expect(electronBuilder).toContain('artifactName: alpha-desktop-${version}-${arch}.${ext}');
    expect(electronBuilder).toContain('executableName: alpha-desktop');
    expect(JSON.parse(await readFile(path.join(stageA1, 'apps/docs/package.json'), 'utf8')).scripts.deploy).toContain(
      '--project-name alpha-docs',
    );
    expect(await readFile(path.join(stageA1, 'apps/docs/src/lib/product-config.generated.ts'), 'utf8')).toContain(
      'Alpha',
    );
    expect(await readFile(path.join(stageA1, 'apps/blog/src/lib/product-config.generated.mjs'), 'utf8')).toContain(
      'Alpha',
    );
    const stagedWebConfig = await readFile(path.join(stageA1, 'apps/agent-web/src/lib/product-config.generated.ts'), 'utf8');
    expect(stagedWebConfig).toContain('export const productPublicConfig = Object.freeze(');
    expect(stagedWebConfig).toContain('Alpha');
    expect(stagedWebConfig).not.toContain('/tmp/alpha');
    expect(stagedWebConfig).not.toContain('PRIVATE_SENTINEL');
    const stagedWebLoader = await readFile(path.join(stageA1, 'apps/agent-web/src/lib/product-config.ts'), 'utf8');
    expect(stagedWebLoader).toContain('return productPublicConfig as IPublicProductConfig;');
    expect(stagedWebLoader).not.toContain('loadProductConfig');
    expect(stagedWebLoader).not.toContain('@robota-sdk/');
    expect(await readFile(path.join(stageA1, 'packages/agent-cli/tsdown.config.ts'), 'utf8')).toContain(
      `__PRODUCT_CONFIG_IDENTITY__: JSON.stringify(${JSON.stringify(embeddedProductIdentity(configA))})`,
    );
    expect(await readFile(path.join(stageA1, 'packages/agent-cli/scripts/build-bun.mjs'), 'utf8')).toContain(
      `__PRODUCT_CONFIG_IDENTITY__: JSON.stringify(${JSON.stringify(embeddedProductIdentity(configA))})`,
    );
    expect(await readFile(path.join(stageA1, 'packages/agent-cli/scripts/build-bun.mjs'), 'utf8')).toContain(
      "const ARTIFACT_PREFIX = 'alpha';",
    );
    expect(await readFile(path.join(stageB, 'packages/agent-cli/scripts/build-bun.mjs'), 'utf8')).toContain(
      "const ARTIFACT_PREFIX = 'beta-bundle';",
    );
    expect(await readFile(path.join(stageA2, 'packages/core/index.ts'), 'utf8')).toContain("from '@alpha/util'");
    expect(await readFile(path.join(stageB, 'packages/core/index.ts'), 'utf8')).toContain("from '@beta/util'");
    expect(await readFile(path.join(source, 'packages', 'core', 'index.ts'), 'utf8')).toBe(before);
    expect(await readFile(path.join(source, 'apps', 'docs', 'src', 'lib', 'site.ts'), 'utf8')).toBe("export const docs = '__PROJECT_DOCS_URL__';\n");
    for (const stage of [stageA1, stageB, stageA2]) {
      const files = await readdir(stage, { recursive: true });
      expect(files.join('\n')).not.toContain('.env.private');
      expect(files.join('\n')).not.toContain('.env.local');
      const stagedSource = await readFile(path.join(stage, 'packages/core/index.ts'), 'utf8');
      expect(stagedSource).not.toContain('@robota-sdk/');
    }
    const stagedText = await readFile(path.join(stageA1, 'package.json'), 'utf8');
    expect(stagedText).not.toContain('PRIVATE_SENTINEL');
    const envTemplate = await readFile(path.join(stageA1, '.env.default'), 'utf8');
    expect(envTemplate).toBe(defaultEnvironment);
    expect(envTemplate).toContain('PRODUCT_PACKAGE_SCOPE=');
    expect(envTemplate).not.toContain('SECURITY_ENCRYPTION_KEY_FILE=');
  });

  it('rejects host operational values smuggled into public and embedded projections', async () => {
    const config = resolveTestConfig({ scope: '@alpha', displayName: 'Alpha' });
    await expect(generateWorkspaceFromConfig({
      outDir: path.join(os.tmpdir(), `invalid-product-stage-${Date.now()}`),
      config,
      publicConfig: { ...publicProductConfig(config), storage: { userRoot: '/private/host/path' } },
      embeddedIdentity: embeddedProductIdentity(config),
    })).rejects.toThrow(/central public product projection/u);
    await expect(generateWorkspaceFromConfig({
      outDir: path.join(os.tmpdir(), `invalid-identity-stage-${Date.now()}`),
      config,
      publicConfig: publicProductConfig(config),
      embeddedIdentity: { ...embeddedProductIdentity(config), secrets: { signingKeyFile: '/private/key' } },
    })).rejects.toThrow(/central embedded identity projection/u);
  });
});
