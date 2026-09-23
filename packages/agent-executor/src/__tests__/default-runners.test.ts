/**
 * MCP-004 §S1 / TC-17 — `createDefaultBackgroundTaskRunners()` registers the `tool-invocation`
 * runner. Without this, a `tool-invocation` task admitted in the product fails with
 * `No runner for task kind` (`background-task-manager.ts`'s `startTask` — unreachable here since
 * admission bypasses it, but `validateBackgroundTaskRequest` checks the SAME runner map before
 * `spawn` ever gets that far).
 */

import { describe, expect, it } from 'vitest';

import { createDefaultBackgroundTaskRunners } from '../background-tasks/runners/index.js';

describe('createDefaultBackgroundTaskRunners — TC-17', () => {
  it('registers exactly one runner whose kind is tool-invocation', () => {
    const runners = createDefaultBackgroundTaskRunners();
    const toolInvocationRunners = runners.filter((runner) => runner.kind === 'tool-invocation');
    expect(toolInvocationRunners).toHaveLength(1);
  });

  it('registers that runner with admission "already-running"', () => {
    const runners = createDefaultBackgroundTaskRunners();
    const runner = runners.find((entry) => entry.kind === 'tool-invocation');
    expect(runner?.admission).toBe('already-running');
  });
});
