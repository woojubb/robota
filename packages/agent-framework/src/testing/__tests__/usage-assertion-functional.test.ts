/**
 * ANALYTICS-001: token-usage assertions through the TEST-003 functional harness.
 *
 * Drives a REAL InteractiveSession with a scripted provider that reports token usage, then asserts
 * the per-source usage breakdown and a budget — the mechanism that turns wrong/excessive token usage
 * into a failing test.
 */
import { afterEach, describe, expect, it } from 'vitest';

import { scriptedSession, type ScriptedSessionHarness } from '../index.js';

const TEST_TIMEOUT = 20_000;

let harness: ScriptedSessionHarness | undefined;

afterEach(async () => {
  await harness?.dispose();
  harness = undefined;
});

describe('Token-usage assertions (ANALYTICS-001) via the scripted-session harness', () => {
  it(
    'reports per-source usage and supports a budget assertion',
    async () => {
      harness = scriptedSession({
        turns: [
          { text: 'first answer', usage: { inputTokens: 100, outputTokens: 40 } },
          { text: 'second answer', usage: { inputTokens: 60, outputTokens: 20 } },
        ],
      });

      await harness.submit('one');
      await harness.submit('two');

      const report = harness.usageReport();
      // 140 + 80, all attributed to the main thread (no sub-sources in this run).
      expect(report.totalTokens).toBe(220);
      expect(report.bySource).toHaveLength(1);
      expect(report.bySource[0]).toMatchObject({ label: 'main thread', percentage: 100 });
      expect(report.topConsumer?.label).toBe('main thread');
      expect(harness.totalUsage()).toBe(220);

      // The budget gate: an over-budget session would fail here.
      expect(harness.totalUsage()).toBeLessThanOrEqual(500);
    },
    TEST_TIMEOUT,
  );

  it(
    'reports zero usage when the provider declares none',
    async () => {
      harness = scriptedSession({ turns: [{ text: 'no usage reported' }] });
      await harness.submit('hi');
      expect(harness.totalUsage()).toBe(0);
      expect(harness.usageReport().bySource).toEqual([]);
    },
    TEST_TIMEOUT,
  );
});
