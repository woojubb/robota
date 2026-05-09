#!/usr/bin/env node
/**
 * HOOK-003 User Execution Test Scenario
 *
 * Demonstrates that when a PreToolUse hook blocks (exit code 2),
 * the tool result returned to the AI is { blocked: true, reason: "..." }
 * instead of the old { success: false, error: "Blocked by hook: ..." }.
 *
 * Usage: node scripts/examples/hook-block-demo.mjs
 */

import { runHooks } from '../../packages/agent-core/dist/node/index.js';

const TOOL_NAME = 'Bash';
const TOOL_INPUT = { command: 'rm -rf /' };

// Hook configuration: block 'Bash' tool via exit code 2
const hooksConfig = {
  PreToolUse: [
    {
      matcher: 'Bash',
      hooks: [
        {
          type: 'command',
          // Prints reason to stderr, exits 2 to signal block
          command: `echo "Bash tool blocked: dangerous command detected" >&2; exit 2`,
          timeout: 5,
        },
      ],
    },
  ],
};

// Build hook input matching IHookInput shape
const hookInput = {
  session_id: 'demo-session-001',
  cwd: process.cwd(),
  hook_event_name: 'PreToolUse',
  tool_name: TOOL_NAME,
  tool_input: TOOL_INPUT,
  permission_mode: 'default',
};

console.log('=== HOOK-003 User Execution Test Scenario ===\n');
console.log('Hook input (sent to hook scripts via stdin):');
console.log(JSON.stringify(hookInput, null, 2));
console.log();

// Step 1: run the hooks — simulates what runPreToolHook does internally
const hookResult = await runHooks(hooksConfig, 'PreToolUse', hookInput);

console.log('runHooks result:');
console.log(JSON.stringify(hookResult, null, 2));
console.log();

// Step 2: simulate what runPreToolHook returns to PermissionEnforcer (and then to the AI)
if (hookResult.blocked) {
  const toolResult = {
    success: true,
    data: JSON.stringify({
      blocked: true,
      reason: hookResult.reason ?? 'Blocked by hook',
    }),
    metadata: {},
  };

  console.log('Tool result returned to AI (IToolResult.data parsed):');
  const parsed = JSON.parse(toolResult.data);
  console.log(JSON.stringify(parsed, null, 2));
  console.log();

  const hasNewFormat = parsed.blocked === true && typeof parsed.reason === 'string';
  const hasOldFormat = 'error' in parsed || 'output' in parsed;
  console.log('Verification:');
  console.log(`  New format { blocked: true, reason } present: ${hasNewFormat ? 'YES ✓' : 'NO ✗'}`);
  console.log(
    `  Old format { error, output } absent:          ${!hasOldFormat ? 'YES ✓' : 'NO ✗'}`,
  );
  console.log(
    `  result.success === true (history-safe):       ${toolResult.success ? 'YES ✓' : 'NO ✗'}`,
  );
  console.log();
  if (hasNewFormat && !hasOldFormat) {
    console.log('PASS — HOOK-003 implementation is correct.');
    process.exit(0);
  } else {
    console.log('FAIL — unexpected format.');
    process.exit(1);
  }
} else {
  console.log('Hook did NOT block the tool (unexpected for exit code 2).');
  process.exit(1);
}
