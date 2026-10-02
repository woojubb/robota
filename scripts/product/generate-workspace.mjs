#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { appendFile, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import ts from 'typescript';
import { parseDocument, stringify, visit as visitYaml } from 'yaml';
import { embeddedProductIdentity, productConfigEntries, publicProductConfig } from '../../packages/product-config/src/index.ts';

const ROOT = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));
const PRODUCT_SCOPE = '@robota-sdk';
const SOURCE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx', '.mts', '.cts', '.mjs', '.cjs']);
const STRUCTURED_YAML_EXTENSIONS = new Set(['.yaml', '.yml']);
const BINARY_EXTENSIONS = new Set([
  '.png', '.jpg', '.jpeg', '.gif', '.ico', '.webp', '.pdf', '.woff', '.woff2', '.ttf', '.otf',
  '.dmg', '.zip', '.gz', '.tgz', '.wasm', '.node', '.exe', '.dll', '.so', '.dylib', '.icns',
]);
const IGNORED_DIRECTORIES = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  '.next',
  '.astro',
  '.turbo',
  '.cache',
  '.vite',
  'coverage',
  'dist',
  'out',
  'release',
  '.release-output',
  '.release-assets',
  'target',
]);

function assertPackageScope(scope) {
  if (typeof scope !== 'string' || !/^@[a-z0-9][a-z0-9._-]*$/u.test(scope)) {
    throw new Error('identity.packageScope must be a lowercase npm scope such as @example.');
  }
}

function mappedName(value, packageMap) {
  if (typeof value !== 'string') return value;
  for (const [sourceName, productName] of packageMap) {
    if (value === sourceName || value.startsWith(`${sourceName}/`)) {
      return `${productName}${value.slice(sourceName.length)}`;
    }
  }
  return value;
}

function replaceRegexScope(text, scope) {
  return text.replaceAll(PRODUCT_SCOPE, scope);
}

function replacePackageNamesInText(text, packageMap, scope) {
  let rewritten = text;
  const entries = [...packageMap].sort((a, b) => b[0].length - a[0].length);
  for (const [sourceName, productName] of entries) {
    let offset = 0;
    while ((offset = rewritten.indexOf(sourceName, offset)) >= 0) {
      const boundary = rewritten[offset + sourceName.length];
      const previous = rewritten[offset - 1];
      const startsPackageToken = previous === undefined || !/[A-Za-z0-9._-]/u.test(previous);
      const endsPackageToken = boundary === undefined || !/[A-Za-z0-9._-]/u.test(boundary);
      if (startsPackageToken && endsPackageToken) {
        rewritten = `${rewritten.slice(0, offset)}${productName}${rewritten.slice(offset + sourceName.length)}`;
        offset += productName.length;
      } else {
        offset += sourceName.length;
      }
    }
  }
  return replaceRegexScope(rewritten, scope);
}

function applyTextEdits(source, edits) {
  edits.sort((left, right) => right.start - left.start);
  let result = source;
  for (const edit of edits) result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  return result;
}

function rewriteJavaScript(source, filePath, packageMap, scope) {
  const extension = path.extname(filePath).toLowerCase();
  const scriptKind = extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
  const languageVariant = extension === '.tsx' || extension === '.jsx' ? ts.LanguageVariant.JSX : ts.LanguageVariant.Standard;
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, scriptKind);
  const edits = [];
  const addMappedLiteral = (node) => {
    const original = node.text;
    const mapped = replacePackageNamesInText(original, packageMap, scope);
    if (mapped !== original) edits.push({ start: node.getStart(sourceFile) + 1, end: node.end - 1, text: mapped });
  };
  const addMappedTemplatePart = (node, prefixLength, suffixLength) => {
    const original = node.text;
    const mapped = replacePackageNamesInText(original, packageMap, scope);
    if (mapped !== original) {
      const start = node.getStart(sourceFile) + prefixLength;
      edits.push({ start, end: node.end - suffixLength, text: mapped });
    }
  };

  const visit = (node) => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) addMappedLiteral(node);
    if (ts.isTemplateExpression(node)) {
      addMappedTemplatePart(node.head, 1, 2);
      for (const span of node.templateSpans) {
        addMappedTemplatePart(span.literal, 1, ts.isTemplateMiddle(span.literal) ? 2 : 1);
      }
    }
    if (ts.isRegularExpressionLiteral(node)) {
      const original = node.text;
      const mapped = replaceRegexScope(original, scope);
      if (mapped !== original) edits.push({ start: node.getStart(sourceFile), end: node.end, text: mapped });
    }
    if (ts.isJsxText(node)) {
      const original = source.slice(node.getStart(sourceFile), node.end);
      const mapped = replacePackageNamesInText(original, packageMap, scope);
      if (mapped !== original) edits.push({ start: node.getStart(sourceFile), end: node.end, text: mapped });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  const scanner = ts.createScanner(ts.ScriptTarget.Latest, false, languageVariant, source);
  while (scanner.scan() !== ts.SyntaxKind.EndOfFileToken) {
    const kind = scanner.getToken();
    if (kind !== ts.SyntaxKind.SingleLineCommentTrivia && kind !== ts.SyntaxKind.MultiLineCommentTrivia) {
      continue;
    }
    const start = scanner.getTokenPos();
    const end = scanner.getTextPos();
    const original = source.slice(start, end);
    const mapped = replacePackageNamesInText(original, packageMap, scope);
    if (mapped !== original) edits.push({ start, end, text: mapped });
  }
  // The AST edits guarantee module and regex literals are handled correctly. This final pass changes
  // only registered internal package tokens/scope in comments, template text and JSX diagnostics.
  return replacePackageNamesInText(applyTextEdits(source, edits), packageMap, scope);
}

function rewriteStructuredValue(value, packageMap, scope) {
  if (Array.isArray(value)) return value.map((item) => rewriteStructuredValue(item, packageMap, scope));
  if (!value || typeof value !== 'object') {
    return typeof value === 'string' ? mappedName(value, packageMap).replaceAll(PRODUCT_SCOPE, scope) : value;
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      mappedName(key, packageMap).replaceAll(PRODUCT_SCOPE, scope),
      rewriteStructuredValue(item, packageMap, scope),
    ]),
  );
}

function replaceProductPlaceholders(text, publicConfig, productConfig, encode = (value) => value) {
  const repositoryUrl = publicConfig?.identity?.repositoryUrl;
  const websiteUrl = publicConfig?.identity?.websiteUrl;
  const docsUrl = publicConfig?.identity?.docsUrl;
  const blogUrl = publicConfig?.identity?.blogUrl;
  const repositorySlug = repositoryUrl ? new URL(repositoryUrl).pathname.replace(/^\//u, '').replace(/\.git$/u, '') : '';
  const deploy = productConfig?.deploy ?? {};
  const websiteHost = websiteUrl ? new URL(websiteUrl).host : '';
  const cliName = publicConfig?.identity?.cliName ?? '';
  const artifactPrefix = productConfig?.release?.artifactPrefix ?? cliName;
  const desktopArtifactPrefix = `${artifactPrefix}-desktop`;
  const replacements = new Map([
    ['__PRODUCT_ID__', publicConfig?.identity?.id ?? ''],
    ['__PRODUCT_PROJECT_STATE_DIR__', productConfig?.storage?.projectDirectory ?? ''],
    ['__PROJECT_REPOSITORY_URL__', repositoryUrl ?? '#'],
    ['__PROJECT_REPOSITORY_VALUE__', repositoryUrl ?? ''],
    ['__PROJECT_REPOSITORY_RAW_URL__', repositoryUrl ? repositoryUrl.replace('https://github.com/', 'https://raw.githubusercontent.com/').replace(/\.git$/u, '') : '#'],
    ['__PRODUCT_REPOSITORY_SLUG__', repositorySlug],
    ['__PROJECT_WEBSITE_URL__', websiteUrl ?? '#'],
    ['__PROJECT_WEBSITE_HOST__', websiteHost],
    ['__PROJECT_DOCS_URL__', docsUrl ?? '#'],
    ['__PROJECT_BLOG_URL__', blogUrl ?? '#'],
    ['__PROJECT_DOCS_HOST__', docsUrl ? new URL(docsUrl).host : ''],
    ['__PROJECT_RELEASE_BASE_URL__', productConfig?.release?.baseUrl ?? ''],
    ['__PROJECT_RELEASE_TAG_PREFIX__', productConfig?.release?.tagPrefix ?? ''],
    ['__PROJECT_NPM_REGISTRY_URL__', productConfig?.release?.npmRegistryUrl ?? ''],
    ['__PROJECT_PACKAGE_ACCESS__', productConfig?.release?.packageAccess ?? ''],
    ['__PRODUCT_DISPLAY_NAME__', publicConfig?.identity?.displayName ?? ''],
    ['__PRODUCT_CLI_NAME__', publicConfig?.identity?.cliName ?? ''],
    ['__PRODUCT_PACKAGE_SCOPE__', publicConfig?.identity?.packageScope ?? ''],
    ['__PRODUCT_APP_ID__', publicConfig?.identity?.appId ?? ''],
    ['__PRODUCT_CREDENTIAL_SERVICE__', productConfig?.credentials?.serviceNamespace ?? ''],
    ['__PRODUCT_DESKTOP_EXECUTABLE__', productConfig?.identity?.desktopExecutableName ?? ''],
    ['__PRODUCT_DESKTOP_APP_EXECUTABLE__', `${cliName}-desktop`],
    ['__PRODUCT_DESKTOP_ARTIFACT_PREFIX__', desktopArtifactPrefix],
    ['__PRODUCT_PROTOCOL_SCHEME__', productConfig?.identity?.protocolScheme ?? ''],
    ['__PRODUCT_ENV_PREFIX__', productConfig?.identity?.envPrefix ?? ''],
    ['__PRODUCT_ARTIFACT_PREFIX__', artifactPrefix],
    ['__PRODUCT_MODEL_TOOL_PREFIX__', productConfig?.identity?.modelCommandToolPrefix ?? ''],
    ['__DEPLOY_PROJECT_NAME__', deploy.projectName ?? ''],
    ['__DEPLOY_DOCS_PROJECT_NAME__', deploy.docsProjectName ?? ''],
    ['__DEPLOY_BLOG_PROJECT_NAME__', deploy.blogProjectName ?? ''],
    ['__DEPLOY_WORKER_NAME__', deploy.workerName ?? ''],
  ]);
  return text.replace(/__(?:PROJECT|PRODUCT|DEPLOY)_[A-Z_]+__/gu, (placeholder) =>
    replacements.has(placeholder) ? encode(replacements.get(placeholder), placeholder) : placeholder,
  );
}

export function fillProductContent(filePath, text, publicConfig, productConfig) {
  if (!/__(?:PROJECT|PRODUCT|DEPLOY)_[A-Z_]+__/u.test(text)) return text;
  const fill = (value) => replaceProductPlaceholders(value, publicConfig, productConfig);
  const structured = (value) => {
    if (typeof value === 'string') return fill(value);
    if (Array.isArray(value)) return value.map(structured);
    if (value && typeof value === 'object') return Object.fromEntries(
      Object.entries(value).map(([key, entry]) => [fill(key), structured(entry)]),
    );
    return value;
  };
  const yaml = (source) => {
    const document = parseDocument(source, { uniqueKeys: false });
    if (document.errors.length) throw new Error(`Invalid YAML in ${filePath}: ${document.errors[0].message}`);
    visitYaml(document, { Scalar(_key, node) {
      if (typeof node.value === 'string') node.value = fill(node.value);
    } });
    return document.toString();
  };
  const html = (value) => value.replace(/[&<>"']/gu, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
  const literal = (value, quote) => {
    if (quote === '`') return value.replace(/\\/gu, '\\\\').replace(/`/gu, '\\`').replace(/\$\{/gu, '\\${');
    const escaped = JSON.stringify(value).slice(1, -1);
    return quote === "'" ? escaped.replace(/'/gu, "\\'") : escaped;
  };
  const javascript = (source, scriptPath = filePath) => {
    const extension = path.extname(scriptPath).toLowerCase();
    const kind = extension === '.tsx' || extension === '.jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS;
    const ast = ts.createSourceFile(scriptPath, source, ts.ScriptTarget.Latest, true, kind);
    const edits = [];
    const part = (node, prefix, suffix, quote) => {
      const value = fill(node.text);
      if (value !== node.text) edits.push({
        start: node.getStart(ast) + prefix, end: node.end - suffix,
        text: ts.isJsxAttribute(node.parent) ? html(value) : literal(value, quote),
      });
    };
    const visit = (node) => {
      if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) {
        part(node, 1, 1, source[node.getStart(ast)]);
      } else if (ts.isTemplateExpression(node)) {
        part(node.head, 1, 2, '`');
        for (const span of node.templateSpans) part(span.literal, 1, ts.isTemplateMiddle(span.literal) ? 2 : 1, '`');
      } else if (ts.isJsxText(node)) {
        const original = source.slice(node.pos, node.end);
        const value = fill(original);
        if (value !== original) edits.push({ start: node.pos, end: node.end, text: html(value) });
      }
      ts.forEachChild(node, visit);
    };
    visit(ast);
    return applyTextEdits(source, edits);
  };
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') return `${JSON.stringify(structured(JSON.parse(text)), null, 2)}\n`;
  if (STRUCTURED_YAML_EXTENSIONS.has(extension)) return yaml(text);
  if (SOURCE_EXTENSIONS.has(extension)) return javascript(text);
  if (extension === '.astro' && text.startsWith('---\n')) {
    const end = text.indexOf('\n---', 4);
    if (end >= 0) return `---\n${javascript(text.slice(4, end), `${filePath}.ts`)}${replaceProductPlaceholders(text.slice(end), publicConfig, productConfig, html)}`;
  }
  if (extension === '.html' || extension === '.xml' || extension === '.svg' || extension === '.astro') {
    return replaceProductPlaceholders(text, publicConfig, productConfig, html);
  }
  if (extension === '.md') {
    const markdownValue = (value, placeholder) => placeholder.endsWith('_URL__')
      ? value.replace(/[()<>\s]/gu, (char) => encodeURIComponent(char))
      : placeholder === '__PRODUCT_DISPLAY_NAME__' ? value.replace(/[\\`*_{}[\]()#+.!<>]/gu, '\\$&') : value;
    if (text.startsWith('---\n')) {
      const end = text.indexOf('\n---', 4);
      if (end >= 0) return `---\n${yaml(text.slice(4, end))}---${replaceProductPlaceholders(text.slice(end + 4), publicConfig, productConfig, markdownValue)}`;
    }
    return replaceProductPlaceholders(text, publicConfig, productConfig, markdownValue);
  }
  return fill(text);
}

export function omitUnavailableContentLinks(relativeFile, text, publicConfig) {
  if (!relativeFile.startsWith('apps/blog/src/content/')) return text;
  const boundary = text.indexOf('\n---');
  if (!text.startsWith('---\n') || boundary < 0) return text;
  let frontmatter = text.slice(0, boundary + 1);
  const body = text.slice(boundary + 1);
  frontmatter = frontmatter.replace(/^authorUrl:.*\r?\n/gmu, '');
  const repositoryUrl = publicConfig?.identity?.repositoryUrl;
  if (repositoryUrl) {
    const authorLine = /^author:.*$/mu.exec(frontmatter);
    if (authorLine) {
      const insertion = `${authorLine[0]}\nauthorUrl: ${JSON.stringify(repositoryUrl)}`;
      frontmatter = frontmatter.replace(authorLine[0], insertion);
    }
  }
  return `${frontmatter}${body}`;
}

async function injectPublicSiteConfig(outputDirectory, publicConfig, packageScope) {
  for (const appName of ['docs', 'www', 'blog', 'agent-web']) {
    const generatedPath = path.join(outputDirectory, 'apps', appName, 'src/lib/product-config.generated.ts');
    await mkdir(path.dirname(generatedPath), { recursive: true });
    const moduleText = [
      appName === 'agent-web'
        ? `import type { IPublicProductConfig } from '${packageScope}/product-config';`
        : "import type { IProductPublicConfig } from './product-config.types';",
      appName === 'agent-web' ? 'export const isProductBuildConfig = true;' : '',
      appName === 'agent-web'
        ? `export const productPublicConfig = Object.freeze(${JSON.stringify(publicConfig, null, 2)}) as IPublicProductConfig;`
        : `export const productPublicConfig = Object.freeze(${JSON.stringify(publicConfig, null, 2)}) as IProductPublicConfig;`,
      '',
    ].filter(Boolean).join('\n');
    await writeFile(generatedPath, moduleText, { mode: 0o644 });
    if (appName === 'blog') {
      const jsPath = path.join(outputDirectory, 'apps/blog/src/lib/product-config.generated.mjs');
      await writeFile(
        jsPath,
        `export const productPublicConfig = Object.freeze(${JSON.stringify(publicConfig, null, 2)});\n`,
        { mode: 0o644 },
      );
    }
    if (appName === 'agent-web') {
      const stagedLoaderPath = path.join(outputDirectory, 'apps/agent-web/src/lib/product-config.ts');
      await writeFile(stagedLoaderPath, [
        `import { productPublicConfig } from './product-config.generated';`,
        `import type { IPublicProductConfig } from '${packageScope}/product-config';`,
        '',
        'export function loadWebProductConfig(_environment?: Readonly<Record<string, string | undefined>>): IPublicProductConfig {',
        '  if (productPublicConfig === undefined) throw new Error(\'Generated web product configuration is missing.\');',
        '  return productPublicConfig as IPublicProductConfig;',
        '}',
        '',
      ].join('\n'), { mode: 0o644 });
    }
  }
}

async function injectProductPackageMetadata(outputDirectory, publicConfig, releaseConfig) {
  const repositoryUrl = publicConfig?.identity?.repositoryUrl;
  const homepage = publicConfig?.identity?.websiteUrl;
  for (const root of ['.', 'packages', 'apps', 'examples', 'scratch']) {
    const absoluteRoot = path.join(outputDirectory, root);
    let manifestPaths;
    if (root === '.') {
      manifestPaths = [path.join(outputDirectory, 'package.json')];
    } else {
      let entries;
      try {
        entries = await walk(absoluteRoot);
      } catch {
        continue;
      }
      manifestPaths = entries.filter((file) => path.basename(file) === 'package.json')
        .map((file) => path.join(absoluteRoot, file));
    }
    for (const filePath of manifestPaths) {
      let sourceText;
      try { sourceText = await readFile(filePath, 'utf8'); } catch { continue; }
      const manifest = JSON.parse(sourceText);
      delete manifest.repository;
      delete manifest.homepage;
      delete manifest.bugs;
      if (repositoryUrl) {
        manifest.repository = { type: 'git', url: repositoryUrl };
        manifest.bugs = { url: `${repositoryUrl.replace(/\.git$/u, '')}/issues` };
      }
      if (homepage) manifest.homepage = homepage;
      if (manifest.private === false && releaseConfig?.packageAccess) {
        manifest.publishConfig = { ...manifest.publishConfig, access: releaseConfig.packageAccess };
      }
      await writeFile(filePath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
    }
  }
  if (releaseConfig?.packageAccess) {
    const file = path.join(outputDirectory, '.changeset/config.json');
    try {
      const changeset = JSON.parse(await readFile(file, 'utf8'));
      changeset.access = releaseConfig.packageAccess;
      await writeFile(file, `${JSON.stringify(changeset, null, 2)}\n`, { mode: 0o644 });
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }
}

async function injectConfiguredCliBin(outputDirectory, cliName) {
  const manifestPath = path.join(outputDirectory, 'packages/agent-cli/package.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  if (!manifest.bin || typeof manifest.bin !== 'object' || Array.isArray(manifest.bin)) {
    throw new Error('packages/agent-cli/package.json must define a bin object for generated CLI identity.');
  }
  const neutralTarget = manifest.bin.agent ?? manifest.bin.robota;
  if (typeof neutralTarget !== 'string') {
    throw new Error('packages/agent-cli/package.json must define the source CLI executable for generated identity.');
  }
  delete manifest.bin.agent;
  delete manifest.bin.robota;
  manifest.bin[cliName] = neutralTarget;
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, { mode: 0o644 });
}

export function rewriteContent(filePath, content, packageMap, scope = '@example') {
  const extension = path.extname(filePath).toLowerCase();
  if (extension === '.json') {
    const sourceFile = ts.parseJsonText(filePath, content);
    if (sourceFile.parseDiagnostics.length > 0) {
      const diagnostic = sourceFile.parseDiagnostics[0];
      const message = ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n');
      throw new Error(`Invalid JSON in ${filePath}: ${message}`);
    }
    const parseErrors = [];
    const parsed = ts.convertToObject(sourceFile, parseErrors);
    if (parseErrors.length > 0) {
      throw new Error(`Invalid JSON in ${filePath}: ${parseErrors.join('; ')}`);
    }
    return `${JSON.stringify(rewriteStructuredValue(parsed, packageMap, scope), null, 2)}\n`;
  }
  if (STRUCTURED_YAML_EXTENSIONS.has(extension)) {
    const document = parseDocument(content, { uniqueKeys: false });
    if (document.errors.length) throw new Error(`Invalid YAML in ${filePath}: ${document.errors[0].message}`);
    return stringify(rewriteStructuredValue(document.toJSON(), packageMap, scope));
  }
  if (SOURCE_EXTENSIONS.has(extension)) return rewriteJavaScript(content, filePath, packageMap, scope);
  // CSS, Markdown, HTML, shell, XML and other text formats use only known package identities and
  // the one known internal scope token used by bundle-external predicates.
  return replacePackageNamesInText(content, packageMap, scope);
}

export function injectCliBundleIdentity(source, identity, filePath = 'packages/agent-cli/tsdown.config.ts') {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  let initializer;
  const visit = (node) => {
    if (
      ts.isVariableDeclaration(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'define' &&
      node.initializer &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!initializer) {
    throw new Error(`${filePath} must declare a ` + '`define` object for CLI build-time product identity.');
  }
  if (
    initializer.properties.some(
      (property) =>
        (ts.isPropertyAssignment(property) || ts.isShorthandPropertyAssignment(property)) &&
        ts.isIdentifier(property.name) &&
        property.name.text === '__PRODUCT_CONFIG_IDENTITY__',
    )
  ) {
    throw new Error(`${filePath} already defines __PRODUCT_CONFIG_IDENTITY__; remove the duplicate stage injection.`);
  }
  const openBrace = source.indexOf('{', initializer.getStart(sourceFile));
  if (openBrace < 0) throw new Error(`${filePath} has an unreadable ` + '`define` object.');
  const property = `\n  __PRODUCT_CONFIG_IDENTITY__: JSON.stringify(${JSON.stringify(identity)}),`;
  return `${source.slice(0, openBrace + 1)}${property}${source.slice(openBrace + 1)}`;
}

export function injectBunBundleIdentity(source, identity, filePath = 'packages/agent-cli/scripts/build-bun.mjs') {
  const sourceFile = ts.createSourceFile(filePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  let initializer;
  const visit = (node) => {
    if (
      ts.isPropertyAssignment(node) &&
      ts.isIdentifier(node.name) &&
      node.name.text === 'define' &&
      ts.isObjectLiteralExpression(node.initializer)
    ) {
      initializer = node.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  if (!initializer) throw new Error(`${filePath} must pass a ` + '`define` object to Bun.build.');
  if (
    initializer.properties.some(
      (property) =>
        ts.isPropertyAssignment(property) &&
        ((ts.isIdentifier(property.name) && property.name.text === '__PRODUCT_CONFIG_IDENTITY__') ||
          (ts.isStringLiteral(property.name) && property.name.text === '__PRODUCT_CONFIG_IDENTITY__')),
    )
  ) {
    throw new Error(`${filePath} already defines __PRODUCT_CONFIG_IDENTITY__; remove the duplicate stage injection.`);
  }
  const openBrace = source.indexOf('{', initializer.getStart(sourceFile));
  if (openBrace < 0) throw new Error(`${filePath} has an unreadable ` + '`define` object.');
  const property = `\n      __PRODUCT_CONFIG_IDENTITY__: JSON.stringify(${JSON.stringify(identity)}),`;
  return `${source.slice(0, openBrace + 1)}${property}${source.slice(openBrace + 1)}`;
}

async function walk(root, relativePath = '') {
  const entries = await readdir(path.join(root, relativePath), { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(relativePath, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.worktree')) {
        files.push(...(await walk(root, relative)));
      }
    } else if (entry.isFile()) {
      if (isPrivateEnvironmentFile(entry.name) || isGeneratedSecretPath(relative)) continue;
      files.push(relative);
    }
  }
  return files;
}

function getTrackedSourceFiles(sourceRoot) {
  const result = spawnSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: sourceRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  return result.stdout.split('\0').filter((relative) => {
    if (!relative || isPrivateEnvironmentFile(path.basename(relative)) || isGeneratedSecretPath(relative)) return false;
    return !relative.split(path.sep).some((part) => IGNORED_DIRECTORIES.has(part));
  });
}

function isPrivateEnvironmentFile(fileName) {
  return fileName.startsWith('.env') || fileName === '.npmrc' || fileName.endsWith('.pem') || fileName.endsWith('.p12');
}

function isGeneratedSecretPath(relativePath) {
  return relativePath.split(path.sep).some((part) =>
    part === 'secrets' || part === 'private-env',
  );
}

async function readPackageManifests(sourceRoot) {
  const roots = ['packages', 'apps', 'examples', 'scratch'];
  const manifests = [];
  for (const root of roots) {
    const absoluteRoot = path.join(sourceRoot, root);
    try {
      await lstat(absoluteRoot);
    } catch {
      continue;
    }
    for (const relativeFile of await walk(absoluteRoot)) {
      if (path.basename(relativeFile) !== 'package.json') continue;
      const manifestPath = path.join(absoluteRoot, relativeFile);
      let manifest;
      try {
        manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      } catch {
        continue;
      }
      if (typeof manifest.name === 'string') manifests.push(manifest.name);
    }
  }
  return manifests;
}

export async function collectPackageMap(sourceRoot, packageScope) {
  assertPackageScope(packageScope);
  const packageNames = await readPackageManifests(sourceRoot);
  const mapping = new Map();
  for (const packageName of new Set(packageNames)) {
    if (!packageName.startsWith(`${PRODUCT_SCOPE}/`)) continue;
    mapping.set(packageName, `${packageScope}${packageName.slice(PRODUCT_SCOPE.length)}`);
  }
  if (mapping.size === 0) throw new Error(`No ${PRODUCT_SCOPE} packages found under ${sourceRoot}.`);
  return mapping;
}

function resolveOutsideSource(sourceRoot, outputDirectory) {
  const source = path.resolve(sourceRoot);
  const output = path.resolve(outputDirectory);
  const relative = path.relative(source, output);
  if (!relative.startsWith('..') && !path.isAbsolute(relative)) {
    throw new Error('Generated workspace output must be outside the source checkout.');
  }
  if (relative === '..' || relative.startsWith(`..${path.sep}`)) return { source, output };
  const reverse = path.relative(output, source);
  if (reverse === '.' || reverse === '') throw new Error('Generated workspace output cannot equal the source checkout.');
  return { source, output };
}

async function copyFiles(sourceRoot, outputDirectory, files, packageMap, scope) {
  for (const relativeFile of files) {
    const sourceFile = path.join(sourceRoot, relativeFile);
    let sourceStat;
    try {
      sourceStat = await lstat(sourceFile);
    } catch {
      continue;
    }
    if (!sourceStat.isFile()) continue;
    const destinationFile = path.join(outputDirectory, relativeFile);
    await mkdir(path.dirname(destinationFile), { recursive: true });
    const content = await readFile(sourceFile);
    const mode = sourceStat.mode & 0o777;
    if (BINARY_EXTENSIONS.has(path.extname(relativeFile).toLowerCase())) {
      await writeFile(destinationFile, content, { mode });
      continue;
    }
    let rewritten;
    try {
      rewritten = rewriteContent(relativeFile, content.toString('utf8'), packageMap, scope);
    } catch (error) {
      if (path.extname(relativeFile).toLowerCase() === '.json' || STRUCTURED_YAML_EXTENSIONS.has(path.extname(relativeFile).toLowerCase())) {
        throw new Error(`Could not transform ${relativeFile}: ${error.message}`, { cause: error });
      }
      rewritten = content.toString('utf8');
    }
    await writeFile(destinationFile, rewritten, { mode });
  }
}

function assertPublicConfig(config, publicConfig, embeddedIdentity) {
  const scope = config?.identity?.packageScope;
  assertPackageScope(scope);
  if (!publicConfig || typeof publicConfig !== 'object' || Array.isArray(publicConfig)) {
    throw new Error('publicConfig must be the public projection from the product config contract.');
  }
  if (Object.hasOwn(publicConfig, 'secrets')) {
    throw new Error('Private runtime references must not be written to the generated public config.');
  }
  if (JSON.stringify(publicConfig) !== JSON.stringify(publicProductConfig(config))) {
    throw new Error('publicConfig must exactly match the central public product projection.');
  }
  if (!embeddedIdentity || typeof embeddedIdentity !== 'object' || Array.isArray(embeddedIdentity)) {
    throw new Error('embeddedIdentity must be the embedded identity projection from the product config contract.');
  }
  if (JSON.stringify(embeddedIdentity) !== JSON.stringify(embeddedProductIdentity(config))) {
    throw new Error('embeddedIdentity must exactly match the central embedded identity projection.');
  }
}

export async function generateWorkspaceFromConfig({
  sourceRoot = ROOT,
  outDir,
  config,
  defaultEnvironment = '',
  publicConfig,
  embeddedIdentity,
}) {
  if (!outDir) throw new Error('Pass --out <directory> for generated product workspace output.');
  assertPublicConfig(config, publicConfig, embeddedIdentity);
  const { source, output } = resolveOutsideSource(sourceRoot, outDir);
  try {
    await lstat(output);
    throw new Error(`Output path already exists; choose a new --out directory: ${output}`);
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }

  await mkdir(path.dirname(output), { recursive: true });
  const temporaryOutput = await mkdtemp(path.join(path.dirname(output), '.product-workspace-'));
  try {
    const packageMap = await collectPackageMap(source, config.identity.packageScope);
    const files = getTrackedSourceFiles(source) ?? (await walk(source));
    await copyFiles(source, temporaryOutput, files, packageMap, config.identity.packageScope);

    // URLs and display placeholders are evaluated only in the stage. The checked-in source stays
    // neutral and a product with an unset optional URL gets an inert link target.
    for (const relativeFile of files) {
      const extension = path.extname(relativeFile).toLowerCase();
      if (BINARY_EXTENSIONS.has(extension) || isPrivateEnvironmentFile(path.basename(relativeFile))) continue;
      const stageFile = path.join(temporaryOutput, relativeFile);
      try {
        const current = await readFile(stageFile, 'utf8');
        let authored = current;
        const template = path.join(source, 'scripts/product/templates', relativeFile);
        try {
          authored = rewriteContent(relativeFile, await readFile(template, 'utf8'), packageMap, config.identity.packageScope);
        } catch (error) {
          if (error?.code !== 'ENOENT') throw error;
        }
        let filled = fillProductContent(relativeFile, authored, publicConfig, config);
        filled = omitUnavailableContentLinks(relativeFile, filled, publicConfig);
        if (filled !== current) await writeFile(stageFile, filled, { mode: 0o644 });
      } catch (error) {
        if (error?.code !== 'ENOENT') throw new Error(`Could not fill ${relativeFile}: ${error.message}`, { cause: error });
      }
    }

    await injectProductPackageMetadata(temporaryOutput, publicConfig, config.release);
    await injectConfiguredCliBin(temporaryOutput, config.identity.cliName);
    await injectPublicSiteConfig(temporaryOutput, publicConfig, config.identity.packageScope);

    for (const relativeFile of ['apps/docs/public/CNAME']) {
      const filePath = path.join(temporaryOutput, relativeFile);
      try {
        await readFile(filePath, 'utf8');
        const docsUrl = publicConfig?.identity?.docsUrl;
        if (docsUrl) await writeFile(filePath, `${new URL(docsUrl).host}\n`, { mode: 0o644 });
        else await rm(filePath, { force: true });
      } catch {
        // A missing optional static-host file needs no injection.
      }
    }

    const productDirectory = path.join(temporaryOutput, '.product');
    await mkdir(productDirectory, { recursive: true });
    const cliConfigPath = path.join(temporaryOutput, 'packages/agent-cli/tsdown.config.ts');
    const cliConfig = await readFile(cliConfigPath, 'utf8');
    await writeFile(cliConfigPath, injectCliBundleIdentity(cliConfig, embeddedIdentity), { mode: 0o644 });
    const bunConfigPath = path.join(temporaryOutput, 'packages/agent-cli/scripts/build-bun.mjs');
    const bunConfig = await readFile(bunConfigPath, 'utf8');
    await writeFile(bunConfigPath, injectBunBundleIdentity(bunConfig, embeddedIdentity), { mode: 0o644 });
    await writeFile(path.join(temporaryOutput, '.env.default'), defaultEnvironment, { mode: 0o644 });
    await writeFile(
      path.join(productDirectory, 'identity.json'),
      `${JSON.stringify(embeddedIdentity, null, 2)}\n`,
      { mode: 0o644 },
    );
    await writeFile(
      path.join(productDirectory, 'public-config.json'),
      `${JSON.stringify(publicConfig, null, 2)}\n`,
      { mode: 0o644 },
    );
    await writeFile(
      path.join(productDirectory, 'package-map.json'),
      `${JSON.stringify(Object.fromEntries(packageMap), null, 2)}\n`,
      { mode: 0o644 },
    );
    if (!publicConfig?.identity?.docsUrl) {
      await rm(path.join(temporaryOutput, 'apps/www/public/_redirects'), { force: true });
      const robotsPath = path.join(temporaryOutput, 'apps/docs/public/robots.txt');
      try {
        const robots = await readFile(robotsPath, 'utf8');
        await writeFile(robotsPath, robots.split(/\r?\n/u).filter((line) => !/^Sitemap:/iu.test(line)).join('\n'), { mode: 0o644 });
      } catch {
        // Optional static robots file.
      }
      const schemaPath = path.join(temporaryOutput, 'apps/docs/public/schemas/keybindings.schema.json');
      try {
        const schema = JSON.parse(await readFile(schemaPath, 'utf8'));
        delete schema.$id;
        await writeFile(schemaPath, `${JSON.stringify(schema, null, 2)}\n`, { mode: 0o644 });
      } catch {
        // Optional schema asset.
      }
    }
    await rename(temporaryOutput, output);
    return output;
  } catch (error) {
    await rm(temporaryOutput, { recursive: true, force: true });
    throw error;
  }
}

function parseCliArguments(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--env' || arg === '--out' || arg === '--github-env' || arg === '--github-output') {
      const value = argv[++index];
      if (!value || value.startsWith('--')) throw new Error(`${arg} requires a path.`);
      options[arg.slice(2)] = value;
    } else if (arg === '--help' || arg === '-h') {
      options.help = true;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

/** Carry only the validated contract into later workflow steps; never export ambient credentials. */
export function workflowProductEnvironment(config, configFile, workspace) {
  const entries = [
    ['PRODUCT_CONFIG_FILE', path.resolve(configFile)],
    ['PRODUCT_WORKSPACE', path.resolve(workspace)],
    ...productConfigEntries().map(({ section, field, descriptor }) => [
      descriptor.variable,
      typeof config[section][field] === 'object' ? JSON.stringify(config[section][field]) : config[section][field] ?? '',
    ]),
  ];
  return `${entries.map(([key, value]) => {
    if (/[\r\n]/u.test(value)) throw new Error(`${key} cannot contain newlines in workflow environment transport.`);
    return `${key}=${value}`;
  }).join('\n')}\n`;
}

export function workflowProductOutputs(config) {
  return [
    `artifact_prefix=${config.release.artifactPrefix ?? config.identity.cliName}`,
    `tag_prefix=${config.release.tagPrefix ?? ''}`,
    `credential_service=${config.credentials.serviceNamespace}`,
    `repository_url=${config.identity.repositoryUrl ?? ''}`,
  ].join('\n') + '\n';
}

export async function generateWorkspaceFromEnvironmentFile({ filePath, outDir, environment, environmentOutput, stepOutput }) {
  // The package is TypeScript so it can share the exact schema and environment parser with runtime.
  // `tsx` is used by the command above and registers the loader for this dynamic import.
  const { loadProductConfig } = await import('../../packages/product-config/src/node.ts');
  const { embeddedProductIdentity, generateDefaultEnvironment, publicProductConfig } = await import(
    '../../packages/product-config/src/index.ts'
  );
  const config = await loadProductConfig({ environment, filePath: path.resolve(filePath) });
  const output = await generateWorkspaceFromConfig({
    outDir,
    config,
    defaultEnvironment: generateDefaultEnvironment(),
    publicConfig: publicProductConfig(config),
    embeddedIdentity: embeddedProductIdentity(config),
  });
  if (environmentOutput) await appendFile(
    path.resolve(environmentOutput), workflowProductEnvironment(config, filePath, output), { mode: 0o600 },
  );
  if (stepOutput) await appendFile(path.resolve(stepOutput), workflowProductOutputs(config), { mode: 0o600 });
  return output;
}

async function main() {
  const options = parseCliArguments(process.argv.slice(2));
  if (options.help) {
    process.stdout.write('Usage: pnpm exec tsx scripts/product/generate-workspace.mjs --env <file> --out <directory> [--github-env <file>] [--github-output <file>]\n');
    return;
  }
  if (!options.env || !options.out) throw new Error('Usage: generator requires --env <file> and --out <directory>.');
  const output = await generateWorkspaceFromEnvironmentFile({
    filePath: options.env,
    outDir: options.out,
    environment: { ...process.env },
    environmentOutput: options['github-env'],
    stepOutput: options['github-output'],
  });
  process.stdout.write(`${output}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
}
