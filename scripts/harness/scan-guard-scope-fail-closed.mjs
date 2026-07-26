#!/usr/bin/env node

/**
 * Guard-scope fail-closed floor (HARNESS-052).
 *
 * THE DEFECT, one level up. Every gate this repository lost in the last week reported success over
 * ground it never covered — `Claude review` skipping and exiting 0, `scans` printing `SKIPPED … Not
 * a pass`, `protect-main`'s required contexts echoing for three seconds. The scans written to fence
 * those in are themselves written in the same idiom:
 *
 *     const dir = path.join(root, WORKFLOW_DIR);
 *     if (!existsSync(dir)) return [];        // ← "nothing to check" == "clean"
 *
 * MEASURED on this tree, by running each registered scan's finder against a root that does not
 * contain its governed tree: **30 of the 50 finders returned an empty finding list** — i.e. reported
 * a pass — including the three that guard `.github/workflows`, the directory whose contents are the
 * subject of five of the ten incidents. The 20 that fail closed are the proof the shape is
 * avoidable, not inherent.
 *
 * THE RULE, in two halves, because either alone can be satisfied vacuously:
 *
 *   1. CLASSIFICATION COMPLETENESS. Every scan registered in `run-all-scans.mjs` that exports a
 *      `find…`/`collect…` finder taking a `root` must appear in exactly one of the two tables below.
 *      The finder set is DERIVED from the registration list and the source — never hand-listed — so
 *      a new scan cannot be added without answering for its behaviour, and a table entry for a scan
 *      that no longer exists is itself a finding (anti-rot).
 *
 *   2. BEHAVIOUR. Every `MANDATORY_TREE_GUARDS` entry is EXECUTED against a temporary root that
 *      lacks its governed tree, and must throw or return at least one finding. This is a behavioural
 *      assertion, not a source-pattern match: it cannot be satisfied by rewording the code, and it
 *      cannot pass on a guard that merely looks fail-closed.
 *
 * THIS SCAN HAS ALREADY BEEN CAUGHT COMMITTING ITS OWN DEFECT, which is why rule 1's derivation is
 * spelled out so defensively. Its first version matched `export function (find…)\(\s*root\s*=` and
 * so derived 20 of the 50 finders: it saw neither `export async function`, nor a `collect…` finder,
 * nor a `root` parameter without a default — and therefore did not classify ITSELF, since
 * `findGuardScopeFindings` is async. Falsified by registering a scan exporting
 * `export async function findBogusFindings(root = X) { return []; }`, vacuous for every root: the
 * completeness rule passed. Flipping the single keyword `async function` → `function` made the same
 * file fail. A second defect masked it — `finder(bare)` was not awaited, so a classified async
 * finder would have been reported as violating no matter how it behaved.
 *
 * THE CEILING, stated rather than implied. `PENDING_CLASSIFICATION` is not an exemption list and
 * must not be read as one — 30 of its entries were MEASURED to report a pass over an absent governed
 * tree and are recorded, unfixed, in HARNESS-052. The behavioural half covers only the six guards in
 * `MANDATORY_TREE_GUARDS`. Anything outside the derived finder set — a scan that walks its tree
 * inline in `main()`, or one that takes no root — is invisible here. A pass from this scan means
 * "the six classified guards fail closed", never "no guard can be satisfied vacuously".
 *
 * Exit code 0 = every classified guard behaves as declared, 1 = violation found.
 */

import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const HARNESS_DIR = path.join('scripts', 'harness');
const REGISTRATION_FILE = path.join(HARNESS_DIR, 'run-all-scans.mjs');

/**
 * Guards whose governed tree is MANDATORY in this repository: its absence means the scan is running
 * somewhere it cannot judge, which is an error and never a pass. Each must throw or report a finding
 * when handed a root without that tree.
 */
export const MANDATORY_TREE_GUARDS = [
  {
    file: 'scan-review-workflow-parity.mjs',
    finder: 'findReviewWorkflowParityFindings',
    tree: '.github/workflows',
    why: 'the parity rule exists because the review action skips and exits 0 on a mismatch; with no workflow to compare, "nothing to guard" is indistinguishable from the failure it guards',
  },
  {
    file: 'scan-ci-base-history.mjs',
    finder: 'findBaseHistoryFindings',
    tree: '.github/workflows',
    why: 'a grafted `--depth` fetch made required jobs report `skipping`, which branch protection accepts — the guard reading zero workflows is the same hole reopened',
  },
  {
    file: 'scan-automerge-disarm-permission.mjs',
    finder: 'findAutomergePermissionFindings',
    tree: '.github/workflows',
    why: 'an unpermitted auto-merge disarm fails silently; a permission guard that inspects no workflow reproduces exactly that silence',
  },
  {
    file: 'scan-no-fallback.mjs',
    finder: 'findNoFallbackFindings',
    tree: 'packages',
    why: 'the No-Fallback floor governs shipped package source; a repository checkout without `packages/` is broken, not clean',
  },
  {
    file: 'scan-no-fake-in-src.mjs',
    finder: 'findFakeInSrc',
    tree: 'packages',
    why: 'the no-test-doubles-in-shipped-code floor governs shipped package source; same reasoning as no-fallback',
  },
  {
    file: 'scan-tautological-assertions.mjs',
    finder: 'findTautologicalAssertions',
    tree: 'packages, apps and scripts',
    why: 'a test-assertion floor that finds no test files has not found clean tests, it has found no tests',
  },
  {
    file: 'scan-conflict-markers.mjs',
    finder: 'findGitConflictMarkers',
    tree: 'packages, apps and scripts',
    why: 'merge debris in a tree that was never opened is the one thing a "conflict markers" gate must never report clean',
  },
];

/**
 * Registered finders NOT behaviourally pinned by this scan, each carrying the verdict actually
 * MEASURED when it was handed a root without its governed tree (2026-07-26, this tree).
 *
 * This is a ledger, not an allowlist — and it is deliberately not uniform, because the measurements
 * were not. `vacuous` entries are live instances of the audited defect, recorded unfixed in
 * HARNESS-052. `fail-closed` entries already behave correctly but are not pinned here: pinning them
 * needs their governed tree named accurately, and some (e.g. `scan-unearned-done-claims`) fail
 * closed only INCIDENTALLY — via a stale-allowlist assertion rather than a deliberate check — so
 * pinning them as-is would certify a property they do not actually hold. Entries leave this list by
 * being fixed or accurately pinned, never by being deleted.
 *
 * Every `measured` value here was produced by executing the finder, not by reading it.
 */
export const PENDING_CLASSIFICATION = [
  {
    file: 'check-agent-server-boundary.mjs',
    finder: 'findAgentServerBoundaryFindings',
    measured: 'fail-closed',
  },
  {
    file: 'check-architecture-map-paths.mjs',
    finder: 'findArchitectureMapPathFindings',
    measured: 'vacuous',
  },
  {
    file: 'check-background-workspace-conformance.mjs',
    finder: 'findBackgroundWorkspaceConformanceFindings',
    measured: 'fail-closed',
  },
  {
    file: 'check-background-workspace-conformance.mjs',
    finder: 'findUsedExemptions',
    measured: 'vacuous',
  },
  {
    file: 'check-backlog-placement.mjs',
    finder: 'findBacklogPlacementFindings',
    measured: 'vacuous',
  },
  { file: 'check-backlog-placement.mjs', finder: 'findDuplicateIdFindings', measured: 'vacuous' },
  {
    file: 'check-build-output-contracts.mjs',
    finder: 'findBuildOutputContractFindings',
    measured: 'fail-closed',
  },
  {
    file: 'check-capability-placement.mjs',
    finder: 'findCapabilityPlacementFindings',
    measured: 'fail-closed',
  },
  {
    file: 'check-command-layering.mjs',
    finder: 'findCommandLayeringFindings',
    measured: 'vacuous',
  },
  { file: 'check-dep-kind.mjs', finder: 'findDevDepOnlyRuntimeImports', measured: 'vacuous' },
  { file: 'check-done-evidence.mjs', finder: 'findDoneEvidenceFindings', measured: 'vacuous' },
  {
    file: 'check-functional-coverage.mjs',
    finder: 'collectFunctionalCoverageFindings',
    measured: 'fail-closed',
  },
  {
    file: 'check-ghost-package-refs.mjs',
    finder: 'findGhostPackageRefFindings',
    measured: 'vacuous',
  },
  {
    file: 'check-harness-config-paths.mjs',
    finder: 'findHarnessConfigPathFindings',
    measured: 'vacuous',
  },
  { file: 'check-orphan-exports.mjs', finder: 'findOrphanExportFindings', measured: 'vacuous' },
  { file: 'check-publish-safety.mjs', finder: 'findPublishClaimFindings', measured: 'vacuous' },
  {
    file: 'check-sdk-public-surface.mjs',
    finder: 'findSdkPublicSurfaceFindings',
    measured: 'fail-closed',
  },
  { file: 'check-spec-paths.mjs', finder: 'findSpecPathFindings', measured: 'vacuous' },
  {
    file: 'check-spec-public-surface.mjs',
    finder: 'collectUndocumentedExports',
    measured: 'vacuous',
  },
  {
    file: 'check-spec-public-surface.mjs',
    finder: 'findPublicSurfaceFindings',
    measured: 'vacuous',
  },
  { file: 'check-stub-markers.mjs', finder: 'findStubMarkerFindings', measured: 'vacuous' },
  { file: 'check-task-archival.mjs', finder: 'findTaskArchivalFindings', measured: 'vacuous' },
  { file: 'check-temp-script-placement.mjs', finder: 'findParkedTempScripts', measured: 'vacuous' },
  { file: 'check-workspace-refs.mjs', finder: 'findWorkspaceRefFindings', measured: 'vacuous' },
  { file: 'scan-api-pagination.mjs', finder: 'findUnpaginatedApiQueries', measured: 'vacuous' },
  {
    file: 'scan-capability-reachability.mjs',
    finder: 'findCapabilityReachabilityFindings',
    measured: 'vacuous',
  },
  { file: 'scan-conflict-markers.mjs', finder: 'findConflictMarkerFindings', measured: 'vacuous' },
  { file: 'scan-deployment-matrix.mjs', finder: 'findTransportNames', measured: 'vacuous' },
  {
    file: 'scan-deprecated-markers.mjs',
    finder: 'findDeprecatedMarkerFindings',
    measured: 'vacuous',
  },
  {
    file: 'scan-dist-freshness.mjs',
    finder: 'collectDistFreshnessResults',
    measured: 'fail-closed',
  },
  { file: 'scan-evals-neutrality.mjs', finder: 'findEvalsNeutralityFindings', measured: 'vacuous' },
  {
    file: 'scan-guard-scope-fail-closed.mjs',
    finder: 'findGuardScopeFindings',
    measured: 'fail-closed',
  },
  { file: 'scan-hook-catalog.mjs', finder: 'collectFiringEvents', measured: 'fail-closed' },
  { file: 'scan-hook-catalog.mjs', finder: 'findHookCatalogFindings', measured: 'fail-closed' },
  { file: 'scan-legacy-typescript.mjs', finder: 'collectInstalledCopies', measured: 'vacuous' },
  {
    file: 'scan-legacy-typescript.mjs',
    finder: 'findLegacyTypeScriptFindings',
    measured: 'fail-closed',
  },
  {
    file: 'scan-main-required-checks.mjs',
    finder: 'findRequiredCheckFindings',
    measured: 'fail-closed',
  },
  { file: 'scan-memory-mirror.mjs', finder: 'collectMemoryMirrorFindings', measured: 'vacuous' },
  {
    file: 'scan-memory-neutrality.mjs',
    finder: 'findMemoryNeutralityFindings',
    measured: 'vacuous',
  },
  {
    file: 'scan-orchestration-map.mjs',
    finder: 'collectOrchestrationMapFindings',
    measured: 'vacuous',
  },
  {
    file: 'scan-orchestration-neutrality.mjs',
    finder: 'findOrchestrationNeutralityFindings',
    measured: 'vacuous',
  },
  {
    file: 'scan-review-findings.mjs',
    finder: 'collectReviewFindingsFindings',
    measured: 'fail-closed',
  },
  { file: 'scan-spec-research.mjs', finder: 'collectSpecResearchFindings', measured: 'vacuous' },
  {
    file: 'scan-unearned-done-claims.mjs',
    finder: 'findUnearnedDoneClaimFindings',
    measured: 'fail-closed',
  },
];

/** Ledger entries measured to report a pass over an absent governed tree. */
export const measuredVacuous = () =>
  PENDING_CLASSIFICATION.filter((entry) => entry.measured === 'vacuous');

/** Scan scripts registered in `run-all-scans.mjs`, as bare filenames. Parsed, never hand-listed. */
export function registeredScanFiles(root = WORKSPACE_ROOT) {
  const source = readFileSync(path.join(root, REGISTRATION_FILE), 'utf8');
  const files = [...source.matchAll(/scripts\/harness\/([a-z0-9-]+\.mjs)/g)].map((m) => m[1]);
  if (files.length === 0)
    throw new Error(
      `${REGISTRATION_FILE} parsed to zero registered scans. An empty registration list would ` +
        "satisfy every assertion below vacuously — which is this scan's own defect.",
    );
  return [...new Set(files)].sort();
}

/**
 * Exported finders of one harness script that take a `root`. The shape that makes a guard checkable
 * here.
 *
 * THIS REGEX IS THE WHOLE RULE, so its narrowness is the whole hole. It first read
 * `export function (find…)\(\s*root\s*=`, which matched neither `export async function` nor a
 * `collect…` finder nor a `root` parameter without a default. Measured: 20 of 41 finders derived,
 * and this scan did not classify ITSELF — `findGuardScopeFindings` is `async`. Falsified by
 * registering a scan exporting `export async function findBogusFindings(root = X) { return []; }`,
 * unconditionally vacuous for every root: the completeness rule passed. Changing the single keyword
 * `async function` → `function` made the same file fail. A rule whose verdict turns on a keyword is
 * measuring spelling, not structure — which is this scan's own subject, one level up.
 */
export function rootFinderExports(sourceText) {
  return [
    ...stripJsComments(String(sourceText ?? '')).matchAll(
      /export\s+(?:async\s+)?function\s+((?:find|collect)[A-Za-z0-9_]*)\(\s*root\b/g,
    ),
  ]
    .map((match) => match[1])
    .sort();
}

/**
 * Remove block and line comments before matching declarations.
 *
 * Not cosmetic. Without it this scan matched the `export async function findBogusFindings(root = X)`
 * written in its OWN docstring above and derived a finder for a function that does not exist — a
 * scan reading its own documentation as evidence, which is the failure mode `scan-orchestration-map`
 * and `check-test-coverage-scripts` were separately found to have. A declaration is code, so only
 * code is searched.
 */
export function stripJsComments(sourceText) {
  return String(sourceText ?? '')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
}

/** Every `{ file, finder }` pair this scan is responsible for classifying, derived from the tree. */
export function derivedFinders(root = WORKSPACE_ROOT) {
  const pairs = [];
  for (const file of registeredScanFiles(root)) {
    const source = readFileSync(path.join(root, HARNESS_DIR, file), 'utf8');
    for (const finder of rootFinderExports(source)) pairs.push({ file, finder });
  }
  return pairs;
}

const keyOf = (entry) => `${entry.file}#${entry.finder}`;

/** Rule 1: every derived finder classified exactly once, and no table entry left behind. */
export function classificationFindings(root = WORKSPACE_ROOT) {
  const findings = [];
  const derived = new Set(derivedFinders(root).map(keyOf));
  const mandatory = MANDATORY_TREE_GUARDS.map(keyOf);
  const pending = PENDING_CLASSIFICATION.map(keyOf);
  const declared = new Set([...mandatory, ...pending]);

  for (const key of [...derived].sort()) {
    if (!declared.has(key))
      findings.push({
        subject: key,
        detail:
          'is a registered scan exporting a root finder, and is in neither MANDATORY_TREE_GUARDS ' +
          'nor PENDING_CLASSIFICATION. Classify it: run it against a root without its governed ' +
          'tree and record whether it fails closed.',
      });
  }
  for (const key of [...declared].sort()) {
    if (!derived.has(key))
      findings.push({
        subject: key,
        detail:
          'is declared here but is no longer a registered scan exporting that finder. A stale ' +
          'declaration is a rule that guards nothing — remove it or fix the name.',
      });
  }
  const both = mandatory.filter((key) => pending.includes(key));
  for (const key of both)
    findings.push({
      subject: key,
      detail: 'appears in BOTH tables — it must appear in exactly one.',
    });
  return findings;
}

/** Rule 2: run one mandatory guard against a root lacking its governed tree. */
async function behaviourFinding(entry, root) {
  const module = await import(pathToFileURL(path.join(root, HARNESS_DIR, entry.file)).href);
  const finder = module[entry.finder];
  if (typeof finder !== 'function')
    return {
      subject: keyOf(entry),
      detail: `does not export \`${entry.finder}\` as a function — the declaration is stale.`,
    };

  const bare = mkdtempSync(path.join(tmpdir(), 'guard-scope-'));
  try {
    let result;
    try {
      // AWAITED (HARNESS-052): without this an async finder resolves to a Promise, which is neither
      // an array nor `{findings}`, so it would be reported as a violation no matter how it behaves.
      // That defect and the sync-only derivation regex above masked each other exactly.
      result = await finder(bare);
    } catch {
      return undefined; // threw on an unreadable root — fail-closed, which is the requirement
    }
    const list = Array.isArray(result) ? result : (result?.findings ?? null);
    const otherSignals =
      result && !Array.isArray(result)
        ? Object.entries(result).some(
            ([key, value]) => key !== 'findings' && Array.isArray(value) && value.length > 0,
          )
        : false;
    if ((list?.length ?? 0) > 0 || otherSignals) return undefined; // reported something — fail-closed
    return {
      subject: keyOf(entry),
      detail:
        `returned an EMPTY finding list for a root with no \`${entry.tree}\`. ${entry.why}. ` +
        'Make the missing tree an error, not a pass.',
    };
  } finally {
    rmSync(bare, { recursive: true, force: true });
  }
}

/** Findings across both rules. */
export async function findGuardScopeFindings(root = WORKSPACE_ROOT) {
  const findings = classificationFindings(root);
  for (const entry of MANDATORY_TREE_GUARDS) {
    const finding = await behaviourFinding(entry, root);
    if (finding) findings.push(finding);
  }
  return findings;
}

export async function main() {
  const findings = await findGuardScopeFindings();
  if (findings.length > 0) {
    process.stdout.write('guard-scope-fail-closed scan failed (HARNESS-052):\n');
    for (const finding of findings) {
      process.stdout.write(`  - ${finding.subject}: ${finding.detail}\n`);
    }
    process.stdout.write(
      'A guard that reports a pass over a tree it never read is the defect it was built to catch,\n' +
        'one level up. See HARNESS-052.\n',
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write(
    `guard-scope-fail-closed scan passed (${MANDATORY_TREE_GUARDS.length} guard(s) proven ` +
      `fail-closed by execution; ${measuredVacuous().length} measured VACUOUS and recorded unfixed ` +
      `in HARNESS-052, ${PENDING_CLASSIFICATION.length - measuredVacuous().length} fail closed but ` +
      'are not pinned here). This is not a claim that no guard can be satisfied vacuously.\n',
  );
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
