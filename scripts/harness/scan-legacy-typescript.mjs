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
 * PERF-006 follow-up extended it AGAIN, and the gap is worth stating because it is the exact hole
 * that let the 5.x line survive a change whose whole point was to end it. Every edge below the
 * store edge inspects a DECLARATION — a manifest we write, an import we write. None of them can see
 * what is actually INSTALLED. After the 6.0.3 bump all 97 of our manifests were clean, the scan was
 * green, and `node_modules/.pnpm/typescript@5.9.3` was still on disk: a transitive package four
 * levels down (`apps/agent-app` -> `electron-builder@25` -> `app-builder-lib` -> `config-file-ts`)
 * took `typescript@^5.4.3` as a hard `dependencies` entry, so pnpm materialised it a private copy.
 * A guard that only reads our own manifests reports success while the goal is unmet. The store edge
 * closes that: it asks what the tree RESOLVES, not what we declare.
 *
 * It reports SIX finding kinds:
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
 *  4. `legacy-typescript-installed` — PERF-006 follow-up. A copy of `typescript` BELOW 6 is
 *     materialised in `node_modules`, whoever declared it. This is the only edge that reads the
 *     installed tree rather than a declaration, and it is the one that actually answers the owner's
 *     question ("is TypeScript 5 gone?"). It is deliberately NOT waivable — not by the baseline, not
 *     by the root exemption, and there is no annotation for it. A resolved 5.x copy is either
 *     removable (upgrade or drop whatever pulls it) or it is a decision to bring to the owner; an
 *     escape hatch here would just be the manifest-only blind spot rebuilt one suppression at a time.
 *     The fix that cleared the last one was an honest dependency upgrade (`electron-builder` 25 -> 26,
 *     whose `app-builder-lib` dropped `config-file-ts` for `jiti`), NOT a `pnpm.overrides` entry
 *     forcing someone else's private dependency onto a major it never declared support for.
 *  5. `reasonless-annotation` — anti-rot on the escape hatch: an `allow-legacy-typescript`
 *     annotation with no `: <reason>`. Every suppression must state WHY.
 *  6. `stale-annotation` — anti-rot the other way: an `allow-legacy-typescript: <reason>` that
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
import { existsSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import * as ts from './lib/ts-ast.mjs';
import { ADVISORY_MARKER } from './run-all-scans.mjs';
import { envWithoutGitVars, resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
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

/**
 * PERF-006 follow-up — the STORE edge. Everything above reads a declaration; this reads the tree.
 *
 * The major an installed copy reports, or `undefined` when the version is not a form we can judge.
 * Same ratchet stance as `lowestMajorAdmitted`: an unreadable version is reported, never passed.
 */
export function installedMajor(version) {
  if (typeof version !== 'string') return undefined;
  const match = /^\s*v?(\d+)\./.exec(version);
  if (match === null) return undefined;
  return Number(match[1]);
}

/**
 * The installed copies that sit below the floor. Pure — takes the copies the walk found, so the
 * judgement is testable without a node_modules tree on disk.
 *
 * Each copy is `{ dir, version }`. Returns `{ dir, version, reason }` entries.
 */
export function findBelowMinimumInstalled(copies, minimumMajor = MINIMUM_MAJOR) {
  const below = [];
  for (const copy of copies) {
    const major = installedMajor(copy.version);
    if (major === undefined) {
      below.push({
        ...copy,
        reason: 'reports a version this guard cannot read, so it cannot prove',
      });
    } else if (major < minimumMajor) {
      below.push({ ...copy, reason: 'resolves below' });
    }
  }
  return below;
}

/**
 * How many `node_modules` levels deep the walk descends. pnpm — the package manager this repo pins —
 * materialises EVERY copy at exactly two levels (`node_modules/.pnpm/<id>/node_modules/<name>`), so
 * this is generous headroom rather than a guess, and it also covers npm's nested layout for anyone
 * who installs differently.
 */
const STORE_WALK_MAX_LEVELS = 8;

/** The version of the package rooted at `dir`, but ONLY if it really is the legacy compiler. */
function installedVersionAt(dir) {
  const manifestPath = path.join(dir, 'package.json');
  if (!existsSync(manifestPath)) return undefined;
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
  } catch {
    return undefined;
  }
  // The authoritative confirmation, mirroring the import edge's AST check: a directory NAMED
  // `typescript` is not enough. `@scope/typescript` would sit in a directory of that name too, and
  // its manifest name would not be `typescript`.
  if (manifest?.name !== LEGACY_PACKAGE) return undefined;
  return manifest.version;
}

/**
 * Every `typescript` copy materialised under `root/node_modules`, as `{ dir, version }` with `dir`
 * relative to `root`. Returns `undefined` — distinct from `[]` — when there is no `node_modules` at
 * all, because "nothing installed" is not evidence of a clean tree and must not read as one.
 *
 * The walk follows the module-resolution structure rather than every subdirectory, so it stays fast:
 * a `node_modules` level holds package dirs, `@scope` dirs and pnpm's `.pnpm` store, and only those
 * can lead to another `node_modules`. Copies are deduplicated by real path, since pnpm's top-level
 * entries are symlinks into `.pnpm` and would otherwise be counted twice.
 */
export function collectInstalledCopies(root, { maxLevels = STORE_WALK_MAX_LEVELS } = {}) {
  const entryPoint = path.join(root, 'node_modules');
  if (!existsSync(entryPoint)) return undefined;

  const copies = [];
  const visitedRealPaths = new Set();

  /** `dir` is a directory that directly contains package directories. */
  const visitNodeModules = (dir, level) => {
    if (level > maxLevels) return;
    let entries;
    try {
      entries = readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const child = path.join(dir, entry.name);
      if (entry.name === '.pnpm') {
        // pnpm's virtual store: each child is one package identity holding its own node_modules.
        let storeEntries;
        try {
          storeEntries = readdirSync(child, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const storeEntry of storeEntries) {
          visitNodeModules(path.join(child, storeEntry.name, 'node_modules'), level + 1);
        }
        continue;
      }
      if (entry.name.startsWith('@')) {
        // A scope directory holds package directories, but is not itself one.
        let scoped;
        try {
          scoped = readdirSync(child, { withFileTypes: true });
        } catch {
          continue;
        }
        for (const scopedEntry of scoped) visitPackage(path.join(child, scopedEntry.name), level);
        continue;
      }
      if (entry.name.startsWith('.')) continue;
      visitPackage(child, level);
    }
  };

  /** `dir` is one installed package. */
  const visitPackage = (dir, level) => {
    let realPath;
    try {
      realPath = realpathSync(dir);
    } catch {
      return;
    }
    if (visitedRealPaths.has(realPath)) return;
    visitedRealPaths.add(realPath);

    const version = installedVersionAt(dir);
    if (version !== undefined) copies.push({ dir: path.relative(root, dir), version });
    visitNodeModules(path.join(dir, 'node_modules'), level + 1);
  };

  visitNodeModules(entryPoint, 1);
  copies.sort((a, b) => a.dir.localeCompare(b.dir));
  return copies;
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

/**
 * Tracked files that are actually PRESENT.
 *
 * `git ls-files` lists what the index knows, which is not always what is on disk: a change that
 * DELETES a source file, or a materialised tree built from HEAD plus working changes, leaves entries
 * naming files that are gone. This function used to hand those straight to `readFileSync`, so any
 * commit removing a `.ts` file crashed the scan with an ENOENT stack instead of a verdict — a gate
 * that blocks correct work is one people route around.
 *
 * Absent entries are skipped and COUNTED, not skipped quietly: a scan that silently examines less
 * than it was asked to is the vacuity this suite is elsewhere measuring.
 */
export function gitTrackedFiles(root, notices = []) {
  // Ambient git context is scrubbed, or the reading is not about `root` at all. A git hook exports
  // GIT_DIR into everything it launches, so under `git push` from a linked worktree this listing
  // answered from THAT repository while `cwd` pointed at a probe directory — every listed path was
  // then absent from disk, the finder returned an empty, noticed result over a tree it never read,
  // and the fail-closed ledger measured it `vacuous`. The same redirection, aimed at a real
  // repository, is how fixture commits have overwritten a shared branch (git-ambient-env.json).
  const listed = execFileSync('git', ['ls-files'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1 << 28,
    env: envWithoutGitVars(),
  })
    .split('\n')
    .filter(Boolean);
  const present = listed.filter((file) => existsSync(path.join(root, file)));
  if (present.length !== listed.length) {
    notices.push(
      `legacy-typescript: ${listed.length - present.length} tracked path(s) are absent from disk ` +
        '(a deletion in this change, or a materialised tree) and were not examined.',
    );
  }
  return present;
}

export function findLegacyTypeScriptFindings(root = WORKSPACE_ROOT, options = {}) {
  const findings = [];
  const notices = options.notices ?? [];
  const baseline = new Set(options.baseline ?? loadDependencyBaseline());
  const stillDeclaring = new Set();
  const files = gitTrackedFiles(root, notices);
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

  // PERF-006 follow-up: the STORE edge. Asked once, over the whole installed tree, rather than
  // per-file — it is a property of the resolution, not of any manifest we own.
  const installed = collectInstalledCopies(root);
  if (installed === undefined) {
    // Not installed, so unobservable. Loud rather than silent: a scan that quietly skips its only
    // resolution-level edge on an uninstalled tree is indistinguishable from one that passed it.
    notices.push(
      `no node_modules at ${root} — the installed-copy edge could not run. Run the install first; ` +
        'CI always does, so this is only reachable locally.',
    );
  } else {
    for (const { dir, version, reason } of findBelowMinimumInstalled(installed)) {
      findings.push({
        file: dir,
        line: 1,
        kind: 'legacy-typescript-installed',
        text:
          `'${LEGACY_PACKAGE}@${version}' is materialised here, which ${reason} ` +
          `${MINIMUM_MAJOR} — find whatever pulls it in and upgrade or drop that (PERF-006)`,
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

/**
 * Render each notice as ONE advisory line.
 *
 * HARNESS-052, reachability axis. The uninstalled-tree notice above calls itself "Loud rather than
 * silent", and it was MEASURED silent: `run-all-scans` discards a passing scan's stdout, so
 * `pnpm harness:scan` — the only path anyone runs this on — printed `✓ legacy-typescript` and
 * nothing else, byte-identical to a run where the installed-copy edge DID execute. `ADVISORY_MARKER`
 * (HARNESS-053) is the one channel that survives a 0 exit, and it cannot change the verdict.
 *
 * Both notice kinds route through here deliberately: the ratchet-tighten notice has exactly the same
 * problem — it asks for work in the same PR and nobody could see it being asked.
 */
export function formatNotices(notices) {
  return notices.map((notice) => `${ADVISORY_MARKER} ${notice}`);
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
  for (const line of formatNotices(notices)) console.log(line);
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
      '  - legacy-typescript-installed: a 5.x copy is ON DISK regardless of what we declare, so the\n' +
      '    goal is not met. FIRST run `pnpm prune`: pnpm does NOT evict a store entry that a\n' +
      '    dependency change orphaned, so after switching branches or bumping a package the copy can\n' +
      '    be a stale leftover the lockfile no longer references. `pnpm install` does not clear it.\n' +
      '    If it survives a prune it is real — find the hard `dependencies` entry that pulls it: parse each manifest\n' +
      `    under node_modules/.pnpm and look up the literal '${LEGACY_PACKAGE}' key; do NOT grep the\n` +
      '    string, which also matches @typescript-eslint/* and @typescript/native-preview — then\n' +
      '    UPGRADE or DROP whatever depends on it. There is no annotation for this edge on purpose:\n' +
      '    a pnpm.overrides entry forcing a third party onto an unsupported major is a decision for\n' +
      '    the owner, not a suppression.\n' +
      '  - reasonless-annotation: every `allow-legacy-typescript` MUST carry a `: <reason>`.\n' +
      '  - stale-annotation / unused-exemption: the excuse outlived what it excused — delete it.',
  );
  process.exit(1);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
