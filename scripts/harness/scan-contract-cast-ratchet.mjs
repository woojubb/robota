#!/usr/bin/env node

/**
 * A cast to a contract is a claim the compiler was told not to check.
 *
 * `as unknown as IFoo` says "trust me, this is an IFoo" about an object that demonstrably is not one
 * — otherwise the cast would be unnecessary. Where a contract collects dozens of these, they are not
 * a style problem: each one is a private, partial re-implementation of the contract that nothing
 * checks against the real thing, so a test suite built on them proves properties no shipped code
 * guarantees.
 *
 * WHY THIS EXISTS, measured. `IInteractiveSession` carries 40+ members across nine unrelated
 * responsibilities. Before ARCH-012 it was cast to **41 times across 29 files**, and a published
 * conformant double existed the whole time — in `@robota-sdk/agent-framework`, which every transport
 * package sits BELOW, so none of them could import it. The partials were not an oversight; they were
 * the only thing those packages could reach. The double now lives at
 * `@robota-sdk/agent-interface-transport/testing`, beside the contract, and the count is 37.
 *
 * (The audit that raised this reported 51/33. That came from `rg 'as IInteractiveSession'`, which
 * also matches `as IInteractiveSessionEvents[...]` and `as IInteractiveSessionStandardOptions` —
 * casts to different types. Recorded because a baseline whose provenance nobody can explain is a
 * number, not a ratchet.)
 *
 * A RATCHET, NOT A BAN. The count may fall and must never rise. Banning outright would be
 * unlandable today and would be suppressed rather than obeyed; freezing the number makes every new
 * cast a deliberate, visible decision instead of a default.
 *
 * NEUTRAL BY CONSTRUCTION: the contracts it watches are data in `.agents/harness.config.json` →
 * `contractCastRatchet`, so another repository names its own and changes no code here.
 *
 * WHAT IT CANNOT DO: it counts `as` expressions. A double built without one — assigned through a
 * helper, or via a typed factory that lies — is invisible to it. A falling number is evidence the
 * debt is shrinking, not proof that it has.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  ScriptTarget,
  SyntaxKind,
  createSourceFile,
  forEachChild,
  isAsExpression,
  isTypeReferenceNode,
} from './lib/ts-ast.mjs';

import { loadHarnessConfig } from './harness-config.mjs';

const BASELINE_PATH = path.join(process.cwd(), 'scripts/harness/contract-cast-baseline.json');

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * Count casts by PARSING, not by matching text.
 *
 * The first version blanked comments and strings with a hand-rolled scanner and then ran a regex.
 * Review measured three ways it read the file wrong, all of them SILENT UNDER-COUNTS: a string ending
 * in a backslash (`'C:\\'`) swallowed the rest of the file, an apostrophe inside a regex literal
 * (`/'/g`) opened a string that never closed, and a cast inside a template `${…}` was blanked away.
 * An under-count matters more than an over-count here: the scan treats a FALL as something to
 * re-freeze, so a wrong low number gets frozen and the ratchet goes blind by exactly that many casts.
 *
 * A real parser has no such ambiguities — the repo's native-AST adapter (`lib/ts-ast.mjs`), not the
 * legacy `typescript` package, which PERF-005 bans from first-party code. `as X` is an `AsExpression`; the type it names is
 * a `TypeReference`, so `as IFoo['bar']` (an `IndexedAccessType`) and `as IFooEvents` are excluded by
 * the shape of the tree rather than by a lookahead. `as unknown as IFoo` nests, and only the outer
 * one names the contract. Comments and strings are not expressions and never reach the walk.
 */
function countCastsInSource(source, fileName, contracts, tally) {
  const ast = createSourceFile(fileName, source, ScriptTarget.Latest, true);

  /** The contract this cast names, or undefined for anything else. */
  const contractOf = (typeNode) => {
    // `as IFoo & { … }` — an intersection whose first member is the contract still stands in for it.
    // An intersection whose first member is the contract still stands in for it. Matched by kind
    // rather than a guard, because the adapter's guard set does not carry one for it.
    if (typeNode.kind === SyntaxKind.IntersectionType) return contractOf(typeNode.types[0]);
    if (!isTypeReferenceNode(typeNode)) return undefined;
    const name = typeNode.typeName.getText(ast);
    return contracts.includes(name) ? name : undefined;
  };

  const visit = (node) => {
    if (isAsExpression(node)) {
      const name = contractOf(node.type);
      if (name !== undefined) {
        const entry = tally.get(name);
        entry.casts += 1;
        entry.files.add(fileName);
      }
    }
    forEachChild(node, visit);
  };
  visit(ast);
}

/** Count `as <Contract>` casts per contract, and the files carrying them. */
export function countContractCasts(files, contracts, readFile = (f) => readFileSync(f, 'utf8')) {
  const counts = new Map(contracts.map((name) => [name, { casts: 0, files: new Set() }]));
  for (const file of files) {
    const source = readFile(file);
    // A cheap reject before parsing: most files never mention the contract at all.
    if (!contracts.some((name) => source.includes(name))) continue;
    countCastsInSource(source, file, contracts, counts);
  }
  return counts;
}

function main() {
  const contracts = loadHarnessConfig().contractCastRatchet?.contracts ?? [];
  if (contracts.length === 0) {
    console.log(
      'contract-cast ratchet: NO CONTRACTS CONFIGURED (.agents/harness.config.json) — nothing was checked.',
    );
    return;
  }

  const roots = ['packages', 'apps', 'scripts'].filter((dir) => existsSync(dir));
  if (roots.length === 0) {
    // Fail closed: reporting "no casts" from a tree with no source in it would be a pass over
    // ground never examined.
    console.error('contract-cast ratchet: no source roots found — nothing could be examined.');
    process.exitCode = 1;
    return;
  }
  const files = roots.flatMap((dir) => sourceFiles(dir));
  const counts = countContractCasts(files, contracts);
  const baseline = existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};

  const grown = [];
  const shrunk = [];
  for (const [name, { casts, files: touched }] of counts) {
    const frozen = baseline[name];
    if (frozen === undefined) {
      grown.push(`${name}: ${casts} cast(s) with no frozen baseline — run --write-baseline`);
      continue;
    }
    if (casts > frozen) {
      grown.push(
        `${name}: ${casts} cast(s) across ${touched.size} file(s), up from a frozen ${frozen}. ` +
          'A cast to this contract is a partial re-implementation nothing checks against the real ' +
          'one — use the published conformant double instead of adding another.',
      );
    } else if (casts < frozen) {
      shrunk.push(`${name}: ${frozen} → ${casts}`);
    }
  }

  if (grown.length > 0) {
    console.error(`contract-cast ratchet failed: ${grown.length} finding(s):`);
    for (const line of grown) console.error(`- [contract-cast-grew] ${line}`);
    process.exitCode = 1;
    return;
  }
  if (shrunk.length > 0) {
    console.error(
      `contract-cast ratchet: the count FELL (${shrunk.join(', ')}). Re-freeze it in the SAME ` +
        'change — `node scripts/harness/scan-contract-cast-ratchet.mjs --write-baseline` — or the ' +
        'gain is a licence to grow back to the old number.',
    );
    process.exitCode = 1;
    return;
  }
  const total = [...counts.values()].reduce((sum, entry) => sum + entry.casts, 0);
  console.log(
    `contract-cast ratchet passed (${contracts.length} contract(s), ${total} cast(s) at baseline, ` +
      `${files.length} file(s) examined).`,
  );
}

function writeBaseline() {
  const contracts = loadHarnessConfig().contractCastRatchet?.contracts ?? [];
  const roots = ['packages', 'apps', 'scripts'].filter((dir) => existsSync(dir));
  const counts = countContractCasts(
    roots.flatMap((dir) => sourceFiles(dir)),
    contracts,
  );
  const next = Object.fromEntries([...counts].map(([name, entry]) => [name, entry.casts]));
  writeFileSync(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`);
  console.log(`contract-cast baseline regenerated: ${JSON.stringify(next)}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
