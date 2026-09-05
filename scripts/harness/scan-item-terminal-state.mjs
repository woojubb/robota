#!/usr/bin/env node

/** Find aged in-progress Tasks whose cited delivery is already merged. */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import {
  changedPathsOf,
  citesWorkItem,
  mergedCommits,
  mergedRef,
  openTaskRecords,
} from './scan-task-merged-citation.mjs';
import { asScalar, frontmatterObject } from './frontmatter.mjs';
import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const EXAMINED = ['::', 'examined::'].join('');
export const AGE_DAYS = 7;
export const LEGACY_BASELINE = 'scripts/harness/item-terminal-state-legacy-baseline.json';

function legacyIds(root) {
  const file = path.join(root, LEGACY_BASELINE);
  return existsSync(file)
    ? new Set(JSON.parse(readFileSync(file, 'utf8')).reconcilePending ?? [])
    : new Set();
}

function ageDays(root, record) {
  const created = asScalar(
    frontmatterObject(readFileSync(path.join(root, record.file), 'utf8')).created,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(created)) return null;
  return (Date.now() - Date.parse(`${created}T00:00:00Z`)) / 86400000;
}

export function findTerminalStateFindings(workspaceRoot = ROOT, io = {}) {
  const root = workspaceRoot;
  const ref = io.ref ?? mergedRef(root);
  const commits = io.commits ?? mergedCommits(root, ref);
  const changedPaths = io.changedPaths ?? ((sha) => changedPathsOf(root, sha));
  const legacy = io.legacy ?? legacyIds(root);
  return openTaskRecords(root)
    .filter(
      (record) =>
        record.status === 'in-progress' &&
        (io.ageDays?.(record) ?? ageDays(root, record)) >= AGE_DAYS,
    )
    .flatMap((record) => {
      const deliveries = commits.filter(
        (commit) =>
          citesWorkItem(commit.subject, record.id) &&
          changedPaths(commit.sha).some((file) => !file.startsWith('.agents/')),
      );
      if (deliveries.length === 0 || legacy.has(record.id)) return [];
      return [
        {
          file: record.file,
          type: 'item-terminal-state',
          detail: `${record.id} remains in-progress after ${Math.floor(io.ageDays?.(record) ?? ageDays(root, record))} day(s) and ${deliveries.length} merged delivery citation(s); reconcile Task, Issue closure, and archival state`,
        },
      ];
    });
}

export function main() {
  const findings = findTerminalStateFindings();
  process.stdout.write(`${EXAMINED} ${openTaskRecords(ROOT).length} terminal-state candidate(s)\n`);
  if (findings.length === 0) {
    process.stdout.write('item-terminal-state scan passed.\n');
    return 0;
  }
  process.stdout.write('item-terminal-state scan failed:\n');
  for (const finding of findings)
    process.stdout.write(`- [${finding.type}] ${finding.file}: ${finding.detail}\n`);
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
