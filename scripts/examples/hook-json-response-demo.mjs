#!/usr/bin/env node
/**
 * HOOK-006 User Execution Test Scenario
 *
 * Demonstrates that hook scripts can now return JSON via stdout to control
 * behavior — previously stdout was collected as raw text only.
 *
 * Scenarios:
 *   1. { "continue": false, "stopReason": "..." } → blocks the hook event
 *   2. PreToolUse { "hookSpecificOutput": { "permissionDecision": "deny" } } → blocks tool
 *   3. { "systemMessage": "..." } → injected into AI context via stdout
 *
 * Usage: node scripts/examples/hook-json-response-demo.mjs
 */

import { runHooks } from '../../packages/agent-core/dist/node/index.js';

const PASS = 'YES ✓';
const FAIL = 'NO ✗';

let allPassed = true;

function check(label, condition) {
  const result = condition ? PASS : FAIL;
  if (!condition) allPassed = false;
  console.log(`  ${label}: ${result}`);
}

// ── Scenario 1: continue: false blocks any event ──────────────────────────────
console.log('\n=== Scenario 1: { continue: false } blocks the hook event ===\n');

const hooksStopAll = {
  UserPromptSubmit: [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `echo '{"continue": false, "stopReason": "Security policy violation"}'`,
          timeout: 5,
        },
      ],
    },
  ],
};

const s1result = await runHooks(hooksStopAll, 'UserPromptSubmit', {
  session_id: 'demo',
  cwd: process.cwd(),
  hook_event_name: 'UserPromptSubmit',
  prompt: 'hello',
});

console.log('runHooks result:', JSON.stringify(s1result, null, 2));
check('blocked === true', s1result.blocked === true);
check('reason contains stopReason text', s1result.reason?.includes('Security policy violation'));

// ── Scenario 2: permissionDecision: deny (PreToolUse JSON) ────────────────────
console.log('\n=== Scenario 2: permissionDecision: deny blocks PreToolUse ===\n');

const hooksDenyJson = {
  PreToolUse: [
    {
      matcher: 'Bash',
      hooks: [
        {
          type: 'command',
          command: `echo '{"hookSpecificOutput": {"permissionDecision": "deny"}}'`,
          timeout: 5,
        },
      ],
    },
  ],
};

const s2result = await runHooks(hooksDenyJson, 'PreToolUse', {
  session_id: 'demo',
  cwd: process.cwd(),
  hook_event_name: 'PreToolUse',
  tool_name: 'Bash',
  tool_input: { command: 'echo hello' },
});

console.log('runHooks result:', JSON.stringify(s2result, null, 2));
check('blocked === true', s2result.blocked === true);
check('permissionDecision === "deny"', s2result.permissionDecision === 'deny');

// ── Scenario 3: systemMessage → injected into stdout ──────────────────────────
console.log('\n=== Scenario 3: systemMessage injected into stdout for AI context ===\n');

const hooksSystemMsg = {
  UserPromptSubmit: [
    {
      matcher: '',
      hooks: [
        {
          type: 'command',
          command: `echo '{"systemMessage": "User has elevated permissions today."}'`,
          timeout: 5,
        },
      ],
    },
  ],
};

const s3result = await runHooks(hooksSystemMsg, 'UserPromptSubmit', {
  session_id: 'demo',
  cwd: process.cwd(),
  hook_event_name: 'UserPromptSubmit',
  prompt: 'hello',
});

console.log('runHooks result:', JSON.stringify(s3result, null, 2));
check('blocked === false', s3result.blocked === false);
check(
  'stdout contains systemMessage text',
  s3result.stdout?.includes('User has elevated permissions today.'),
);

// ── Summary ───────────────────────────────────────────────────────────────────
console.log();
if (allPassed) {
  console.log('PASS — HOOK-006 JSON response parsing is correctly implemented.');
  process.exit(0);
} else {
  console.log('FAIL — one or more scenarios did not pass.');
  process.exit(1);
}
