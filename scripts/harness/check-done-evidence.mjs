#!/usr/bin/env node

/**
 * Done-backlog evidence regression scan (HARNESS-002).
 *
 * Done evidence decayed silently: CLI-033's headless E2E files vanished,
 * CLI-042's parallelization was reverted, CLI-046's flag was never threaded,
 * REL-003 sat done while its stub survived. The done gate validates once at
 * completion time; this scan re-validates the durable-artifact layer forever:
 * every repo-file path referenced in `.agents/tasks/completed/*.md` must
 * still exist, or carry an explicit `<!-- evidence-superseded: <reason> -->`
 * annotation (same line or the line directly above the reference).
 *
 * Exit code 0 = all references resolve (exemptions reported), 1 = stale
 * references found.
 */

import { execFileSync } from 'node:child_process';
import fsSync from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';

import { NO_VOCABULARY, REPO_FILE_PATH_PATTERN, citedRepoPaths } from './cited-paths.mjs';
import { envWithoutGitVars, resolveWorkspaceRoot } from './shared.mjs';
import { requireGovernedTree } from './governed-tree.mjs';

const WORKSPACE_ROOT = resolveWorkspaceRoot(import.meta);
const COMPLETED_DIR = '.agents/tasks/completed';

/**
 * Repo-file reference: packages/|apps/|scripts/ root, a file extension, no globs.
 *
 * HARNESS-062 moved the definition to `cited-paths.mjs`, which owns every "a path cited in prose
 * must exist" pattern. It is re-exported under the original name because `scan-unearned-done-claims`
 * already imports it from here — one owner, unchanged consumers.
 */
export const PATH_PATTERN = REPO_FILE_PATH_PATTERN;
const SUPERSEDED_PATTERN = /<!--\s*evidence-superseded:\s*(.+?)\s*-->/;
/** A heading or list/bold lead-in that opens an evidence region. */
const EVIDENCE_START_PATTERN = /^(#{1,6}\s.*evidence|[-*]\s+\**evidence|\*\*evidence)/i;
const HEADING_PATTERN = /^#{1,6}\s/;

/**
 * This scan exempts NOTHING on prose (`NO_VOCABULARY`): its exemption is the explicit
 * `evidence-superseded` annotation, which names a reason. A done item claiming an artifact must
 * point at one, and "the file no longer exists" is the claim being audited, not a defence of it.
 */
function extractCandidates(line) {
  return citedRepoPaths(line, { pattern: PATH_PATTERN, vocabulary: NO_VOCABULARY });
}

/**
 * INFRA-026: durable artifacts are GIT-TRACKED files, not filesystem entries — fs.access
 * passed locally for build outputs (dist/) and secret files (.env) that do not exist in a
 * CI checkout, so the scan was green locally and red in CI the moment it was wired there.
 * Falls back to fs existence when git is unavailable (fixture roots in unit tests).
 */
let trackedFilesCache = null;
function pathExists(root, relativePath) {
  if (trackedFilesCache === null) {
    try {
      const output = execFileSync('git', ['-C', root, 'ls-files'], {
        encoding: 'utf8',
        maxBuffer: 64 * 1024 * 1024,
        // Strip hook-inherited GIT_DIR/GIT_INDEX_FILE etc. — under a git hook they redirect this call
        // to the hook's repository regardless of `-C root`, listing the WRONG repo (see shared.mjs
        // envWithoutGitVars).
        env: envWithoutGitVars(),
      });
      trackedFilesCache = new Set(output.split('\n').filter(Boolean));
    } catch {
      trackedFilesCache = false; // not a git checkout — fall back to fs existence
    }
  }
  if (trackedFilesCache !== false) {
    return trackedFilesCache.has(relativePath);
  }
  try {
    fsSync.accessSync(path.join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function findDoneEvidenceFindings(root = WORKSPACE_ROOT) {
  requireGovernedTree(root, [COMPLETED_DIR], {
    scan: 'done-evidence',
    why: 'The completed-backlog tree is the evidence corpus; a readdir failure was swallowed and returned as "no unearned done claims".',
  });
  const findings = [];
  const exemptions = [];
  const completedAbsolute = path.join(root, COMPLETED_DIR);

  let entries = [];
  try {
    entries = await fs.readdir(completedAbsolute);
  } catch {
    return { findings, exemptions };
  }

  for (const entry of entries.filter((name) => name.endsWith('.md')).sort()) {
    const backlogFile = path.join(COMPLETED_DIR, entry);
    const content = await fs.readFile(path.join(root, backlogFile), 'utf8');
    const lines = content.split('\n');

    // Only EVIDENCE regions are validated (the durable-artifact rule covers
    // evidence claims; Problem/Plan prose legitimately cites historical paths
    // that later refactors moved). A region opens at an evidence heading or
    // an "Evidence"-led list/bold line and closes at the next heading.
    let inEvidence = false;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (EVIDENCE_START_PATTERN.test(line.trim())) {
        inEvidence = true;
      } else if (HEADING_PATTERN.test(line)) {
        inEvidence = /evidence/i.test(line);
      }
      if (!inEvidence) continue;
      const candidates = extractCandidates(lines[i]);
      if (candidates.length === 0) continue;
      // Same line, or the nearest line above it that is not blank.
      //
      // Adjacency alone was too strict, and the thing that broke it was this repository's OWN
      // formatter: prettier surrounds an HTML comment with blank lines, so a `<!-- evidence-superseded
      // -->` written directly above its reference is silently detached the next time the file is
      // formatted. Measured during PROC-006, when a bulk reformat detached one of the twelve
      // annotations and the scan reported a stale reference that had been correctly suppressed for
      // months. The other eleven survived only because nothing had reformatted their files yet.
      //
      // A suppression the formatter can quietly remove is not a suppression. Blank lines are skipped;
      // any other content still ends the association, so an annotation cannot drift up a list and
      // start excusing a reference it was never written for.
      let supersededHere = SUPERSEDED_PATTERN.exec(lines[i]);
      for (let j = i - 1; !supersededHere && j >= 0; j -= 1) {
        if (lines[j].trim() === '') continue;
        supersededHere = SUPERSEDED_PATTERN.exec(lines[j]);
        break;
      }

      for (const candidate of candidates) {
        if (pathExists(root, candidate)) continue;
        if (supersededHere) {
          exemptions.push({ backlogFile, path: candidate, reason: supersededHere[1] });
          continue;
        }
        findings.push({ backlogFile, path: candidate, line: i + 1 });
      }
    }
  }

  return { findings, exemptions };
}

export async function main() {
  const { findings, exemptions } = await findDoneEvidenceFindings(WORKSPACE_ROOT);

  for (const exemption of exemptions) {
    process.stdout.write(
      `  superseded: ${exemption.backlogFile} → ${exemption.path} — ${exemption.reason}\n`,
    );
  }

  if (findings.length === 0) {
    process.stdout.write(
      `done-evidence scan passed${exemptions.length > 0 ? ` (${exemptions.length} superseded reference(s))` : ''}.\n`,
    );
    return;
  }

  process.stdout.write('done-evidence scan failed — stale evidence references:\n');
  for (const finding of findings) {
    process.stdout.write(`  - ${finding.backlogFile}:${finding.line} → ${finding.path}\n`);
  }
  process.stdout.write(
    'Restore the referenced file or annotate the reference with <!-- evidence-superseded: <reason> -->.\n',
  );
  process.exitCode = 1;
}

const isDirectExecution =
  process.argv[1] !== undefined &&
  path.resolve(process.argv[1]) === path.resolve(import.meta.filename);
if (isDirectExecution) {
  await main();
}
