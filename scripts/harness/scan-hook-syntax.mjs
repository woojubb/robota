#!/usr/bin/env node

/**
 * Hook SYNTAX floor — a hook that no longer parses disarms every guard that sources it.
 *
 * `scan-hook-registration.mjs` proves a hook is wired; nothing proved it still parses. Four
 * outages in session 50cb28dd (2026-07-28/30/31, 08-01) came from live edits that left
 * `lib/command-scan.sh` and `worktree-cwd-guard.sh` syntactically broken. A hook that cannot
 * run exits 127, and the hook protocol treats a non-2 exit as PASS — so the failure mode is
 * silent: four PreToolUse Bash guards go quiet at once and every command sails through.
 *
 * `lib/` is deliberately included. `scan-hook-registration.mjs` excludes it because helpers are
 * not registered to events, but they are sourced by four guards, which makes them the highest
 * blast-radius files in the directory.
 *
 * Usage: `node scripts/harness/scan-hook-syntax.mjs`
 * Exit 0 = clean, 1 = blocking findings.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import path from 'node:path';

const WORKSPACE_ROOT = path.resolve(import.meta.dirname, '../..');
const HOOKS_DIR = path.join(WORKSPACE_ROOT, '.claude/hooks');

function shellScripts(dir) {
  if (!existsSync(dir)) return [];
  const out = [];
  for (const name of readdirSync(dir)) {
    const full = path.join(dir, name);
    if (statSync(full).isDirectory()) out.push(...shellScripts(full));
    else if (name.endsWith('.sh')) out.push(full);
  }
  return out.sort();
}

export function collectHookSyntaxFindings() {
  const scripts = shellScripts(HOOKS_DIR);
  const broken = [];

  for (const file of scripts) {
    try {
      execFileSync('bash', ['-n', file], { stdio: ['ignore', 'ignore', 'pipe'] });
    } catch (error) {
      broken.push({
        file: path.relative(WORKSPACE_ROOT, file),
        err: String(error.stderr ?? '').trim(),
      });
    }
  }

  if (broken.length > 0) {
    console.error('[hook-syntax] blocking findings:\n');
    for (const b of broken) {
      console.error(`  - ${b.file} does not parse. Every guard that sources it is disarmed —`);
      console.error(`    a hook that cannot run exits 127, which the protocol treats as PASS.`);
      for (const line of b.err.split('\n').slice(0, 4)) console.error(`      ${line}`);
      console.error('');
    }
    process.exitCode = 1;
    return broken;
  }

  console.log(`[hook-syntax] clean — ${scripts.length} shell scripts parse.`);

  return broken;
}

function main() {
  collectHookSyntaxFindings();
}

if (path.resolve(process.argv[1] ?? '') === path.resolve(import.meta.filename)) {
  main();
}
