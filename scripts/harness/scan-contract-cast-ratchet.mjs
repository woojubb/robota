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
 * responsibilities, and is cast to **51 times across 33 files in 8 packages** (ARCH-012). A published
 * conformant double already exists — `createTestInteractiveSession` in `@robota-sdk/agent-framework`
 * — and has **zero consumers**: every one of those 51 sites hand-rolled its own partial instead.
 * Replacing them is a large refactor, and this scan is what stops the number growing while that work
 * is designed.
 *
 * A RATCHET, NOT A BAN. The count may fall and must never rise. Banning outright would be
 * unlandable today and would be suppressed rather than obeyed; freezing the number makes every new
 * cast a deliberate, visible decision instead of a default.
 *
 * NEUTRAL BY CONSTRUCTION: the contracts it watches are data in `.agents/harness.config.json` →
 * `contractCastRatchet`, so another repository names its own and changes no code here.
 *
 * WHAT IT CANNOT DO: it counts textual casts. A double built without the words `as unknown as`
 * — assigned through a helper, or via a typed factory — is invisible to it. A falling number is
 * therefore evidence the debt is shrinking, not proof that it has.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

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
 * Blank out comments and string literals so the count measures CODE.
 *
 * A comment that describes the pattern — "the partial this replaces was `as unknown as IFoo`" — is
 * not a cast, and counting it means the ratchet blocks on prose. Found the honest way: the commit
 * that removed two casts left the number unchanged, because the comments explaining the removal
 * mentioned them.
 *
 * Length-preserving, so reported line numbers stay true to the file.
 */
function codeOnly(source) {
  let out = '';
  let i = 0;
  while (i < source.length) {
    const two = source.slice(i, i + 2);
    if (two === '//') {
      const end = source.indexOf('\n', i);
      const stop = end === -1 ? source.length : end;
      out += ' '.repeat(stop - i);
      i = stop;
      continue;
    }
    if (two === '/*') {
      const end = source.indexOf('*/', i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, ' ');
      i = stop;
      continue;
    }
    const ch = source[i];
    if (ch === "'" || ch === '"' || ch === '`') {
      let j = i + 1;
      while (j < source.length && !(source[j] === ch && source[j - 1] !== '\\')) j += 1;
      out += source.slice(i, j + 1).replace(/[^\n]/g, ' ');
      i = j + 1;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** Count `as (unknown as )?<Contract>` occurrences per contract, and the files carrying them. */
export function countContractCasts(files, contracts, readFile = (f) => readFileSync(f, 'utf8')) {
  const counts = new Map(contracts.map((name) => [name, { casts: 0, files: new Set() }]));
  for (const file of files) {
    const source = codeOnly(readFile(file));
    for (const name of contracts) {
      const pattern = new RegExp(`\\bas\\s+(?:unknown\\s+as\\s+)?${name}\\b(?![\\w$['.])`, 'g');
      const found = source.match(pattern);
      if (!found) continue;
      const entry = counts.get(name);
      entry.casts += found.length;
      entry.files.add(file);
    }
  }
  return counts;
}

function main() {
  const contracts = loadHarnessConfig().contractCastRatchet ?? [];
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
  const contracts = loadHarnessConfig().contractCastRatchet ?? [];
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
