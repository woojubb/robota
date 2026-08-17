#!/usr/bin/env node

/**
 * ARCH-037: a barrel-exported function's parameter types must be exported from the same barrel.
 *
 * ## The defect this exists for, twice
 *
 * `subagentExecutionRoot` is on `agent-executor`'s barrel. Its parameter type
 * `ISubagentExecutionEnvelope` was declared and exported at its own module and appeared on neither
 * the sub-barrel nor the package barrel, so **a consumer of the public function could not name what
 * it must pass.** ARCH-025 had already fixed the identical shape for `IScheduleEditPatch`. The repair
 * did not become a habit, which is the whole argument for a mechanism rather than a third note.
 *
 * A published function whose argument is unnameable is not a smaller version of a published function
 * — it is one the consumer must reverse-engineer or cast into. That is why this is a floor and not a
 * lint preference.
 *
 * ## What it checks, and the two things it deliberately does not
 *
 * For each configured package barrel: every function it exports, whether declared there or re-exported
 * from a module beneath it, must have every NAMED type in its parameter positions exported from that
 * same barrel.
 *
 * NOT checked, because each would fire on correct code:
 *
 *   - **Return types.** A consumer can hold a returned value without naming its type
 *     (`const x = f()`), so an unexported return type is a smaller problem and a much noisier rule.
 *   - **Types owned by another package.** `IAgentDefinition` arriving from `@robota-sdk/agent-core`
 *     is nameable by any consumer that may depend on that package; requiring the barrel to
 *     re-export it would demand exactly the pass-through re-exports STRUCT-07 bans. Only types
 *     DECLARED inside the package are required to be on its barrel.
 *
 * Built-ins and utility types (`string`, `Promise`, `Record`, …) are skipped for the same reason: they
 * are nameable everywhere.
 */

import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

/**
 * What the last run read. Exported so a test asserts the number the scan prints
 * (measurement-provenance.md) — "examined 0 barrels" reads exactly like a clean repository.
 */
let examinedBarrels = 0;

export function examinedBarrelCount() {
  return examinedBarrels;
}

/** Type names every consumer can already name, so a barrel is not required to export them. */
const AMBIENT_TYPES = new Set([
  'string',
  'number',
  'boolean',
  'void',
  'unknown',
  'never',
  'any',
  'object',
  'symbol',
  'bigint',
  'null',
  'undefined',
  'Promise',
  'Array',
  'ReadonlyArray',
  'Readonly',
  'Record',
  'Partial',
  'Required',
  'Pick',
  'Omit',
  'Map',
  'Set',
  'ReadonlyMap',
  'ReadonlySet',
  'Date',
  'Error',
  'RegExp',
  'AbortSignal',
  'Iterable',
  'AsyncIterable',
  'IteratorResult',
  'Buffer',
  'URL',
]);

/** The tail identifier of a possibly-qualified type name. */
function tailName(node) {
  let tail = node?.typeName ?? node?.exprName;
  while (tail && ts.isQualifiedName(tail)) tail = tail.right;
  return tail?.text ?? tail?.escapedText;
}

/** Every named type appearing anywhere inside `node`'s parameter list. */
export function parameterTypeNames(fn) {
  const names = new Set();
  const walk = (node) => {
    if (ts.isTypeReferenceNode(node)) {
      const name = tailName(node);
      if (name) names.add(name);
    }
    ts.forEachChild(node, walk);
  };
  for (const parameter of fn.parameters ?? []) {
    if (parameter.type) walk(parameter.type);
  }
  return [...names];
}

/**
 * What one file declares and publishes: `{ functions, exportedNames, reexports, starExports }`.
 *
 * `functions` covers every shape a barrel can publish a callable in, because review measured seven
 * that an earlier revision missed silently — `export const f = (…) => …`, `export default function`,
 * an overload set (only the first signature was read, so the dirty overload was invisible), and a
 * name arriving through `export * from`. A floor that reads one declaration form reports zero for
 * every other, which is the shape this whole item is about.
 *
 * `starExports` is tracked rather than ignored for the same reason, and it cut BOTH ways before it
 * was: a function published by `export *` was never checked, and a TYPE published by `export *` was
 * reported as unexported — ten false positives on `agent-core` alone, whose barrel publishes that way.
 */
export function readBarrel(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const functions = [];
  const exportedNames = new Set();
  const reexports = [];
  const starExports = [];

  const isExported = (node) =>
    (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
  const isDefault = (node) =>
    (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.DefaultKeyword);

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && isExported(node)) {
      // An overload set declares the same name several times; every signature is part of the
      // published contract, so each is read rather than only the first.
      const name = node.name?.text ?? (isDefault(node) ? 'default' : undefined);
      if (name) {
        exportedNames.add(name);
        functions.push({ name, node });
      }
    }
    // `export const f = (…) => …` / `= function (…) …`: a published callable with no
    // FunctionDeclaration anywhere.
    if (ts.isVariableStatement(node) && isExported(node)) {
      for (const declaration of node.declarationList?.declarations ?? []) {
        const name = declaration.name?.text;
        if (!name) continue;
        exportedNames.add(name);
        const init = declaration.initializer;
        if (init?.parameters) functions.push({ name, node: init });
      }
    }
    if (
      (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) &&
      isExported(node) &&
      node.name?.text
    ) {
      exportedNames.add(node.name.text);
    }
    if (ts.isClassDeclaration(node) && isExported(node) && node.name?.text) {
      exportedNames.add(node.name.text);
    }
    if (ts.isExportDeclaration(node)) {
      const module = node.moduleSpecifier?.text;
      const elements = node.exportClause?.elements;
      if (!elements && module) {
        // `export * from './x.js'` — publishes whatever that module publishes, transitively.
        starExports.push({ module });
      }
      for (const element of elements ?? []) {
        const local = element.name?.text;
        const original = element.propertyName?.text ?? local;
        if (!local) continue;
        exportedNames.add(local);
        // An ALIASED re-export publishes the local name; the original is what the target declares.
        if (module) reexports.push({ local, original, module });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { functions, exportedNames, reexports, starExports };
}

/** Resolve a relative module specifier to a file inside the package, or undefined. */
function resolveModule(fromFile, specifier, root) {
  if (!specifier?.startsWith('.')) return undefined;
  const base = join(dirname(fromFile), specifier).replace(/\.(js|mjs|cjs)$/, '');
  for (const candidate of [`${base}.ts`, `${base}.tsx`, `${base}/index.ts`]) {
    if (existsSync(resolve(root, candidate))) return candidate;
  }
  return undefined;
}

/**
 * Everything a barrel publishes, resolved to a FIXPOINT rather than to a fixed number of hops.
 *
 * Review demonstrated the cost of a hop limit on a configured barrel: `agent-executor`'s
 * `index.ts` → `background-tasks/index.ts` → `runners/index.ts` → the runner modules is THREE hops,
 * and a two-hop walk read 10 of its 13 in-scope functions while the header claimed it read every one.
 * Deleting three parameter types from that barrel left the floor GREEN. A `visited` set makes the
 * depth a property of the tree rather than of this function.
 */
export function resolvePublished(barrel, root, readFile) {
  const exportedNames = new Set();
  const functions = [];
  const visited = new Set();

  /**
   * `wanted` is the crux, and an earlier revision got it wrong in the widening direction: it unioned
   * every name each visited module declared, so a name the BARREL does not re-export still counted as
   * published. Deleting a real re-export line then changed nothing and the floor stayed green — a
   * resolver reading a WIDER surface than the package actually has, which hides findings rather than
   * inventing them.
   *
   * So a module reached by a NAMED re-export contributes only that name; one reached by `export *`
   * contributes everything it publishes, because that is what `export *` means.
   */
  const walk = (file, wanted) => {
    const key = `${file}#${wanted ?? '*'}`;
    if (visited.has(key)) return;
    visited.add(key);

    let content;
    try {
      content = readFile(file);
    } catch {
      return;
    }
    const read = readBarrel(content, file);

    if (wanted === undefined) {
      for (const name of read.exportedNames) exportedNames.add(name);
      for (const fn of read.functions) functions.push({ ...fn, declaredIn: file });
    } else {
      if (read.exportedNames.has(wanted)) exportedNames.add(wanted);
      for (const fn of read.functions) {
        if (fn.name === wanted) functions.push({ ...fn, declaredIn: file });
      }
    }

    for (const entry of read.reexports) {
      const target = resolveModule(file, entry.module, root);
      if (!target) continue;
      // Follow a named re-export only when the barrel actually asked for that name (or asked for
      // everything). The alias case matters: the barrel publishes `local`, the target declares
      // `original`.
      if (wanted === undefined || entry.local === wanted) walk(target, entry.original);
    }
    for (const star of read.starExports) {
      const target = resolveModule(file, star.module, root);
      if (target) walk(target, wanted);
    }
  };

  walk(barrel, undefined);
  return { exportedNames, functions };
}

/**
 * Findings for one configured barrel. `settings` is injectable so `examined` is asserted against a
 * fixture of known size rather than self-reported.
 */
export function findBarrelParameterTypeFindings(root = process.cwd(), settingsOverride) {
  const settings = settingsOverride ?? loadHarnessConfig(root).barrelParameterTypes ?? {};
  const barrels = settings.barrels ?? [];

  // Fail CLOSED on an empty scope: a floor that examines nothing prints what a clean tree prints.
  if (barrels.length === 0) {
    return {
      findings: [
        {
          rule: 'barrel-scope-empty',
          detail:
            'barrelParameterTypes.barrels is empty, so this floor reads no barrel and cannot fail. ' +
            'The scope is the check.',
        },
      ],
      examined: 0,
    };
  }

  requireGovernedTree(root, barrels, { scan: 'barrel-parameter-types' });

  examinedBarrels = 0;
  const findings = [];

  const readCache = new Map();
  const readFile = (file) => {
    if (!readCache.has(file)) readCache.set(file, readFileSync(join(root, file), 'utf8'));
    return readCache.get(file);
  };

  for (const barrel of barrels) {
    const { exportedNames, functions } = resolvePublished(barrel, root, readFile);
    examinedBarrels += 1;

    for (const fn of functions) {
      // A function's OWN generic parameters are not types the barrel owes anyone — `<TItem>` is
      // bound by the signature. Review found this over-firing where a generic's name collided with
      // an exported alias, which a `T`-prefixing repo makes likely rather than exotic.
      const ownTypeParameters = new Set(
        (fn.node.typeParameters ?? []).map((p) => p.name?.text).filter(Boolean),
      );
      for (const typeName of parameterTypeNames(fn.node)) {
        if (ownTypeParameters.has(typeName)) continue;
        if (exportedNames.has(typeName)) continue;
        if (!declaredInPackage(root, barrel, typeName)) continue;
        findings.push({
          rule: 'barrel-parameter-type-unexported',
          detail:
            `${barrel}: \`${fn.name}\` (declared in ${fn.declaredIn}) is exported but its parameter ` +
            `type \`${typeName}\` is not. A consumer of the function cannot name what it must pass, ` +
            `so they reverse-engineer the shape or cast into it — which is the defect ARCH-025 fixed ` +
            `for \`IScheduleEditPatch\` and ARCH-037 found again on \`subagentExecutionRoot\` and ` +
            `\`createDefaultTools\`. Export it from this barrel.`,
        });
      }
    }
  }

  return { findings, examined: examinedBarrels };
}

/**
 * Whether `typeName` is DECLARED in the barrel's own package `src` — the gate that keeps this floor
 * off other packages' types, which a barrel must not re-export (STRUCT-07).
 *
 * Test files are excluded wherever they sit, not only under `__tests__/`: review found a type
 * declared in a sibling `*.test.ts` counted as the package's, so the floor demanded a barrel publish
 * a fixture. Results are cached per package because an unmatched name otherwise re-walks the whole
 * `src` tree — measured at 7 s across 55 barrels.
 */
const declaredCache = new Map();

function declaredInPackage(root, barrel, typeName) {
  const packageSrc = barrel.slice(0, barrel.indexOf('/src/') + 5);
  if (!packageSrc) return false;
  const cacheKey = `${root}::${packageSrc}`;
  if (!declaredCache.has(cacheKey)) {
    const declared = new Set();
    const stack = [resolve(root, packageSrc)];
    while (stack.length > 0) {
      const dir = stack.pop();
      let entries;
      try {
        entries = readdirSync(dir);
      } catch {
        continue;
      }
      for (const entry of entries) {
        const full = join(dir, entry);
        let stat;
        try {
          stat = statSync(full);
        } catch {
          continue;
        }
        if (stat.isDirectory()) {
          if (entry !== '__tests__' && entry !== 'node_modules') stack.push(full);
          continue;
        }
        if (!entry.endsWith('.ts') || entry.endsWith('.test.ts') || entry.endsWith('.ptytest.ts')) {
          continue;
        }
        const content = readFileSync(full, 'utf8');
        for (const m of content.matchAll(
          /export (?:declare )?(?:interface|type|class|enum) (\w+)/g,
        )) {
          declared.add(m[1]);
        }
      }
    }
    declaredCache.set(cacheKey, declared);
  }
  return declaredCache.get(cacheKey).has(typeName);
}

function main() {
  const { findings, examined } = findBarrelParameterTypeFindings(process.cwd());
  if (findings.length > 0) {
    console.error(`barrel-parameter-types failed: ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- [${finding.rule}] ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  console.log(`::examined:: ${examined} barrels`);
  console.log(`barrel-parameter-types passed (${examined} barrel(s) examined).`);
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) main();
