#!/usr/bin/env node
/**
 * HOOK-007 User Execution Test Scenario
 *
 * Demonstrates that:
 *   1. A hook with explicit timeout: 1 times out when command takes 2s
 *   2. A hook with explicit timeout: 5 succeeds when command takes 2s
 *   3. The default timeout is 600s (verified by reading the constant)
 *
 * Usage: node scripts/examples/hook-timeout-demo.mjs
 */

import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runHooks } from '../../packages/agent-core/dist/node/index.js';

const ROOT = resolve(import.meta.dirname, '../..');
const EXECUTOR_SRC = `${ROOT}/packages/agent-core/src/hooks/executors/command-executor.ts`;

const PASS = 'YES ✓';
const FAIL = 'NO ✗';

let allPassed = true;

function check(label, condition) {
  const result = condition ? PASS : FAIL;
  if (!condition) allPassed = false;
  console.log(`  ${label}: ${result}`);
}

// ── Part 0: verify DEFAULT_TIMEOUT_SECONDS = 600 in source ───────────────────
console.log('\n=== Part 0: DEFAULT_TIMEOUT_SECONDS = 600 in source ===\n');

const src = readFileSync(EXECUTOR_SRC, 'utf8');
const match = src.match(/DEFAULT_TIMEOUT_SECONDS\s*=\s*(\d+)/);
const defaultTimeout = match ? Number(match[1]) : null;

console.log(`  command-executor.ts DEFAULT_TIMEOUT_SECONDS = ${defaultTimeout}`);
check('DEFAULT_TIMEOUT_SECONDS === 600', defaultTimeout === 600);

// ── Part 1: timeout: 1 → command taking 2s times out ─────────────────────────
console.log('\n=== Part 1: timeout:1 + 2s command → hook times out ===\n');

const hooksTimedOut = {
  PreToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'sleep 2', timeout: 1 }],
    },
  ],
};

const t1start = Date.now();
const s1result = await runHooks(hooksTimedOut, 'PreToolUse', {
  session_id: 'demo',
  cwd: process.cwd(),
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
});
const t1elapsed = Date.now() - t1start;

console.log(`  elapsed: ${t1elapsed}ms`);
console.log('  runHooks result:', JSON.stringify(s1result, null, 2));
check(
  'blocked === false (timeout = non-blocking exit code 1, not exit 2)',
  s1result.blocked === false,
);
check('completed in ~1s (not 2s)', t1elapsed < 1800);

// ── Part 2: timeout: 5 → command taking 2s succeeds ──────────────────────────
console.log('\n=== Part 2: timeout:5 + 2s command → hook succeeds ===\n');

const hooksOk = {
  PreToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'sleep 2 && echo "hook completed"', timeout: 5 }],
    },
  ],
};

const t2start = Date.now();
const s2result = await runHooks(hooksOk, 'PreToolUse', {
  session_id: 'demo',
  cwd: process.cwd(),
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
});
const t2elapsed = Date.now() - t2start;

console.log(`  elapsed: ${t2elapsed}ms`);
console.log('  runHooks result:', JSON.stringify(s2result, null, 2));
check('blocked === false', s2result.blocked === false);
check('stdout contains "hook completed"', s2result.stdout.includes('hook completed'));
check('completed in ~2s (not timed out)', t2elapsed >= 1800 && t2elapsed < 4000);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
if (allPassed) {
  console.log('PASS — HOOK-007 timeout behavior is correctly implemented.');
  process.exit(0);
} else {
  console.log('FAIL — one or more checks did not pass.');
  process.exit(1);
}
