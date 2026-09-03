#!/usr/bin/env node

/**
 * Fail when changed documentation puts durable contract/plan content in the wrong owner document.
 *
 * Enforced rules (HARNESS-DIET-003 — this gate was warn-only AND base-ref-blind, so it could never
 * fail; it now blocks):
 * - `architecture-doc-plan-content`: architecture maps own stable boundaries; implementation-plan
 *   sections belong in design/task/backlog documents.
 * - `design-contract-without-owner-doc`: a design doc may explain a contract, but accepted contract
 *   authority must land in the owner SPEC/architecture document in the same branch.
 *
 * The former advisory `package-change-without-owner-spec` heuristic (every `packages|apps` src or
 * package.json change without a SPEC/architecture-map change in the same branch) is intentionally
 * DROPPED rather than made blocking: it fires on routine changes (bug fixes, release version-bump
 * PRs touching every package.json) where no owner-doc change is warranted, so it can only ever be
 * noise as a gate. Spec currency is governed by spec-workflow + audit-spec-coverage instead.
 *
 * Base-ref resolution:
 * 1. `--base-ref <ref>` CLI argument, if given.
 * 2. `$HARNESS_BASE_REF` when the harness declares an analysis baseline.
 * 3. `origin/$GITHUB_BASE_REF` (PR events).
 * 4. `origin/develop` (default).
 *
 * FAIL-CLOSED (INFRA-048-B). When no base resolves, or the diff against it cannot run, this scan
 * exits **1**. It previously printed `SKIPPED … Not a pass` and exited **0** — which every caller
 * reads as a pass, so a required CI gate stopped enforcing while reporting success (INFRA-050
 * measured exactly that on the depth-50 `scans` checkout). "Cannot determine the answer" is not
 * "there is nothing to report": a tree carrying a real violation passed. Unblock by naming a base
 * (`--base-ref <ref>`), not by ignoring the exit code.
 *
 * The former `git fetch --depth=50` fallback is GONE (INFRA-050): a depth fetch GRAFTS the
 * repository, truncating ancestry `actions/checkout` already fetched, so the fallback that was
 * meant to rescue a shallow checkout was itself the thing that broke base resolution. Every job
 * that runs this scan now checks out with `fetch-depth: 0`, so `origin/<base>` is already present.
 *
 * Exit code 0 = clean, 1 = findings OR the gate could not be evaluated.
 */

import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta, { fromCwd: true });
const DEFAULT_BASE_BRANCH = 'develop';

const ARCHITECTURE_PLAN_HEADINGS =
  /^##\s+(?:Implementation Plan|Work Plan|Promotion Path|Suggested Backlog Slices|Recommended Direction)\s*$/im;
const DESIGN_CONTRACT_HEADINGS =
  /^##\s+(?:Public API|Package Boundary|Contract|Owner Contract)\s*$/im;

function normalizePath(filePath) {
  return filePath.split(path.sep).join('/');
}

function isMarkdown(filePath) {
  return filePath.endsWith('.md') || filePath.endsWith('.mdx');
}

function isArchitectureDoc(filePath) {
  return (
    filePath === '.agents/specs/ARCHITECTURE-MAP.md' ||
    filePath.startsWith('.agents/specs/architecture-map/') ||
    /^packages\/[^/]+\/docs\/ARCHITECTURE-MAP\.md$/.test(filePath)
  );
}

function isDesignDoc(filePath) {
  // RULE-013 (T-17): `.design/decisions/` is the ADR location the taxonomy declares, and RULE-010's
  // `adr` gate already owns it — one finding per defect, reported by its owner. Classifying ADRs as
  // design docs is worse than a mislabel: `hasMatchingOwnerDocument()` derives its escape hatch from
  // a `packages|apps` scope, which a `.design/**` path can never produce, so a finding there could
  // not be cleared by ANY change, including the correct one. ADRs are immutable-then-superseded, so
  // "update it alongside the SPEC" is not an action an ADR has.
  if (filePath.startsWith('.design/decisions/')) return false;
  return (
    filePath.startsWith('.design/') ||
    // RULE-013 (T-16): the location RULE-009 defined for design/LLD documents. Its absence here is
    // why the placement criterion was not in force — the one blocking gate that judges content
    // placement could not see the documents the criterion routes content into.
    // Nesting-aware and apps-inclusive on purpose: a depth-1 glob would leave the 20 nested
    // `packages/dag-nodes/*` packages invisible to this blocking gate — the HARNESS-052/INFRA-021
    // defect the sibling scans in this same change explicitly avoid. `getPackageScope()` already
    // handles `apps/`, and apps own SPECs, so they are in scope too.
    /^(?:packages|apps)\/(?:[^/]+\/)?[^/]+\/docs\/design\/.+\.md$/.test(filePath) ||
    /^docs\/plans\/.+-design\.md$/.test(filePath) ||
    /^docs\/superpowers\/.*design.*\.md$/.test(filePath)
  );
}

function getPackageScope(filePath) {
  const match = /^(packages|apps)\/([^/]+)\//.exec(filePath);
  return match ? `${match[1]}/${match[2]}` : undefined;
}

function tryGit(args, { cwd = WORKSPACE_ROOT } = {}) {
  try {
    return execFileSync('git', args, {
      cwd,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
  } catch {
    return undefined;
  }
}

function refExists(ref, options) {
  return tryGit(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], options) !== undefined;
}

/**
 * Resolve the base ref to diff against. Candidates in priority order: an explicit `--base-ref`
 * argument, `$HARNESS_BASE_REF` (an explicit harness-wide analysis baseline),
 * `origin/$GITHUB_BASE_REF` (PR CI), then `origin/<default>`. Returns the resolved ref, or
 * `undefined` when none resolves — which the caller must treat as a FAILURE, not a pass.
 *
 * No fetch is attempted here (INFRA-048-B/INFRA-050): the only fetch that could help is a full one,
 * and a depth-limited one grafts the history it is trying to supply. Callers check out complete.
 */
export function resolveBaseRef({ argv = process.argv.slice(2), env = process.env, cwd } = {}) {
  const options = { cwd };
  const flagIndex = argv.indexOf('--base-ref');
  const explicit = flagIndex !== -1 ? argv[flagIndex + 1] : undefined;

  const candidates = [];
  if (explicit) candidates.push(explicit);
  const harnessBase = env.HARNESS_BASE_REF?.trim();
  if (harnessBase) candidates.push(harnessBase);
  const prBase = env.GITHUB_BASE_REF?.trim();
  if (prBase) candidates.push(`origin/${prBase}`);
  candidates.push(`origin/${DEFAULT_BASE_BRANCH}`);

  for (const candidate of candidates) {
    if (refExists(candidate, options)) return candidate;
  }
  return undefined;
}

/**
 * Changed files vs `baseRef`. Returns the file list, or `undefined` when the diff itself fails
 * (e.g. shallow history without a reachable merge-base) — distinct from "no changes".
 */
export function getChangedFiles(baseRef, { cwd } = {}) {
  const output = tryGit(['diff', '--name-only', '--diff-filter=ACMR', `${baseRef}...HEAD`], {
    cwd,
  });
  if (output === undefined) return undefined;
  return output
    .split(/\r?\n/)
    .map((filePath) => filePath.trim())
    .filter(Boolean)
    .map(normalizePath);
}

function hasMatchingOwnerDocument(filePath, changedFileSet) {
  const scope = getPackageScope(filePath);
  if (!scope) {
    return false;
  }

  return (
    changedFileSet.has(`${scope}/docs/SPEC.md`) ||
    changedFileSet.has('.agents/specs/ARCHITECTURE-MAP.md') ||
    [...changedFileSet].some((changedFile) =>
      changedFile.startsWith('.agents/specs/architecture-map/'),
    )
  );
}

async function readIfExists(root, relativePath) {
  try {
    return await fs.readFile(path.join(root, relativePath), 'utf8');
  } catch {
    return undefined;
  }
}

/**
 * How many documents the last walk actually READ.
 *
 * Not `changedFiles.length`, which was the first attempt and was wrong in the way this whole
 * invariant exists to expose: that is every diffed path, while this scan examines only the markdown
 * among them that still exists on disk. On a diff of fourteen files carrying one document it
 * declared fourteen — a number larger than the subject, from the input rather than from the walk.
 *
 * A module-level holder rather than a widened return: `findDocumentAuthorityFindings`'s shape is
 * asserted by its own cases (HARNESS-057). RESET at the top of the walk.
 */
let documentsRead = 0;

/** The holder, as a reading seam — so a case can assert the SIZE without re-asserting the findings. */
export function readDocumentsExamined() {
  return documentsRead;
}

export async function findDocumentAuthorityFindings({ root = WORKSPACE_ROOT, changedFiles } = {}) {
  const findings = [];
  documentsRead = 0;
  const normalizedFiles = (changedFiles ?? []).map(normalizePath);
  const changedFileSet = new Set(normalizedFiles);

  for (const file of normalizedFiles) {
    if (!isMarkdown(file)) {
      continue;
    }
    const content = await readIfExists(root, file);
    if (content === undefined) {
      continue;
    }
    documentsRead += 1;

    if (isArchitectureDoc(file) && ARCHITECTURE_PLAN_HEADINGS.test(content)) {
      findings.push({
        file,
        type: 'architecture-doc-plan-content',
        detail:
          'Architecture documents own stable boundaries; move implementation plans, recommendations, and promotion paths to design/task/backlog documents.',
      });
    }

    if (
      isDesignDoc(file) &&
      DESIGN_CONTRACT_HEADINGS.test(content) &&
      !hasMatchingOwnerDocument(file, changedFileSet)
    ) {
      findings.push({
        file,
        type: 'design-contract-without-owner-doc',
        detail:
          'Design documents may explain contracts, but accepted contract authority must also appear in the owner SPEC/API/architecture document.',
      });
    }
  }

  return findings;
}

/** Print the scan result and return the process exit code (exported as the unit-test seam). */
export function reportFindings(findings) {
  if (findings.length === 0) {
    process.stdout.write('document authority scan passed.\n');
    return 0;
  }
  process.stdout.write('document authority scan failed:\n');
  for (const finding of findings) {
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  }
  return 1;
}

export async function main() {
  const baseRef = resolveBaseRef();
  if (baseRef === undefined) {
    process.stdout.write(
      'document authority scan FAILED: no base ref could be resolved ' +
        '(tried --base-ref, $HARNESS_BASE_REF, origin/$GITHUB_BASE_REF, origin/develop). ' +
        'This gate cannot report a pass it did not compute — an unresolvable base used to exit 0 ' +
        'and silently stop enforcing (INFRA-048). Check out with full history ' +
        '(`fetch-depth: 0`) or pass `--base-ref <ref>`.\n',
    );
    process.exitCode = 1;
    return;
  }

  const changedFiles = getChangedFiles(baseRef);
  if (changedFiles === undefined) {
    process.stdout.write(
      `document authority scan FAILED: git diff against ${baseRef} failed ` +
        '(no reachable merge-base in this checkout). This gate cannot report a pass it did not ' +
        'compute (INFRA-048). Check out with full history (`fetch-depth: 0`) or pass a reachable ' +
        '`--base-ref <ref>`.\n',
    );
    process.exitCode = 1;
    return;
  }

  // At the call site, where the subject is in hand. `reportFindings` is a pinned unit-test seam and
  // its contract is the verdict lines; the marker is a channel the runner reads, so folding it in
  // there would make a suite-wide invariant into a change to a sentence a case asserts.
  const findings = await findDocumentAuthorityFindings({ changedFiles });

  // AFTER the walk, because the number comes from the walk. A zero here is legitimate and must say
  // so: this scan judges the diff, and a diff carrying no document is a correct empty subject rather
  // than a sweep that found nothing. Undeclared, the runner fails the suite for it — the invariant
  // working — and the declaration is what tells the two apart.
  //
  // Emitted at the call site rather than inside `reportFindings`, which is a pinned unit-test seam
  // whose contract is the verdict lines. A verdict is prose for a human; this is a channel the
  // runner reads.
  process.stdout.write(
    documentsRead === 0
      ? '::examined:: 0 changed documents ::expected-empty:: this diff changes no markdown document that exists on disk — the subject is the diff, not the tree\n'
      : `::examined:: ${documentsRead} changed documents\n`,
  );

  process.exitCode = reportFindings(findings);
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  void main();
}
