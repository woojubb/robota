import { resolvePlatformShell } from '@robota-sdk/agent-core';
import { describe, expect, it } from 'vitest';

import { createShellTool, createBashTool } from '../builtins/shell-tool';

import type { IToolInvocationResult } from '../types/tool-result.js';

describe('createShellTool / createBashTool', () => {
  it('registers under the Shell and Bash names', () => {
    expect(createShellTool().getName()).toBe('Shell');
    expect(createBashTool().getName()).toBe('Bash');
  });

  it('builds an OS-aware description that names the active shell + syntax hint', () => {
    const shell = resolvePlatformShell();
    const description = createShellTool().getDescription();
    expect(description).toContain(shell.label);
    expect(description).toContain(shell.syntaxHint);
  });

  it('both aliases share the same OS-aware description', () => {
    expect(createBashTool().getDescription()).toBe(createShellTool().getDescription());
  });

  it('executes a command via the resolved host shell (POSIX round-trip)', async () => {
    const raw = await createShellTool().execute({ command: 'echo shell-ok' });
    const result = JSON.parse(raw.data as string) as IToolInvocationResult;
    expect(result.success).toBe(true);
    expect(result.output.trim()).toContain('shell-ok');
    expect(result.exitCode).toBe(0);
  });
});
