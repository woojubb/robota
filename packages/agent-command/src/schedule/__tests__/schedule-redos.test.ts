/**
 * SEC-003 (`js/polynomial-redos`): `/schedule cron` and `/monitor` argument parsing must stay
 * linear in the length of their argument string.
 *
 * Both commands are declared `modelInvocable: true` (see `schedule-command-module.ts`), so the
 * argument string is composed by the model — a prompt-injected model can therefore choose it.
 * The pre-fix regexes used `\s+(.+)$`; because `.` also matches a space, the split point between
 * `\s+` and `(.+)` was ambiguous and a non-matching argument was rejected in O(n^2). Measured
 * pre-fix on the inputs below: ~17s (`/schedule cron`) and ~15s (`/monitor`); post-fix, <1ms.
 */

import { describe, expect, it, vi } from 'vitest';

import { executeMonitorCommand } from '../schedule-command.js';
import { parseScheduleSpec } from '../schedule-spec-parser.js';

import type { IAgentJobHostContext } from '@robota-sdk/agent-framework';
import { createTestAgentJobHost } from '@robota-sdk/agent-framework/testing';

/** Long enough that the quadratic path takes >10s while the linear path stays sub-millisecond. */
const PUMP_LENGTH = 200_000;

/** Generous versus the <1ms the linear parse costs, and versus the >10s the quadratic one did. */
const BUDGET_MS = 250;

function elapsedMs(run: () => void): number {
  const started = performance.now();
  run();
  return performance.now() - started;
}

describe('schedule argument parsing is not polynomial-ReDoS-able', () => {
  it('rejects a pumped `cron` spec in linear time', () => {
    // Rejected because `(.+)$` cannot cross the newline, which is what forces the full backtrack.
    const hostile = `cron "* * * * *"${' '.repeat(PUMP_LENGTH)}a\nb`;

    const took = elapsedMs(() => {
      const result = parseScheduleSpec(hostile, 0);
      expect(result.ok).toBe(false);
    });

    expect(took).toBeLessThan(BUDGET_MS);
  });

  it('rejects pumped `/monitor` arguments in linear time', async () => {
    const host = createTestAgentJobHost();
    const hostile = `"cmd" "pattern"${' '.repeat(PUMP_LENGTH)}a\nb`;

    const started = performance.now();
    const result = await executeMonitorCommand(host, hostile);
    const took = performance.now() - started;

    expect(result.success).toBe(false);
    expect(took).toBeLessThan(BUDGET_MS);
  });

  it('still parses well-formed specs identically', () => {
    const parsed = parseScheduleSpec('cron "0 9 * * *"   send the digest  ', 0);

    expect(parsed).toEqual({
      ok: true,
      spec: { cronExpression: '0 9 * * *', instruction: 'send the digest', recurring: true },
    });
  });

  it('still parses well-formed `/monitor` arguments identically', async () => {
    const spawnMonitorWake = vi.fn().mockResolvedValue({ id: 'job-1' });
    const host = createTestAgentJobHost({ spawnMonitorWake });

    const result = await executeMonitorCommand(host, '  "pnpm build" "error"   report it  ');

    expect(result.success).toBe(true);
    expect(spawnMonitorWake).toHaveBeenCalledWith(
      expect.objectContaining({
        command: 'pnpm build',
        matchPattern: 'error',
        agentInstruction: 'report it',
      }),
    );
  });
});
