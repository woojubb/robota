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
 * `{ functions, exportedNames, reexports }` for one barrel file.
 *
 * `functions` covers both shapes a barrel publishes a function in: declared with `export function`
 * here, and named in an `export { … } from './x.js'` specifier — the second is how the real defect
 * arrived, so a walk that saw only the first would have missed it.
 */
export function readBarrel(content, fileName) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const functions = [];
  const exportedNames = new Set();
  const reexports = [];

  const visit = (node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text) {
      const exported = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported) {
        exportedNames.add(node.name.text);
        functions.push({ name: node.name.text, node });
      }
    }
    if (ts.isInterfaceDeclaration(node) || ts.isTypeAliasDeclaration(node)) {
      const exported = (node.modifiers ?? []).some((m) => m.kind === ts.SyntaxKind.ExportKeyword);
      if (exported && node.name?.text) exportedNames.add(node.name.text);
    }
    if (ts.isExportDeclaration(node)) {
      const module = node.moduleSpecifier?.text;
      for (const element of node.exportClause?.elements ?? []) {
        const local = element.name?.text;
        const original = element.propertyName?.text ?? local;
        if (!local) continue;
        exportedNames.add(local);
        if (module) reexports.push({ local, original, module });
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);

  return { functions, exportedNames, reexports };
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

  for (const barrel of barrels) {
    const content = readFileSync(join(root, barrel), 'utf8');
    const { functions, exportedNames, reexports } = readBarrel(content, barrel);
    examinedBarrels += 1;

    // Functions the barrel publishes by re-export: read them where they are declared.
    const collected = [...functions];
    for (const entry of reexports) {
      const target = resolveModule(barrel, entry.module, root);
      if (!target) continue;
      const targetContent = readFileSync(join(root, target), 'utf8');
      const inner = readBarrel(targetContent, target);
      const match = inner.functions.find((f) => f.name === entry.original);
      if (match) collected.push({ name: entry.local, node: match.node, declaredIn: target });
      // A function re-exported through a nested barrel is followed one more hop, which is how the
      // real instance was shaped (`index.ts` → `subagents/index.ts` → `execution-root.ts`).
      else {
        for (const nested of inner.reexports) {
          if (nested.local !== entry.original) continue;
          const nestedTarget = resolveModule(target, nested.module, root);
          if (!nestedTarget) continue;
          const nestedInner = readBarrel(
            readFileSync(join(root, nestedTarget), 'utf8'),
            nestedTarget,
          );
          const nestedMatch = nestedInner.functions.find((f) => f.name === nested.original);
          if (nestedMatch) {
            collected.push({ name: entry.local, node: nestedMatch.node, declaredIn: nestedTarget });
          }
        }
      }
    }

    for (const fn of collected) {
      for (const typeName of parameterTypeNames(fn.node)) {
        if (AMBIENT_TYPES.has(typeName)) continue;
        if (exportedNames.has(typeName)) continue;
        // Only types DECLARED in this package are the barrel's to publish. One owned by another
        // package is nameable from there, and re-exporting it is the pass-through STRUCT-07 bans.
        if (!declaredInPackage(root, barrel, typeName)) continue;
        findings.push({
          rule: 'barrel-parameter-type-unexported',
          detail:
            `${barrel}: \`${fn.name}\` is exported but its parameter type \`${typeName}\` is not. ` +
            `A consumer of the function cannot name what it must pass, so they reverse-engineer the ` +
            `shape or cast into it — which is the defect ARCH-025 fixed for \`IScheduleEditPatch\` ` +
            `and ARCH-037 found again on \`subagentExecutionRoot\`. Export it from this barrel.`,
        });
      }
    }
  }

  return { findings, examined: examinedBarrels };
}

/** Whether `typeName` is declared anywhere in the barrel's own package `src`. */
function declaredInPackage(root, barrel, typeName) {
  const packageSrc = barrel.slice(0, barrel.indexOf('/src/') + 5);
  if (!packageSrc) return false;
  const pattern = new RegExp(`export (interface|type) ${typeName}\\b`);
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
      if (!entry.endsWith('.ts')) continue;
      if (pattern.test(readFileSync(full, 'utf8'))) return true;
    }
  }
  return false;
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
