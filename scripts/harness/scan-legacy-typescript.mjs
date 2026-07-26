#!/usr/bin/env node

/**
 * PERF-005 — the mechanical floor that keeps the legacy TypeScript compiler OUT of first-party code.
 *
 * PERF-004 switched `typecheck` to the native compiler; PERF-005 phase 1 moved the last first-party
 * consumers off `typescript@5.x` — four AST scans (now behind `scripts/harness/lib/ts-ast.mjs`) and
 * `apps/action`'s build. After that work, NOTHING this repo owns depends on the legacy compiler.
 * Only the ESLint toolchain does, and phase 2 (removing the package outright) is gated on upstream.
 *
 * The package therefore STAYS INSTALLED while producing no first-party consumers — which is exactly
 * the state that rots silently. Nothing stops the next `import ts from 'typescript'` from resolving
 * happily, and re-growing the surface phase 2 is waiting to delete. This scan is what makes that
 * regrowth loud.
 *
 * PERF-006 extended it. The owner's decision on 2026-07-26 is that the repository stops using
 * TypeScript 5 entirely: the native compiler for everything we compile and type-check, and a 6.x
 * line kept ONLY for tools that still need a programmatic compiler API — today just the ESLint
 * toolchain. So the guard no longer asks merely WHETHER a manifest declares the package; it also
 * asks at WHAT VERSION, because a surface frozen at "97 manifests" can still rot back to 5.x one
 * manifest at a time without a single new entry appearing.
 *
 * It reports FIVE finding kinds:
 *
 *  1. `legacy-typescript-import` — a first-party file imports the `typescript` package (static
 *     import, `export … from`, `import x = require()`, dynamic `import()`, or `require()`).
 *     Use `scripts/harness/lib/ts-ast.mjs` instead; it is the one sanctioned swap point.
 *     After phase 1 the repo has ZERO of these, so this edge starts from a clean floor.
 *  2. `legacy-typescript-dependency` — a workspace manifest declares `typescript` in
 *     dependencies/devDependencies/peerDependencies, outside the reasoned root exemption and the
 *     frozen baseline.
 *
 *     Measured while building this guard, and worth stating plainly because PERF-005's own premise
 *     understated it: it is NOT one root devDependency. NINETY-EIGHT further workspace manifests
 *     declare `typescript` too. None of them is a code consumer — phase 1 removed the last import,
 *     and these packages build with `tsdown` (peer admits 7) and typecheck with `tsgo` — but
 *     deleting 98 manifest entries is its own change with its own blast radius, and most of those
 *     files are outside this item's scope. So they are FROZEN as a path ratchet
 *     (`legacy-typescript-baseline.json`), the same shape `check-spec-public-surface` uses: a
 *     manifest not already in the baseline may not start declaring it, and the list may only ever
 *     shrink. That keeps the edge ON at today's boundary instead of trading it for a smaller diff.
 *  3. `legacy-typescript-version` — PERF-006. A manifest declares `typescript` at a range that can
 *     resolve BELOW 6. This edge is deliberately NOT suppressed by the baseline or by the root
 *     exemption: those excuse the dependency's PRESENCE while upstream forces it, not its version.
 *     A baselined manifest silently reverting `^6.0.3` to `^5.9.3` would otherwise be invisible,
 *     which is the exact creep this edge exists to stop.
 *  4. `reasonless-annotation` — anti-rot on the escape hatch: an `allow-legacy-typescript`
 *     annotation with no `: <reason>`. Every suppression must state WHY.
 *  5. `stale-annotation` — anti-rot the other way: an `allow-legacy-typescript: <reason>` that
 *     suppresses nothing. A suppression outliving the thing it excused is how an allowlist quietly
 *     becomes 641 entries long and switches its own gate off (the failure `check-spec-public-surface`
 *     had to be rescued from). Unlike `scan-no-fallback`, stale detection is implemented here rather
 *     than deferred, because the construct this scan matches is exact — an import specifier — so an
 *     annotation that covers no flagged import is unambiguously dead rather than merely inert.
 *
 * THE ONE DECLARED EXEMPTION is the root `package.json` devDependency (see `EXEMPTIONS`).
 * `@typescript-eslint`'s `typescript-estree` imports `typescript` AT RUNTIME, and the native package
 * exposes only `version`/`versionMajorMinor` under that name — so the package must remain installed
 * for `pnpm lint` to work at all. It is a devDependency and ships in nothing. That is a reasoned
 * exemption for a dependency we do not control, NOT a licence for first-party code to import the
 * compiler.
 *
 * THE EXIT CONDITION. `typescript@7.1` is the release Microsoft says will carry the new programmatic
 * API; when typescript-eslint adopts it, the tool-side line disappears and the repository is
 * single-compiler. Re-check typescript-eslint issue #10940 (open, labelled `blocked by external
 * API`) rather than waiting for an announcement — that is the issue that will move.
 *
 * Detection is a token PREFILTER followed by an AST confirmation: only files that mention the word
 * at all are parsed, and the finding is raised from a real module specifier rather than a line
 * match. So `@typescript-eslint/...`, `@typescript/native-preview`, and the word "typescript" in
 * prose or a string do not false-positive — including in this file's own documentation.
 *
 * Exit 0 = clean, 1 = findings.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from './lib/ts-ast.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const BASELINE_PATH = path.join(WORKSPACE_ROOT, 'scripts/harness/legacy-typescript-baseline.json');

/** The frozen set of manifests that already declared the dependency when this guard was adopted. */
export function loadDependencyBaseline(baselinePath = BASELINE_PATH) {
  if (!existsSync(baselinePath)) return [];
  return JSON.parse(readFileSync(baselinePath, 'utf8')).manifests ?? [];
}

/** The legacy compiler package, and its deep import forms (`typescript/lib/…`). */
const LEGACY_PACKAGE = 'typescript';

/**
 * Declared, reasoned exemptions. A manifest path maps to WHY it may still declare the dependency.
 * An exemption that stops being needed is itself a finding — see `unused-exemption` below.
 */
const EXEMPTIONS = new Map([
  [
    'package.json',
    '@typescript-eslint/typescript-estree imports `typescript` at runtime, and under the native ' +
      'package that name exposes only `version`/`versionMajorMinor`, so `pnpm lint` cannot run ' +
      'without a real compiler installed. devDependency only — ships in nothing. Removing it is ' +
      'PERF-005 phase 2, gated on typescript-eslint adopting the 7.1 API (issue #10940).',
  ],
]);

/**
 * PERF-006. The lowest major the `typescript` declaration may resolve to. Below this and the 5.x
 * line is creeping back — the whole point of the item was to stop using TypeScript 5 at all.
 */
const MINIMUM_MAJOR = 6;

/**
 * The lowest major version an npm range can resolve to, or `undefined` when the range is not a form
 * this guard can prove anything about.
 *
 * Deliberately hand-rolled rather than pulling in `semver`: nothing else in `scripts/harness` uses
 * it, it is not a declared dependency of this repo (only a transitive one), and a mechanical gate
 * must not depend on a package that could vanish from the tree on any unrelated lockfile change.
 * The input domain is narrow — ranges WE write in OUR OWN manifests — and every form below is
 * covered by a test.
 *
 * Unrecognised forms return `undefined` and are reported. For a ratchet, "cannot prove it is >= 6"
 * and "is < 6" deserve the same answer; silently passing an unparsed range is how a floor rots.
 */
export function lowestMajorAdmitted(range) {
  if (typeof range !== 'string') return undefined;
  const trimmed = range.trim();
  if (trimmed === '') return undefined;

  // `a || b` admits anything either alternative admits, so the floor is the LOWEST of the two.
  const alternatives = trimmed.split('||');
  let lowest;
  for (const alternative of alternatives) {
    const floor = alternativeFloorMajor(alternative);
    if (floor === undefined) return undefined;
    if (lowest === undefined || floor < lowest) lowest = floor;
  }
  return lowest;
}

/** The lowest major a single comparator set (no `||`) can resolve to, or undefined if unrecognised. */
function alternativeFloorMajor(alternative) {
  const tokens = alternative.trim().split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return undefined;

  // A comparator set with NO lower bound (`*`, `<7`, `x`) starts at 0 — it admits 5.x and below.
  let floor = 0;
  let sawLowerBound = false;
  /** In a hyphen range (`5.0.0 - 6.0.0`) the token AFTER the dash is an upper bound, not a floor. */
  let nextIsUpperBound = false;

  for (const token of tokens) {
    if (token === '-') {
      nextIsUpperBound = true;
      continue;
    }
    if (nextIsUpperBound) {
      nextIsUpperBound = false;
      continue;
    }
    if (token === '*' || token === 'x' || token === 'X') return 0;
    const match = /^(\^|~|>=|>|<=|<|=|v)?\s*(\d+|[xX*])(?:\.\S*)?$/.exec(token);
    if (match === null) return undefined;
    const [, operator = '', majorText] = match;
    if (majorText === 'x' || majorText === 'X' || majorText === '*') return 0;
    const major = Number(majorText);
    if (operator === '<' || operator === '<=') continue; // upper bound; says nothing about the floor.
    // `^`, `~`, `>=`, `>`, `=`, `v` and a bare version all pin the floor at this major.
    sawLowerBound = true;
    if (major > floor) floor = major;
  }
  return sawLowerBound ? floor : 0;
}

/**
 * PERF-006 version edge: the `typescript` declarations in one manifest that can resolve below the
 * minimum major. Pure. Returns `{ section, range, reason }` entries.
 */
export function findBelowMinimumDeclarations(manifest, minimumMajor = MINIMUM_MAJOR) {
  const below = [];
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    const range = manifest?.[section]?.[LEGACY_PACKAGE];
    if (range === undefined) continue;
    const floor = lowestMajorAdmitted(range);
    if (floor === undefined) {
      below.push({ section, range, reason: 'cannot be proven to resolve at or above ' });
    } else if (floor < minimumMajor) {
      below.push({ section, range, reason: 'can resolve below ' });
    }
  }
  return below;
}

/** A well-formed escape hatch: the token followed by `:` and at least one non-space reason char. */
const ANNOTATION = /allow-legacy-typescript/;
const ANNOTATION_WITH_REASON = /allow-legacy-typescript:\s*\S/;

/** Files worth parsing at all — first-party code, by extension. */
const CODE_EXTENSIONS = /\.(mts|cts|mjs|cjs|tsx?|jsx?)$/;

/**
 * This scan and its test necessarily SPELL both the package name and the annotation token — in the
 * documentation above, in `LEGACY_PACKAGE`, and in the regexes. Scanning them would flag the guard
 * itself, so they are excluded. This is the only exclusion, and it is structural rather than a
 * judgement call about any other file.
 */
const SELF = new Set([
  'scripts/harness/scan-legacy-typescript.mjs',
  'scripts/harness/__tests__/scan-legacy-typescript.test.mjs',
]);

/** True for `typescript` and `typescript/lib/…`, false for `@typescript-eslint/…` etc. */
function isLegacyCompilerSpecifier(specifier) {
  return specifier === LEGACY_PACKAGE || specifier.startsWith(`${LEGACY_PACKAGE}/`);
}

/** The compile-time-constant string a node denotes, or undefined. */
function staticString(node) {
  if (node === undefined) return undefined;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  return undefined;
}

/** The module string a node imports, whatever the import form. Mirrors scan-composition-neutrality. */
function moduleSpecifierOf(node) {
  if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
    return staticString(node.moduleSpecifier);
  }
  if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
    return staticString(node.moduleReference.expression);
  }
  if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
    return staticString(node.argument.literal);
  }
  if (ts.isCallExpression(node)) {
    const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
    const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
    if (isDynamicImport || isRequire) return staticString(node.arguments[0]);
  }
  return undefined;
}

/** Every legacy-compiler import in one source string, as `{ line, specifier }`. Pure. */
export function findLegacyImportsInSource(source, file) {
  // Prefilter: parsing every first-party file costs an RPC round-trip each, and only a handful can
  // possibly match. A file that never spells the package cannot import it.
  if (!source.includes(LEGACY_PACKAGE)) return [];

  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const hits = [];
  const visit = (node) => {
    const specifier = moduleSpecifierOf(node);
    if (specifier !== undefined && isLegacyCompilerSpecifier(specifier)) {
      hits.push({
        line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
        specifier,
      });
    }
    ts.forEachChild(node, visit);
  };
  ts.forEachChild(sourceFile, visit);
  return hits;
}

/** Legacy-compiler dependency declarations in one manifest. Pure. */
export function findLegacyDependencies(manifest) {
  const sections = [];
  for (const section of ['dependencies', 'devDependencies', 'peerDependencies']) {
    if (manifest?.[section]?.[LEGACY_PACKAGE] !== undefined) sections.push(section);
  }
  return sections;
}

function gitTrackedFiles(root) {
  return execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8', maxBuffer: 1 << 28 })
    .split('\n')
    .filter(Boolean);
}

export function findLegacyTypeScriptFindings(root = WORKSPACE_ROOT, options = {}) {
  const findings = [];
  const notices = options.notices ?? [];
  const baseline = new Set(options.baseline ?? loadDependencyBaseline());
  const stillDeclaring = new Set();
  const files = gitTrackedFiles(root);
  /** Files that produced at least one real import finding — used for stale-annotation detection. */
  const suppressedFiles = new Set();

  for (const file of files) {
    if (file.includes('/node_modules/') || file.includes('/dist/') || SELF.has(file)) continue;
    const isCode = CODE_EXTENSIONS.test(file);
    const isManifest = path.basename(file) === 'package.json';
    if (!isCode && !isManifest) continue;

    const source = readFileSync(path.join(root, file), 'utf8');
    const lines = source.split('\n');

    if (isCode) {
      for (const hit of findLegacyImportsInSource(source, file)) {
        // Suppressed by an `allow-legacy-typescript: <reason>` on the import line or the one above.
        const window = lines.slice(Math.max(0, hit.line - 2), hit.line).join('\n');
        if (ANNOTATION_WITH_REASON.test(window)) {
          suppressedFiles.add(file);
          continue;
        }
        findings.push({
          file,
          line: hit.line,
          kind: 'legacy-typescript-import',
          text: `imports '${hit.specifier}'`,
        });
      }
    }

    if (isManifest) {
      const manifest = JSON.parse(source);
      const sections = findLegacyDependencies(manifest);
      const exemption = EXEMPTIONS.get(file);
      if (sections.length > 0) {
        stillDeclaring.add(file);
        if (exemption === undefined && !baseline.has(file)) {
          findings.push({
            file,
            line: 1,
            kind: 'legacy-typescript-dependency',
            text:
              `declares '${LEGACY_PACKAGE}' in [${sections.join(', ')}] and is neither the ` +
              `reasoned root exemption nor in the frozen baseline`,
          });
        }
      }
      // PERF-006 version edge. Checked for EVERY manifest — the baseline and the root exemption
      // excuse the dependency's presence while upstream forces it, never its version.
      for (const { section, range, reason } of findBelowMinimumDeclarations(manifest)) {
        findings.push({
          file,
          line: 1,
          kind: 'legacy-typescript-version',
          text:
            `declares '${LEGACY_PACKAGE}': '${range}' in ${section}, which ${reason}` +
            `${MINIMUM_MAJOR} — bump it to a 6.x range (PERF-006)`,
        });
      }
      if (sections.length === 0 && exemption !== undefined) {
        findings.push({
          file,
          line: 1,
          kind: 'unused-exemption',
          text:
            `is listed as a declared '${LEGACY_PACKAGE}' exemption but no longer declares the ` +
            `dependency — drop the exemption from scan-legacy-typescript.mjs (PERF-005 phase 2)`,
        });
      }
    }

    // Anti-rot (3): a reason-less annotation anywhere in a first-party code file.
    if (!isCode) continue;
    for (let i = 0; i < lines.length; i += 1) {
      if (ANNOTATION.test(lines[i]) && !ANNOTATION_WITH_REASON.test(lines[i])) {
        findings.push({
          file,
          line: i + 1,
          kind: 'reasonless-annotation',
          text: lines[i].trim().slice(0, 120),
        });
      }
    }

    // Anti-rot (4): a well-formed annotation that suppressed nothing in this file.
    if (ANNOTATION_WITH_REASON.test(source) && !suppressedFiles.has(file)) {
      const line = lines.findIndex((l) => ANNOTATION_WITH_REASON.test(l)) + 1;
      findings.push({
        file,
        line,
        kind: 'stale-annotation',
        text: `allow-legacy-typescript suppresses no '${LEGACY_PACKAGE}' import — remove it`,
      });
    }
  }

  // The ratchet may only tighten: a baselined manifest that has since dropped the dependency must be
  // removed from the baseline in the same PR, or the freed slot silently stays available for reuse.
  for (const baselined of baseline) {
    if (!stillDeclaring.has(baselined)) {
      notices.push(
        `${baselined} no longer declares '${LEGACY_PACKAGE}' — tighten the ratchet ` +
          `(regenerate legacy-typescript-baseline.json with --write-baseline in this PR).`,
      );
    }
  }

  return findings;
}

/** Freeze the manifests that currently declare the dependency (excluding the reasoned exemption). */
function writeBaseline() {
  const manifests = [];
  for (const file of gitTrackedFiles(WORKSPACE_ROOT)) {
    if (path.basename(file) !== 'package.json') continue;
    if (file.includes('/node_modules/') || EXEMPTIONS.has(file)) continue;
    const manifest = JSON.parse(readFileSync(path.join(WORKSPACE_ROOT, file), 'utf8'));
    if (findLegacyDependencies(manifest).length > 0) manifests.push(file);
  }
  manifests.sort();
  const payload = {
    $comment:
      `PERF-005 ratchet. Workspace manifests that still declare '${LEGACY_PACKAGE}' as a ` +
      'dependency. None is a code consumer (phase 1 removed the last import; these packages build ' +
      'with tsdown and typecheck with tsgo) — the list exists so the surface cannot GROW while the ' +
      'entries are burned down. It may only ever shrink; regenerate with --write-baseline.',
    manifests,
  };
  writeFileSync(BASELINE_PATH, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  console.log(`legacy-typescript-baseline.json regenerated (${manifests.length} manifest(s)).`);
}

function main() {
  if (process.argv.includes('--write-baseline')) {
    writeBaseline();
    return;
  }
  const notices = [];
  const findings = findLegacyTypeScriptFindings(WORKSPACE_ROOT, { notices });
  for (const notice of notices) console.log(`note: ${notice}`);
  if (findings.length === 0) {
    console.log('legacy-typescript scan passed.');
    process.exit(0);
  }
  console.error('legacy-typescript scan FAILED — the legacy compiler surface is growing back:');
  for (const f of findings) {
    console.error(`  [${f.kind}] ${f.file}:${f.line}  ${f.text}`);
  }
  console.error(
    '\nPERF-005: no first-party code may depend on the legacy TypeScript compiler.\n' +
      '  - legacy-typescript-import: use `scripts/harness/lib/ts-ast.mjs` (the native-AST adapter),\n' +
      '    which covers the syntactic API — createSourceFile, forEachChild, SyntaxKind, isXxx guards.\n' +
      '    Nothing in this repo uses the type checker; if you genuinely need it, that is a design\n' +
      '    decision for the backlog item, not a new import.\n' +
      '  - legacy-typescript-dependency: only the root manifest may declare it, and only while\n' +
      "    @typescript-eslint's runtime import forces it (PERF-005 phase 2 removes it).\n" +
      '  - legacy-typescript-version: PERF-006 retired the 5.x line. Everything we compile and\n' +
      `    type-check runs on the native compiler; '${LEGACY_PACKAGE}' exists ONLY for tools that\n` +
      `    still need a programmatic compiler API, and must be a ${MINIMUM_MAJOR}.x range. Not\n` +
      '    waivable by the baseline or the root exemption — those excuse the presence of the\n' +
      '    dependency, never its version.\n' +
      '  - reasonless-annotation: every `allow-legacy-typescript` MUST carry a `: <reason>`.\n' +
      '  - stale-annotation / unused-exemption: the excuse outlived what it excused — delete it.',
  );
  process.exit(1);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
