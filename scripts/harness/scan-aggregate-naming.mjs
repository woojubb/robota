#!/usr/bin/env node

/**
 * ARCH-029: a command must name the roles it needs, not the aggregate.
 *
 * ## The class
 *
 * A "god contract" is not fixed by decomposing it. It is fixed when the CONSUMERS stop naming the
 * aggregate — and those are two different events, separated by every declaration in the repo.
 *
 * This repo has the controlled experiment. REFACTOR-006 (2026-05) was filed against the same
 * contract, closed on removing a cast, and a production `as unknown as ICommandHostContext` landed
 * **the next day**. The contract went 20 members / 50% optional at filing to 46 / 70% today. Every
 * criterion in that attempt could be — and was — ticked while the facade survived untouched,
 * because nothing measured the quantity that was actually growing: how many places name it.
 *
 * So this is the floor ARCH-029 marks load-bearing. Its own acceptance criterion says it plainly:
 * *"the decomposition is not real until this falls"*. A criterion of "frozen and falling" was
 * written into an earlier revision of that document and rejected there, because it would close the
 * design green with 127 of 128 declarations still naming the 46-member facade — which is precisely
 * what REFACTOR-006 shipped.
 *
 * ## What counts
 *
 * A **type-position reference**: any `TypeReferenceNode` naming a guarded aggregate. That is the
 * broad definition the criterion asks for, and it is deliberately broader than the `: IAggregate`
 * grep that produced the design's first estimate — it also catches `Partial<I>`, `Pick<I, …>`,
 * indexed access (`I['getContextState']`), function-return position (`() => I`), array and union
 * members, and type arguments to any generic.
 *
 * An `import type { I }` specifier is NOT a reference: it names nothing in a type position, and a
 * file that imports without referencing has an unused import its linter already owns. Counting the
 * import as well would double-count every honest site and make the number mean two things.
 *
 * ## The allowlist is per-file AND named
 *
 * Three places must keep naming the aggregate, and each is a place where naming it is the point:
 * its own declaration, the dispatch contract every command is assigned to, the production host that
 * implements it, and the conformant double that stands in for it. They are listed by path in the
 * harness config with a reason each, so an addition is a visible config change and not a silent
 * regex loosening.
 *
 * ## Why the baseline comes from this scan and not from a grep
 *
 * The number this freezes must be the number this measures. The design's estimate of 128 was taken
 * with a narrower pattern than the criterion states, and its own text flags the gap ("roughly 6
 * more"). Taking the baseline from anything but this scan's own definition would freeze one
 * quantity while checking another — the shape of a floor that cannot fail.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { requireGovernedTree } from './governed-tree.mjs';
import * as ts from './lib/ts-ast.mjs';

const BASELINE_FILE = 'scripts/harness/aggregate-naming-baseline.json';

/**
 * What the last `collectAggregateNaming` walk actually read. Exported so a test asserts the same
 * number the scan prints (measurement-provenance.md) — a size only the scan itself reports is one
 * nothing can contradict, and "examined 0 files" then reads exactly like a clean repository.
 *
 * Reset at the start of every run, so asserting it twice over one fixture distinguishes an
 * accumulating counter from a growing subject.
 */
let examinedFiles = 0;

export function examinedFileCount() {
  return examinedFiles;
}

/**
 * Every type-position reference to one of `aggregates` in `content`.
 *
 * Read from the AST rather than a regex for the reason the sibling scan records in its own header:
 * a regex over `: IAggregate` sees neither `Partial<IAggregate>` nor `() => IAggregate`, and sees
 * prose in a docblock that explains why a file must not name it. This file's own header names the
 * guarded aggregate repeatedly; a text scan would flag itself.
 */
export function findAggregateReferences(content, fileName, aggregates) {
  const sourceFile = ts.createSourceFile(fileName, content);
  const found = [];

  // An ALIASED import renames the aggregate locally, and every later reference then uses a name this
  // scan was not looking for. The header's reason for skipping import specifiers — "it names nothing
  // in a type position" — holds only for the un-aliased form, where a real reference always
  // accompanies it. Under an alias the specifier is the ONLY place the guarded name appears, so
  // skipping it hides the whole file. Found by review, reproduced before being fixed:
  // `import type { ICommandHostContext as IHost } …` plus `interface IMine extends IHost {}` left
  // the ratchet at 0. Not hypothetical here — this document's own GATE-WRITE evidence records an
  // aliased import of this very symbol.
  const aliasOf = new Map();
  const canonical = (name) => aliasOf.get(name) ?? name;
  const local = new Set(aggregates);
  const collectAliases = (node) => {
    if (ts.isImportDeclaration(node)) {
      for (const element of node.importClause?.namedBindings?.elements ?? []) {
        const imported = element.propertyName?.text;
        if (imported && aggregates.includes(imported) && element.name?.text) {
          local.add(element.name.text);
          aliasOf.set(element.name.text, imported);
        }
      }
    }
    ts.forEachChild(node, collectAliases);
  };
  collectAliases(sourceFile);
  const guarded = [...local];

  const note = (name, node) => {
    if (!name || !guarded.includes(name)) return;
    const { line } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
    found.push({ aggregate: aggregates.includes(name) ? name : canonical(name), line: line + 1 });
  };

  const visit = (node) => {
    // A HERITAGE clause is not a TypeReferenceNode — `interface IMyHost extends ICommandHostContext {}`
    // and `class C implements ICommandHostContext` parse as `ExpressionWithTypeArguments`. Missing
    // this was the worst possible hole in this particular floor: re-aliasing the entire 46-member
    // surface takes ONE line, the aggregate keeps being named through the alias everywhere, and the
    // count stays at zero forever. Found by review after the scan shipped, and reproduced before
    // being fixed: adding `export interface IMyHost extends ICommandHostContext {}` to a consumer
    // left the ratchet reporting `0 reference(s)`.
    for (const clause of node.heritageClauses ?? []) {
      for (const type of clause.types ?? []) {
        let expr = type.expression;
        while (expr && ts.isPropertyAccessExpression(expr)) expr = expr.name;
        note(expr?.text, type);
      }
    }
    if (ts.isTypeReferenceNode(node)) {
      // `A.B.ICommandHostContext` resolves through a qualified name; the tail is the symbol.
      let name = node.typeName;
      while (name && ts.isQualifiedName(name)) name = name.right;
      note(name && ts.isIdentifier(name) ? name.text : undefined, node);
    }
    ts.forEachChild(node, visit);
  };

  visit(sourceFile);
  return found;
}

function trackedSources(root) {
  const out = execFileSync('git', ['ls-files', 'packages', 'apps'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  });
  return out
    .split('\n')
    .filter((f) => f.endsWith('.ts') || f.endsWith('.tsx') || f.endsWith('.mts'));
}

/**
 * `examined` is an OUTPUT of this scan, so it is injectable and asserted exactly rather than
 * self-reported (measurement-provenance.md): a count nothing checks is how "examined 0 files"
 * reads as a clean repository.
 */
export function collectAggregateNaming(
  root = process.cwd(),
  config = loadHarnessConfig(root),
  files = trackedSources(root),
) {
  // Fail CLOSED here too, not only in the findings wrapper. This function is exported and takes a
  // root, so it is callable on its own — and on a root without the governed tree it would count 0
  // references, which reads exactly like a finished decomposition.
  requireGovernedTree(root, ['packages'], { scan: 'aggregate-naming' });
  const settings = config.aggregateNaming ?? {};
  const aggregates = settings.aggregates ?? [];
  const allowlist = new Set((settings.allowlist ?? []).map((entry) => entry.file));

  const counts = new Map(aggregates.map((name) => [name, { references: 0, files: new Map() }]));
  let examined = 0;
  examinedFiles = 0;

  for (const file of files) {
    if (allowlist.has(file)) continue;
    const content = readFileSync(join(root, file), 'utf8');
    examined += 1;
    examinedFiles += 1;
    // A cheap reject before the RPC parse: most files never mention any aggregate at all.
    if (!aggregates.some((name) => content.includes(name))) continue;
    for (const hit of findAggregateReferences(content, file, aggregates)) {
      const bucket = counts.get(hit.aggregate);
      bucket.references += 1;
      bucket.files.set(file, (bucket.files.get(file) ?? 0) + 1);
    }
  }

  return { counts, examined };
}

export function findAggregateNamingFindings(root = process.cwd()) {
  const config = loadHarnessConfig(root);
  const settings = config.aggregateNaming ?? {};
  const aggregates = settings.aggregates ?? [];
  if (aggregates.length === 0) return { findings: [], examined: 0, counts: new Map() };

  // Fail CLOSED over a root without the governed tree: a scan that reported "no findings" for a
  // tree it never read is indistinguishable from a clean repo, and this is the floor the design
  // marks load-bearing.
  const { counts, examined } = collectAggregateNaming(root, config);

  let baseline = {};
  try {
    baseline = JSON.parse(readFileSync(resolve(root, BASELINE_FILE), 'utf8'));
  } catch {
    baseline = {};
  }

  const findings = [];
  for (const [aggregate, bucket] of counts) {
    const frozen = baseline[aggregate];
    if (frozen === undefined) {
      findings.push({
        rule: 'aggregate-naming-unfrozen',
        aggregate,
        detail: `${aggregate}: ${bucket.references} type-position reference(s) with no frozen baseline — run --write-baseline`,
      });
      continue;
    }
    if (bucket.references > frozen) {
      const worst = [...bucket.files.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
      findings.push({
        rule: 'aggregate-naming-grew',
        aggregate,
        detail:
          `${aggregate}: ${bucket.references} type-position reference(s) across ${bucket.files.size} file(s), up from a frozen ${frozen}. ` +
          `A consumer that names the aggregate takes the whole surface instead of the role it uses — declare the role port it needs. ` +
          `Most references: ${worst.map(([f, n]) => `${f} (${n})`).join(', ')}`,
      });
    }
  }
  return { findings, examined, counts };
}

function main() {
  const root = process.cwd();
  if (process.argv.includes('--write-baseline')) {
    const { counts } = collectAggregateNaming(root);
    const next = Object.fromEntries([...counts].map(([name, b]) => [name, b.references]));
    writeFileSync(resolve(root, BASELINE_FILE), `${JSON.stringify(next, null, 2)}\n`, 'utf8');
    console.log(`aggregate-naming baseline regenerated: ${JSON.stringify(next)}`);
    return;
  }

  const { findings, examined, counts } = findAggregateNamingFindings(root);
  if (findings.length > 0) {
    console.error(`aggregate-naming failed: ${findings.length} finding(s):`);
    for (const finding of findings) console.error(`- [${finding.rule}] ${finding.detail}`);
    process.exitCode = 1;
    return;
  }
  const total = [...counts.values()].reduce((sum, b) => sum + b.references, 0);
  console.log(`::examined:: ${examined} files`);
  console.log(
    `aggregate-naming passed (${counts.size} aggregate(s), ${total} reference(s) at baseline, ${examined} file(s) examined).`,
  );
}

if (resolve(process.argv[1] ?? '') === resolve(import.meta.filename)) main();
