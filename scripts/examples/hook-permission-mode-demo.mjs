#!/usr/bin/env node
/**
 * HOOK-004 User Execution Test Scenario
 *
 * Demonstrates that permission_mode is now included in hook stdin JSON.
 * Hook scripts written for Claude Code that read permission_mode from stdin
 * now receive the correct value.
 *
 * Scenarios:
 *   1. permission_mode: "default" → hook script receives "default" in stdin
 *   2. permission_mode: "bypassPermissions" → hook script receives the override value
 *
 * Usage: node scripts/examples/hook-permission-mode-demo.mjs
 */

import { runHooks } from '../../packages/agent-core/dist/node/index.js';

const READ_PERMISSION_MODE = `node -e "let d=''; process.stdin.on('data',c=>d+=c); process.stdin.on('end',()=>{ const p=JSON.parse(d); console.log(p.permission_mode ?? 'MISSING'); });"`;

const PASS = 'YES ✓';
const FAIL = 'NO ✗';
let allPassed = true;

function check(label, condition) {
  const result = condition ? PASS : FAIL;
  if (!condition) allPassed = false;
  console.log(`  ${label}: ${result}`);
}

// ── Scenario 1: permission_mode: "default" ────────────────────────────────────
console.log('\n=== Scenario 1: permission_mode "default" delivered to hook stdin ===\n');

const hooksDefault = {
  PreToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: READ_PERMISSION_MODE, timeout: 5 }],
    },
  ],
};

const r1 = await runHooks(hooksDefault, 'PreToolUse', {
  session_id: 'demo',
  cwd: process.cwd(),
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
  permission_mode: 'default',
});

console.log(`  hook stdout: ${JSON.stringify(r1.stdout.trim())}`);
check('hook receives "default"', r1.stdout.trim() === 'default');
check('not blocked', r1.blocked === false);

// ── Scenario 2: permission_mode: "bypassPermissions" ─────────────────────────
console.log('\n=== Scenario 2: permission_mode "bypassPermissions" delivered to hook stdin ===\n');

const hooksBypass = {
  PreToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: READ_PERMISSION_MODE, timeout: 5 }],
    },
  ],
};

const r2 = await runHooks(hooksBypass, 'PreToolUse', {
  session_id: 'demo',
  cwd: process.cwd(),
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
  permission_mode: 'bypassPermissions',
});

console.log(`  hook stdout: ${JSON.stringify(r2.stdout.trim())}`);
check('hook receives "bypassPermissions"', r2.stdout.trim() === 'bypassPermissions');
check('not blocked', r2.blocked === false);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
if (allPassed) {
  console.log('PASS — HOOK-004 permission_mode field is correctly delivered to hook scripts.');
  process.exit(0);
} else {
  console.log('FAIL — one or more scenarios did not pass.');
  process.exit(1);
}
