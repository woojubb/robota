#!/usr/bin/env node

/**
 * Done-backlog evidence regression scan (HARNESS-002).
 *
 * Done evidence decayed silently: CLI-033's headless E2E files vanished,
 * CLI-042's parallelization was reverted, CLI-046's flag was never threaded,
 * REL-003 sat done while its stub survived. The done gate validates once at
 * completion time; this scan re-validates the durable-artifact layer forever:
 * every repo-file path referenced in `.agents/backlog/completed/*.md` must
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

import { envWithoutGitVars } from './shared.mjs';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const COMPLETED_DIR = '.agents/backlog/completed';

/** Repo-file reference: packages/|apps/|scripts/ root, a file extension, no globs. */
const PATH_PATTERN = /(?:^|[\s`("'[])((?:packages|apps|scripts)\/[A-Za-z0-9_\-./]+\.[A-Za-z0-9]+)/g;
const SUPERSEDED_PATTERN = /<!--\s*evidence-superseded:\s*(.+?)\s*-->/;
/** A heading or list/bold lead-in that opens an evidence region. */
const EVIDENCE_START_PATTERN = /^(#{1,6}\s.*evidence|[-*]\s+\**evidence|\*\*evidence)/i;
const HEADING_PATTERN = /^#{1,6}\s/;

function extractCandidates(line) {
  const candidates = [];
  for (const match of line.matchAll(PATH_PATTERN)) {
    const candidate = match[1];
    if (candidate.includes('*') || candidate.includes('..')) continue;
    candidates.push(candidate);
  }
  return candidates;
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
      const supersededHere =
        SUPERSEDED_PATTERN.exec(lines[i]) ?? (i > 0 ? SUPERSEDED_PATTERN.exec(lines[i - 1]) : null);

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
