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

  /**
   * SEC-007: an explicit timeout, because this case SPAWNS A REAL SHELL and vitest's 10 s default is
   * sized for in-process units. The `windows-shell` CI job exists to run exactly this test against
   * PowerShell, whose cold start on a Windows runner is routinely several seconds on its own — and it
   * flaked at precisely that wall (`Test timed out in 10000ms`, file duration 10.19 s) on a commit
   * whose `agent-tools` tree was byte-identical to the run that had just passed.
   *
   * This is not masking a hang: a hung spawn still fails here, only later. What is under test is that
   * the resolved shell round-trips a command, never how fast the OS can start it.
   */
  it('executes a command via the resolved host shell (POSIX round-trip)', async () => {
    const raw = await createShellTool().execute({ command: 'echo shell-ok' });
    const result = JSON.parse(raw.data as string) as IToolInvocationResult;
    expect(result.success).toBe(true);
    expect(result.output.trim()).toContain('shell-ok');
    expect(result.exitCode).toBe(0);
  }, 60_000);
});
