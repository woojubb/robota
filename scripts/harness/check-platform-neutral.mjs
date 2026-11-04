#!/usr/bin/env node

/**
 * The "Runtime platforms" rule in ARCHITECTURE.md, enforced on every workspace package.
 *
 * An export subpath is Node-only exactly when its `exports` entry maps `"browser": null` ahead of any
 * condition a browser resolver matches. Every other subpath is platform-neutral, and what it loads —
 * static and dynamic imports, followed through workspace packages by their `source` files — may not
 * include a workspace module that imports a Node built-in (also type-only), references a Node global
 * or the `NodeJS` namespace, or imports another package's Node-only subpath. Outside the Browser (DOM)
 * packages it may not reference a DOM-only global either. A third-party module may not import a Node
 * built-in unless it is reached only through dynamic imports inside third-party code; globals inside
 * third-party code are not checked.
 *
 * The check reads source only, never build output, so it gives the same answer in every checkout.
 * Every package appears in exactly one ARCHITECTURE.md list, and the lists agree with the manifests.
 */

import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { builtinModules } from 'node:module';
import path from 'node:path';

import { build, transform } from 'esbuild';
import ts from 'typescript';

import { isEntryPoint } from './entrypoint.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';
import { listManifestPackageDirs } from './workspace-packages.mjs';

const BUILTINS = new Set(builtinModules.flatMap((name) => [name, `node:${name}`]));
const isBuiltin = (specifier) => specifier.startsWith('node:') || BUILTINS.has(specifier);

/**
 * Free identifiers that exist only on Node. esbuild `define` replaces unbound references only, so a
 * local binding, a property name, a string or a comment with the same spelling is not reported.
 */
export const NODE_GLOBALS = [
  'process',
  'Buffer',
  'global',
  'setImmediate',
  'clearImmediate',
  '__dirname',
  '__filename',
  'require',
  'globalThis.process',
  'globalThis.Buffer',
  'globalThis.global',
  'globalThis.setImmediate',
  'globalThis.require',
  'import.meta.dirname',
  'import.meta.filename',
];

/** Globals a browser has and a Worker, Node, Deno or Bun does not. */
export const DOM_GLOBALS = [
  'window',
  'document',
  'localStorage',
  'sessionStorage',
  'location',
  'HTMLElement',
  'customElements',
  'requestAnimationFrame',
  'globalThis.window',
  'globalThis.document',
];

const markers = (names, prefix) =>
  Object.fromEntries(names.map((name, index) => [name, `__${prefix}_${index}__`]));
const NODE_DEFINE = markers(NODE_GLOBALS, 'node_global');
const DOM_DEFINE = markers(DOM_GLOBALS, 'dom_global');

/**
 * Global names whose type comes from `@types/node`: the runtime globals above, their `NodeJS`
 * namespace and `module`. A neutral declaration may not mention them in a type either.
 */
const NODE_TYPE_NAMES = new Set([
  'NodeJS',
  'module',
  ...NODE_GLOBALS.map((name) => name.replace(/^globalThis\./u, '')).filter(
    (name) => !name.includes('.'),
  ),
]);

/**
 * The global a dotted name starts from, `A.B.C` → `A`, type or value; `globalThis.A.B` → `A`, which no
 * local declaration can shadow.
 */
function globalRoot(node) {
  const segments = [];
  for (let step = node; step;) {
    if (ts.isIdentifier(step)) {
      segments.unshift(step.text);
      break;
    }
    if (ts.isQualifiedName(step)) {
      segments.unshift(step.right.text);
      step = step.left;
    } else if (ts.isPropertyAccessExpression(step)) {
      segments.unshift(step.name.text);
      step = step.expression;
    } else return undefined;
  }
  return segments[0] === 'globalThis'
    ? { name: segments[1], global: true }
    : { name: segments[0], global: false };
}

/** Names the file declares itself, so a local `Buffer` type or `process` parameter is not Node's. */
function declaredNames(source) {
  const names = new Set();
  const visit = (node) => {
    if (
      (ts.isInterfaceDeclaration(node) ||
        ts.isTypeAliasDeclaration(node) ||
        ts.isClassDeclaration(node) ||
        ts.isEnumDeclaration(node) ||
        ts.isFunctionDeclaration(node) ||
        ts.isTypeParameterDeclaration(node) ||
        ts.isImportClause(node) ||
        ts.isImportSpecifier(node) ||
        ts.isNamespaceImport(node) ||
        ts.isVariableDeclaration(node) ||
        ts.isParameter(node) ||
        ts.isBindingElement(node)) &&
      node.name &&
      ts.isIdentifier(node.name)
    )
      names.add(node.name.text);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return names;
}

/**
 * What a workspace file names from Node in its source, including what esbuild erases: type-only
 * imports, `import('node:x')` types, and Node's global types — the `NodeJS` namespace, `Buffer` or
 * `typeof process` in a type position, a `/// <reference types="node" />`. Read from the TypeScript
 * syntax tree, so strings and comments are never mistaken for code.
 */
function sourceNodeReferences(file, code) {
  const kind = file.endsWith('.tsx')
    ? ts.ScriptKind.TSX
    : /\.[cm]?ts$/u.test(file)
      ? ts.ScriptKind.TS
      : ts.ScriptKind.JSX;
  const source = ts.createSourceFile(file, code, ts.ScriptTarget.Latest, false, kind);
  const local = declaredNames(source);
  const builtins = new Set();
  const nodeTypes = new Set(
    source.typeReferenceDirectives.some((directive) => directive.fileName === 'node')
      ? ['node']
      : [],
  );
  const nodeType = (root) => {
    if (root === undefined || root.name === undefined || !NODE_TYPE_NAMES.has(root.name)) return;
    if (root.global || !local.has(root.name)) nodeTypes.add(root.name);
  };
  const specifier = (node) => (node && ts.isStringLiteralLike(node) ? node.text : undefined);
  const visit = (node) => {
    let named;
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node))
      named = specifier(node.moduleSpecifier);
    else if (
      ts.isImportEqualsDeclaration(node) &&
      ts.isExternalModuleReference(node.moduleReference)
    )
      named = specifier(node.moduleReference.expression);
    else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument))
      named = specifier(node.argument.literal);
    else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword)
      named = specifier(node.arguments[0]);
    else if (ts.isTypeReferenceNode(node)) nodeType(globalRoot(node.typeName));
    else if (ts.isTypeQueryNode(node)) nodeType(globalRoot(node.exprName));
    else if (ts.isExpressionWithTypeArguments(node)) nodeType(globalRoot(node.expression));
    if (named !== undefined && isBuiltin(named)) builtins.add(named);
    ts.forEachChild(node, visit);
  };
  visit(source);
  return { builtins, nodeTypes: [...nodeTypes].sort() };
}

const ASSET_LOADERS = Object.fromEntries(
  ['.css', '.svg', '.png', '.woff2', '.md', '.html'].map((extension) => [extension, 'empty']),
);

/** The lists in ARCHITECTURE.md "Runtime platforms"; the last two are Node-only. */
export const PLATFORM_LISTS = ['Platform-neutral', 'Browser (DOM)', 'Node host', 'Not yet neutral'];
const NODE_ONLY_LISTS = new Set(['Node host', 'Not yet neutral']);

/** Conditions that may precede `browser: null` without a browser resolver matching them first. */
const BEFORE_BROWSER = new Set(['source', 'types', 'node']);

/**
 * The package's JavaScript subpaths with their conditions, as written in `exports`. A package that
 * ships no importable module (an app shell) declares the entry the check reads in `source`.
 */
function exportEntries(manifest) {
  const { exports } = manifest;
  if (!exports)
    return typeof manifest.source === 'string' ? [['.', { source: manifest.source }]] : [];
  if (typeof exports === 'string' || !Object.keys(exports).some((key) => key.startsWith('.')))
    return [['.', exports]];
  return Object.entries(exports).filter(
    ([subpath]) =>
      subpath !== './package.json' && !subpath.includes('*') && !/\.(css|json)$/u.test(subpath),
  );
}

/** Node-only exactly when the subpath's own conditions map `browser` to null. */
export const isNodeOnly = (target) =>
  target !== null && typeof target === 'object' && target.browser === null;

/** A browser's view of the subpath: the `browser` build if there is one. */
function pick(target, conditions) {
  if (typeof target === 'string') return target;
  if (!target || typeof target !== 'object') return undefined;
  for (const [condition, value] of Object.entries(target))
    if (conditions.includes(condition)) return pick(value, conditions);
  return undefined;
}

/** A shipped browser file (`./dist/browser/x.js`) back to the source file it is built from. */
function browserBuildSource(packageDir, target) {
  const match = /^\.\/dist\/(?:[\w-]+\/)?(.+)\.[cm]?js$/u.exec(target ?? '');
  if (!match) return undefined;
  for (const candidate of [
    `${match[1]}.ts`,
    `${match[1]}.tsx`,
    `${match[1]}/index.ts`,
    `${match[1]}/index.tsx`,
  ]) {
    const file = path.join(packageDir, 'src', candidate);
    if (existsSync(file)) return file;
  }
  return undefined;
}

/**
 * The source files behind a neutral subpath: its `source` file, which the default and node builds
 * are built from, and the source of a separate `browser` build. A neutral subpath is neutral under
 * every condition, because a Worker, Deno or Bun resolves `default`, not `browser`.
 */
function neutralSources(packageDir, target) {
  const source = pick(target, ['source']);
  const files = [source && path.join(packageDir, source)];
  if (target && typeof target === 'object' && target.browser)
    files.push(
      browserBuildSource(
        packageDir,
        pick(target.browser, ['browser', 'import', 'module', 'default']),
      ),
    );
  return [...new Set(files)];
}

function loadWorkspace(root) {
  const packages = new Map();
  for (const dir of listManifestPackageDirs(root)) {
    const manifest = JSON.parse(readFileSync(path.join(dir, 'package.json'), 'utf8'));
    packages.set(manifest.name, {
      dir,
      short: manifest.name.replace(/^@robota-sdk\//u, ''),
      entries: exportEntries(manifest),
    });
  }
  return packages;
}

/** Each list's package names: the backticked names before the item's ` — ` explanation. */
export function documentedPlatforms(architecture) {
  const section = /^## Runtime platforms\n([\s\S]*?)(?=^## )/mu.exec(architecture)?.[1] ?? '';
  const lists = new Map();
  for (const item of section.matchAll(/^- \*\*([^*]+)\*\*:([\s\S]*?)(?=^- |^\s*$)/gmu))
    lists.set(
      item[1],
      [...item[2].split(' — ')[0].matchAll(/`([\w.-]+)`/gu)].map((match) => match[1]),
    );
  return lists;
}

const thirdPartyName = (file) =>
  /node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?((?:@[^/]+\/)?[^/]+)/u.exec(file)?.[1];

async function checkSubpath({ root, packages, label, entryFile, allowDom }) {
  const display = (file) =>
    path
      .relative(root, path.resolve(root, file))
      .replace(/^(?:.*\/)?node_modules\/(?:\.pnpm\/[^/]+\/node_modules\/)?/u, '');
  const nodeOnlyImports = [];
  const resolver = {
    name: 'workspace-platform',
    setup(builder) {
      builder.onResolve({ filter: /.*/ }, (args) =>
        isBuiltin(args.path) ? { path: args.path, external: true } : undefined,
      );
      builder.onResolve({ filter: /^@robota-sdk\// }, (args) => {
        const match = /^(@robota-sdk\/[^/]+)(.*)$/u.exec(args.path);
        const target = match && packages.get(match[1]);
        if (!target) return undefined;
        const conditions = new Map(target.entries).get(match[2] ? `.${match[2]}` : '.');
        if (conditions === undefined) return { errors: [{ text: `${args.path} is not exported` }] };
        if (isNodeOnly(conditions)) {
          nodeOnlyImports.push({ importer: args.importer, specifier: args.path });
          return { path: args.path, external: true };
        }
        const source = pick(conditions, ['source']);
        return source
          ? { path: path.join(target.dir, source) }
          : { errors: [{ text: `${args.path} has no source condition` }] };
      });
    },
  };

  let result;
  try {
    result = await build({
      absWorkingDir: root,
      entryPoints: [entryFile],
      bundle: true,
      write: false,
      metafile: true,
      platform: 'browser',
      format: 'esm',
      logLevel: 'silent',
      jsx: 'automatic',
      loader: ASSET_LOADERS,
      plugins: [resolver],
    });
  } catch (error) {
    const reasons = (error.errors ?? [{ text: String(error) }]).map(
      (failure) =>
        `${failure.text}${failure.location ? ` (${display(failure.location.file)})` : ''}`,
    );
    return [`${label} does not bundle for a neutral consumer: ${reasons.join('; ')}`];
  }

  const inputs = result.metafile.inputs;
  const isWorkspaceFile = (key) => !thirdPartyName(key);
  const entryKey = path.relative(root, entryFile);
  // Everything a neutral consumer can load; a dynamic import inside third-party code is not followed.
  const parent = new Map([[entryKey, null]]);
  const queue = [entryKey];
  while (queue.length > 0) {
    const file = queue.shift();
    for (const edge of inputs[file]?.imports ?? []) {
      if (
        edge.external ||
        (edge.kind === 'dynamic-import' && !isWorkspaceFile(file)) ||
        parent.has(edge.path)
      )
        continue;
      parent.set(edge.path, file);
      queue.push(edge.path);
    }
  }
  const chain = (file) => {
    const steps = [];
    for (let step = file; step; step = parent.get(step)) steps.unshift(display(step));
    return steps.join(' → ');
  };

  const problems = [];
  for (const file of parent.keys()) {
    const workspace = isWorkspaceFile(file);
    for (const edge of inputs[file]?.imports ?? [])
      if (edge.external && isBuiltin(edge.path) && (workspace || edge.kind !== 'dynamic-import'))
        problems.push(`${label} imports ${edge.path}: ${chain(file)}`);
    if (!workspace || !/\.[cm]?[jt]sx?$/u.test(file)) continue;
    const code = readFileSync(path.join(root, file), 'utf8');
    const named = sourceNodeReferences(file, code);
    for (const builtin of named.builtins)
      problems.push(`${label} imports ${builtin}: ${chain(file)}`);
    if (named.nodeTypes.length > 0)
      problems.push(`${label} uses Node types ${named.nodeTypes.join(', ')}: ${chain(file)}`);
    const loader = file.endsWith('.tsx') ? 'tsx' : /\.[cm]?ts$/u.test(file) ? 'ts' : 'jsx';
    const define = allowDom ? NODE_DEFINE : { ...NODE_DEFINE, ...DOM_DEFINE };
    const { code: transformed } = await transform(code, {
      loader,
      define,
      format: 'esm',
      logLevel: 'silent',
    });
    const used = (names, prefix) =>
      names.filter((_, index) => transformed.includes(`__${prefix}_${index}__`));
    const nodeGlobals = used(NODE_GLOBALS, 'node_global');
    if (nodeGlobals.length > 0)
      problems.push(`${label} uses Node global ${nodeGlobals.join(', ')}: ${chain(file)}`);
    const domGlobals = allowDom ? [] : used(DOM_GLOBALS, 'dom_global');
    if (domGlobals.length > 0)
      problems.push(`${label} uses DOM-only global ${domGlobals.join(', ')}: ${chain(file)}`);
  }
  for (const { importer, specifier } of nodeOnlyImports)
    problems.push(
      `${label} imports Node-only ${specifier}: ${chain(path.relative(root, importer))}`,
    );
  return [...new Set(problems)];
}

function declarationProblems(label, conditions) {
  const problems = [];
  if (isNodeOnly(conditions)) {
    const ahead = Object.keys(conditions).slice(0, Object.keys(conditions).indexOf('browser'));
    const matched = ahead.filter((condition) => !BEFORE_BROWSER.has(condition));
    if (matched.length > 0)
      problems.push(
        `${label} maps browser: null after ${matched.join(', ')}, so a browser resolver never reaches it`,
      );
  } else if (!pick(conditions, ['source'])) {
    problems.push(`${label} is platform-neutral but has no source condition to check`);
  }
  return problems;
}

function classificationProblems(lists, packages) {
  const problems = [];
  const listed = new Map();
  for (const label of PLATFORM_LISTS) {
    if (!lists.has(label))
      problems.push(`ARCHITECTURE.md "Runtime platforms" has no "${label}" list`);
    for (const name of lists.get(label) ?? []) {
      if (listed.has(name))
        problems.push(`${name} is listed as both ${listed.get(name)} and ${label}`);
      listed.set(name, label);
    }
  }
  for (const { short, entries } of packages.values()) {
    const label = listed.get(short);
    listed.delete(short);
    if (entries.length === 0) {
      if (label !== undefined)
        problems.push(
          `${short} is listed as ${label}, but declares neither exports nor a source entry to check`,
        );
      continue;
    }
    if (label === undefined) {
      problems.push(`${short} is not in any ARCHITECTURE.md "Runtime platforms" list`);
      continue;
    }
    const nodeOnly = isNodeOnly(new Map(entries).get('.'));
    if (NODE_ONLY_LISTS.has(label) !== nodeOnly)
      problems.push(
        `${short} is listed as ${label}, but its "." export ${nodeOnly ? 'maps' : 'does not map'} browser: null`,
      );
  }
  for (const name of listed.keys())
    problems.push(`ARCHITECTURE.md lists ${name}, which is not a workspace package`);
  return problems;
}

/** Every platform-neutrality problem in the workspace at `root`; empty when the rule holds. */
export async function checkPlatformNeutral(workspaceRoot) {
  // esbuild reports real paths; a root reached through a symlink would not prefix them.
  const root = realpathSync(workspaceRoot);
  const packages = loadWorkspace(root);
  const lists = documentedPlatforms(readFileSync(path.join(root, 'ARCHITECTURE.md'), 'utf8'));
  const domPackages = new Set(lists.get('Browser (DOM)') ?? []);
  const problems = classificationProblems(lists, packages);
  for (const [name, { dir, short, entries }] of packages) {
    for (const [subpath, conditions] of entries) {
      const label = `${name}${subpath === '.' ? '' : subpath.slice(1)}`;
      const declared = declarationProblems(label, conditions);
      problems.push(...declared);
      if (isNodeOnly(conditions) || declared.length > 0) continue;
      for (const entryFile of neutralSources(dir, conditions)) {
        if (!entryFile || !existsSync(entryFile)) {
          problems.push(
            `${label} is platform-neutral but its browser build has no locatable source file`,
          );
          continue;
        }
        problems.push(
          ...(await checkSubpath({
            root,
            packages,
            label,
            entryFile,
            allowDom: domPackages.has(short),
          })),
        );
      }
    }
  }
  return problems;
}

if (isEntryPoint(import.meta)) {
  const root = resolveWorkspaceRoot(import.meta);
  const problems = await checkPlatformNeutral(root);
  if (problems.length === 0) {
    console.log(
      'platform-neutral entries: no Node built-in, Node global or DOM-only global reached',
    );
  } else {
    for (const problem of problems) console.error(problem);
    console.error(
      `\n${problems.length} platform-neutrality problem(s). The rule is in ARCHITECTURE.md "Runtime platforms".`,
    );
    process.exitCode = 1;
  }
}
