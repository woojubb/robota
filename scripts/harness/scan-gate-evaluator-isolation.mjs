#!/usr/bin/env node

/**
 * Refuses a change that edits a gate evaluator and records evaluated gate evidence in the same diff.
 * The evaluator must be fixed in a separate item so its verdict is not self-authored.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { resolveWorkspaceRoot } from './shared.mjs';

const ROOT = resolveWorkspaceRoot(import.meta);
const EXAMINED = ['::', 'examined::'].join('');
const EVALUATOR_PREFIXES = ['scripts/harness/gate.mjs', '.claude/hooks/'];
const SPEC_PREFIX = '.agents/spec-docs/';

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });
  if (result.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${result.stderr.trim()}`);
  return result.stdout.split('\n').filter(Boolean);
}

export function changedPaths(base = process.env.HARNESS_BASE_REF ?? 'origin/develop') {
  return git(['diff', '--name-only', `${base}...HEAD`]);
}

export function evaluatorIsolationFindings(paths) {
  const evaluatorChanges = paths.filter((file) =>
    EVALUATOR_PREFIXES.some((prefix) => file === prefix || file.startsWith(prefix)),
  );
  const evidenceChanges = paths.filter((file) => file.startsWith(SPEC_PREFIX));
  if (evaluatorChanges.length === 0 || evidenceChanges.length === 0) return [];
  return [
    {
      type: 'gate-evaluator-isolation',
      detail:
        `gate evaluator change(s) ${evaluatorChanges.join(', ')} share a diff with gate evidence ` +
        `${evidenceChanges.join(', ')}; file the evaluator defect as a separate item`,
    },
  ];
}

export function main() {
  const paths = changedPaths();
  const findings = evaluatorIsolationFindings(paths);
  process.stdout.write(`${EXAMINED} ${paths.length} changed path(s)\n`);
  if (findings.length === 0) {
    process.stdout.write('gate-evaluator-isolation scan passed.\n');
    return 0;
  }
  process.stdout.write('gate-evaluator-isolation scan failed:\n');
  for (const finding of findings) process.stdout.write(`- [${finding.type}] ${finding.detail}\n`);
  return 1;
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename))
  process.exitCode = main();
