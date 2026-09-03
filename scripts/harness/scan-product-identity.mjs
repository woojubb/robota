#!/usr/bin/env node

/**
 * A library must not name its consumer's product.
 *
 * WHY THIS EXISTS, measured (NEUT-009). Four library packages write `robota`'s own directory names,
 * config file names, default agent name and model-facing command text — **94 occurrences** when
 * counted, none of them covered by any neutrality scan. `scan-composition-neutrality` is about a different property
 * (the assembler's purity) and covers `agent-product` and `agent-capability-pack`; the packages where
 * the problem lives were read by nothing.
 *
 * A second product built on these libraries inherits `~/.robota/`, `.robota/settings.json`, a default
 * agent named `robota-cli`, and text telling its users to run `/provider`. Mostly that is loud on
 * adoption. One instance was an outright bug — `diagnose` built the settings path from
 * `process.env['HOME'] ?? ''`, which on Windows is unset, so the command whose job is reporting which
 * configuration is in effect reported a relative path resolved against the working directory.
 *
 * A RATCHET, NOT A BAN. 94 occurrences cannot be removed in one change, and a ban would be suppressed
 * rather than obeyed. The count per package is frozen: it may fall and must never rise, so every new
 * product name in a library is a deliberate, visible decision. Two packages sit at zero and are
 * protected outright by the same rule — `agent-tools` reached it in this change by renaming a temp
 * file marker that carried the product's name onto every file it wrote.
 *
 * TEXT, NOT SYNTAX, DELIBERATELY. A product name in a COMMENT counts. `paths.ts` opens with "All CLI
 * runtime data lives under .robota/", which teaches the next reader that this library owns the
 * product's layout — the documentation is the invariant here, not an aside about it. Counting only
 * string literals would make the docstring the cheapest place to keep the coupling.
 *
 * WHAT IT CANNOT DO, stated so a pass is not over-read:
 *
 * - It counts NAMES, not coupling. A library that receives its config root through a port and then
 *   names it `robotaRoot` scores zero and is no more neutral. Falling to zero is evidence, not proof.
 * - Tests are excluded. A test may name the product it is testing.
 * - The marker list is data (`.agents/harness.config.json` → `productIdentity`), so this is portable;
 *   it also means a product name nobody listed is invisible.
 *
 * FAIL-CLOSED: every configured package's `src/` must exist. A configured package that has moved or
 * been renamed is a stale config, and a stale config that reports a pass is the defect this scan is
 * about, one level up.
 *
 * Exit code 0 = no package exceeds its frozen count, 1 = one did, or the count fell without being
 * re-frozen.
 */
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { loadHarnessConfig } from './harness-config.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/product-identity-baseline.json');

function sourceFiles(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === '__tests__') {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(entry.name) && !/\.(test|spec)\.tsx?$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

/**
 * How many configured packages the last walk iterated — HARNESS-057. A module-level holder, set in
 * the walk itself so a duplicated config entry is counted as the extra iteration it really is.
 */
let examinedPackages = 0;

/** What the last `findProductIdentity` run actually walked — exported so it can be asserted. */
export function examinedPackageCount() {
  return examinedPackages;
}

/** Occurrences of each marker in a file's text, with the lines they sit on. */
export function countMarkers(source, markers) {
  const hits = [];
  const lines = source.split('\n');
  for (let index = 0; index < lines.length; index += 1) {
    for (const marker of markers) {
      let from = 0;
      for (;;) {
        const at = lines[index].indexOf(marker, from);
        if (at === -1) break;
        hits.push({ marker, line: index + 1 });
        from = at + marker.length;
      }
    }
  }
  return hits;
}

/** Per-package occurrence counts, plus the first few sites so a finding can name them. */
export function findProductIdentity(root, config = liveConfig()) {
  const markers = config.markers ?? [];
  const counts = {};
  const sites = {};
  if (markers.length === 0) return { counts, sites };

  // Overlapping markers double-count: `.robota` is a substring of `~/.robota`, so every line with the
  // latter scored two "product name" occurrences for one mention, and the frozen numbers were
  // inflated. Caught in review. The monotonicity of the ratchet survived it, but the count is the
  // thing this scan reports, so an inflated one is a wrong answer.
  //
  // Compared by INDEX, not by value. The first version tested `other !== marker`, which let an
  // exactly-duplicated marker through — the same list is searched twice and every occurrence doubles.
  // Also caught in review, in the change that added the check: a guard against duplication with a
  // hole for the most literal kind of duplication.
  const overlapping = markers.filter((marker, index) =>
    markers.some((other, otherIndex) => otherIndex !== index && other.includes(marker)),
  );
  if (overlapping.length > 0) {
    throw new Error(
      `product-identity: markers overlap (${[...new Set(overlapping)].join(', ')}) — every line ` +
        'matching more than one would be counted once per match, so the frozen numbers would not ' +
        'mean what they say.',
    );
  }

  examinedPackages = 0;
  for (const relative of config.packages ?? []) {
    // Counted at the WALK, not from `counts` afterwards. `counts` is keyed by path, so a duplicated
    // entry in the config would collapse into one key and the reported size would silently
    // undercount what was actually iterated — "the number must come from the walk", the same
    // invariant this PR fixed for conflict-markers and then repeated here in a subtler form.
    // (#1684 review)
    examinedPackages++;
    const src = path.join(root, relative, 'src');
    if (!existsSync(src)) {
      // Fail closed: a configured package that moved is a stale config, and a stale config reporting
      // a pass is exactly the shape this scan exists to catch.
      throw new Error(
        `product-identity: ${relative}/src does not exist under ${root} — the configured package could not be read.`,
      );
    }
    let total = 0;
    const found = [];
    for (const file of sourceFiles(src)) {
      for (const hit of countMarkers(readFileSync(file, 'utf8'), markers)) {
        total += 1;
        if (found.length < 3) found.push(`${path.relative(root, file)}:${hit.line}`);
      }
    }
    counts[relative] = total;
    sites[relative] = found;
  }
  return { counts, sites };
}

function liveConfig() {
  return loadHarnessConfig().productIdentity ?? {};
}

function loadBaseline() {
  return existsSync(BASELINE_PATH) ? JSON.parse(readFileSync(BASELINE_PATH, 'utf8')) : {};
}

function main() {
  const settings = liveConfig();
  if ((settings.packages ?? []).length === 0 || (settings.markers ?? []).length === 0) {
    // FAIL, not a quiet pass. Review pointed out that this scan exempted itself from the very rule
    // the guard-scope floor in the same change enforces on every other guard: "nothing to check" is
    // not "clean". An emptied config is how a floor disappears without anyone noticing.
    console.error(
      'product-identity: NO PACKAGES OR MARKERS CONFIGURED (.agents/harness.config.json) — nothing ' +
        'was checked, which is a broken floor rather than a clean tree.',
    );
    process.exitCode = 1;
    return;
  }

  const { counts, sites } = findProductIdentity(WORKSPACE_ROOT, settings);
  const baseline = loadBaseline();
  const grown = [];
  const shrunk = [];

  for (const [name, count] of Object.entries(counts)) {
    const frozen = baseline[name];
    if (frozen === undefined) {
      grown.push(`${name}: ${count} occurrence(s) with no frozen count — run --write-baseline`);
      continue;
    }
    if (count > frozen) {
      grown.push(
        `${name}: ${count} product-identity occurrence(s), up from a frozen ${frozen}` +
          `${sites[name].length > 0 ? ` (e.g. ${sites[name].join(', ')})` : ''}. A library that ` +
          "names its consumer's product hands every other product that name too — take the value " +
          'from the host instead of writing it here.',
      );
    } else if (count < frozen) {
      shrunk.push(`${name}: ${frozen} → ${count}`);
    }
  }

  if (grown.length > 0) {
    console.error(`product-identity ratchet failed: ${grown.length} finding(s):`);
    for (const line of grown) console.error(`- [product-identity-grew] ${line}`);
    process.exitCode = 1;
    return;
  }
  if (shrunk.length > 0) {
    console.error(
      `product-identity: the count FELL (${shrunk.join(', ')}). Re-freeze it in the SAME change — ` +
        '`node scripts/harness/scan-product-identity.mjs --write-baseline` — or the gain is a ' +
        'licence to grow back.',
    );
    process.exitCode = 1;
    return;
  }

  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  // HARNESS-057: the subject is the LIBRARY PACKAGES walked, not the occurrences found inside them —
  // a tree with zero occurrences is this ratchet's goal state, while zero packages means the walk
  // found nothing to look at. Declaring the occurrence count would report success as the subject
  // shrinks toward the goal, which is the reading this marker exists to prevent.
  // No expected-empty branch: `main` returns early when the configured package list is empty, and
  // every remaining package either lands in `counts` or throws for a missing `src`, so zero cannot
  // reach this line. A branch for it would be dead code claiming a state the scan cannot be in.
  // (#1684 review)
  console.log(`::examined:: ${examinedPackageCount()} library packages`);
  console.log(
    `product-identity ratchet passed (${Object.keys(counts).length} library package(s), ` +
      `${total} occurrence(s) at baseline).`,
  );
}

function writeBaseline() {
  const settings = liveConfig();
  // The same guard `main()` applies. Without it an emptied config writes `{}` and the floor is gone
  // until the next run notices — self-correcting, but a scan whose whole subject is guards with holes
  // should not ship one.
  if ((settings.packages ?? []).length === 0 || (settings.markers ?? []).length === 0) {
    console.error(
      'product-identity: refusing to freeze a baseline from an empty configuration — that would ' +
        'record "nothing to check" as the floor.',
    );
    process.exitCode = 1;
    return;
  }
  const { counts } = findProductIdentity(WORKSPACE_ROOT, settings);
  writeFileSync(BASELINE_PATH, `${JSON.stringify(counts, null, 2)}\n`);
  console.log(`product-identity baseline regenerated: ${JSON.stringify(counts)}`);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  if (process.argv.includes('--write-baseline')) writeBaseline();
  else main();
}
