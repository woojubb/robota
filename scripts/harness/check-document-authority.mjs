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
 * 2. `origin/$GITHUB_BASE_REF` (PR events).
 * 3. `origin/develop` (default).
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
import { pathToFileURL } from 'node:url';

const WORKSPACE_ROOT = process.cwd();
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
  return (
    filePath.startsWith('.design/') ||
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
 * argument, `origin/$GITHUB_BASE_REF` (PR CI), then `origin/<default>`. Returns the resolved ref,
 * or `undefined` when none resolves — which the caller must treat as a FAILURE, not a pass.
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

export async function findDocumentAuthorityFindings({ root = WORKSPACE_ROOT, changedFiles } = {}) {
  const findings = [];
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
        '(tried --base-ref, origin/$GITHUB_BASE_REF, origin/develop). ' +
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

  const findings = await findDocumentAuthorityFindings({ changedFiles });
  process.exitCode = reportFindings(findings);
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main();
}
