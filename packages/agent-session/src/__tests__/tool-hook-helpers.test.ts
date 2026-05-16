/**
 * Unit tests for tool-hook-helpers.ts
 *
 * HOOK-003 User Execution Test Scenario:
 * Verifies that runPreToolHook returns { blocked: true, reason: "..." }
 * (not { success: false, error: "Blocked by hook: ..." }) when a PreToolUse
 * hook exits with code 2.
 */

import { describe, it, expect, vi } from 'vitest';
import { runPreToolHook, buildHookInput, truncateToolResult } from '../tool-hook-helpers.js';
import type { IHookInput, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type { THooksConfig } from '@robota-sdk/agent-core';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeHookInput(toolName = 'bash'): IHookInput {
  return {
    session_id: 'test-session',
    cwd: '/tmp',
    hook_event_name: 'PreToolUse',
    tool_name: toolName,
    tool_input: { command: 'rm -rf /' },
  };
}

function makeMockExecutor(exitCode: number, stderr = '', stdout = ''): IHookTypeExecutor {
  return {
    type: 'command',
    execute: vi.fn().mockResolvedValue({ exitCode, stdout, stderr }),
  };
}

const baseConfig: THooksConfig = {
  PreToolUse: [
    {
      matcher: '',
      hooks: [{ type: 'command', command: 'echo "test"' }],
    },
  ],
};

// ---------------------------------------------------------------------------
// HOOK-003 core scenario: exit code 2 → blocked tool result format
// ---------------------------------------------------------------------------

describe('runPreToolHook — HOOK-003 blocked format', () => {
  it('returns { blocked: true, reason } when hook exits with code 2', async () => {
    const executor = makeMockExecutor(2, 'Denied: dangerous tool');
    const input = makeHookInput('bash');

    const result = await runPreToolHook(baseConfig, input, [executor]);

    // Must return a non-null IToolResult (signals block to PermissionEnforcer)
    expect(result).not.toBeNull();
    expect(result).not.toBeUndefined();

    // The data must be JSON-parseable
    const data = JSON.parse(result!.data as string) as Record<string, unknown>;

    // HOOK-003: new format — { blocked: true, reason: "..." }
    expect(data['blocked']).toBe(true);
    expect(typeof data['reason']).toBe('string');
    expect(data['reason']).toContain('Denied: dangerous tool');

    // HOOK-003: old format must NOT be present
    expect(data).not.toHaveProperty('success');
    expect(data).not.toHaveProperty('error');
    expect(data).not.toHaveProperty('output');
  });

  it('uses "Blocked by hook" as reason fallback when stderr is empty', async () => {
    const executor = makeMockExecutor(2, '' /* empty stderr */);
    const input = makeHookInput('write');

    const result = await runPreToolHook(baseConfig, input, [executor]);
    expect(result).not.toBeNull();

    const data = JSON.parse(result!.data as string) as Record<string, unknown>;
    expect(data['blocked']).toBe(true);
    expect(data['reason']).toBe('Blocked by hook');
  });

  it('returns null (proceed) when hook exits with code 0', async () => {
    const executor = makeMockExecutor(0, '', 'all good');
    const input = makeHookInput('read');

    const result = await runPreToolHook(baseConfig, input, [executor]);
    expect(result).toBeNull();
  });

  it('returns null when hooks config is undefined', async () => {
    const input = makeHookInput('bash');
    const result = await runPreToolHook(undefined, input, []);
    expect(result).toBeNull();
  });

  it('returned IToolResult has success: true so PermissionEnforcer records the result in history', async () => {
    // Option B design: tool result IS added to history (AI sees the block signal)
    const executor = makeMockExecutor(2, 'Access denied');
    const input = makeHookInput('bash');

    const result = await runPreToolHook(baseConfig, input, [executor]);
    expect(result).not.toBeNull();
    expect(result!.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// buildHookInput helper
// ---------------------------------------------------------------------------

describe('buildHookInput', () => {
  it('builds a complete IHookInput with all required fields', () => {
    const hi = buildHookInput('sess-1', '/home/user', 'bash', { command: 'ls' }, 'default');
    expect(hi.session_id).toBe('sess-1');
    expect(hi.cwd).toBe('/home/user');
    expect(hi.hook_event_name).toBe('PreToolUse');
    expect(hi.tool_name).toBe('bash');
    expect(hi.permission_mode).toBe('default');
  });

  it('omits permission_mode when not provided', () => {
    const hi = buildHookInput('s', '/t', 'read', {});
    expect(hi).not.toHaveProperty('permission_mode');
  });
});

// ---------------------------------------------------------------------------
// truncateToolResult helper
// ---------------------------------------------------------------------------

describe('truncateToolResult', () => {
  it('returns the result unchanged when data is within limit', () => {
    const result = { success: true, data: 'short data', metadata: {} };
    const out = truncateToolResult(result);
    expect(out.data).toBe('short data');
  });

  it('truncates in the middle when data exceeds MAX_TOOL_OUTPUT_CHARS', () => {
    // MAX_TOOL_OUTPUT_CHARS = 100_000 (from permission-types.ts)
    const bigData = 'A'.repeat(110_000);
    const result = { success: true, data: bigData, metadata: {} };
    const out = truncateToolResult(result);
    expect(typeof out.data).toBe('string');
    expect((out.data as string).length).toBeLessThan(bigData.length);
    expect(out.data as string).toContain('truncated');
  });

  it('passes through non-string data unchanged', () => {
    const result = { success: true, data: 42 as unknown as string, metadata: {} };
    const out = truncateToolResult(result);
    expect(out.data).toBe(42);
  });
});
