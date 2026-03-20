/**
 * Tests for BashTool
 */

import { describe, it, expect } from 'vitest';
import { bashTool } from '@robota-sdk/agent-tools';
import type { TToolResult } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '@robota-sdk/agent-core';

async function run(params: TToolParameters): Promise<TToolResult> {
  const rawResult = await bashTool.execute(params);
  // rawResult.data is the JSON string returned by the handler
  return JSON.parse(rawResult.data as string) as TToolResult;
}

describe('BashTool', () => {
  it('executes a simple command and returns stdout', async () => {
    const result = await run({ command: 'echo hello' });
    expect(result.success).toBe(true);
    expect(result.output.trim()).toContain('hello');
    expect(result.exitCode).toBe(0);
  });

  it('captures stderr output', async () => {
    const result = await run({ command: 'echo error-msg >&2' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('error-msg');
  });

  it('returns success:true with non-zero exitCode for failing commands', async () => {
    const result = await run({ command: 'exit 42' });
    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(42);
  });

  it('honours timeout and returns success:false on timeout', async () => {
    const result = await run({ command: 'sleep 10', timeout: 100 });
    expect(result.success).toBe(false);
    expect(result.error).toContain('timed out');
  });

  it('uses workingDirectory when specified', async () => {
    const result = await run({ command: 'pwd', workingDirectory: '/tmp' });
    expect(result.success).toBe(true);
    // On macOS /tmp is a symlink to /private/tmp, so we check it ends with /tmp
    expect(result.output.trim()).toMatch(/\/tmp$/);
  });

  it('runs multi-line shell commands', async () => {
    const result = await run({ command: 'echo line1\necho line2' });
    expect(result.success).toBe(true);
    expect(result.output).toContain('line1');
    expect(result.output).toContain('line2');
  });

  it('handles command not found gracefully', async () => {
    const result = await run({ command: 'this_command_does_not_exist_xyz' });
    // Shell will return non-zero exit with error in stderr
    expect(result.success).toBe(true); // command ran, shell reported error
    expect(result.exitCode).not.toBe(0);
  });
});
