// harness-coverage: pre-push-work-run.mjs
// harness-coverage: work-run-scan-registration.mjs
import { describe, expect, it } from 'vitest';

import { isPrePushInputWellFormed } from '../pre-push-work-run.mjs';
import { SCAN_COMMANDS } from '../run-all-scans.mjs';
import { createWorkRunMeasurementScan } from '../work-run-scan-registration.mjs';

describe('work-run scan integration', () => {
  it('keeps measurement always-run immediately after the planning-order guard', () => {
    const names = SCAN_COMMANDS.map((scan) => scan.name);
    const measurementAt = names.indexOf('work-run-measurement');

    expect(measurementAt).toBe(names.indexOf('user-execution-plan-order') + 1);
    expect(names[measurementAt + 1]).toBe('standing-delegation-evidence');
    expect(SCAN_COMMANDS[measurementAt]).toEqual(
      createWorkRunMeasurementScan('scripts/harness/scan-work-run-measurement.mjs'),
    );
  });

  it('recognizes the exact four-field pre-push update consumed by the integration', () => {
    const oid = 'a'.repeat(40);
    expect(isPrePushInputWellFormed(`refs/heads/topic ${oid} refs/heads/topic ${oid}\n`)).toBe(
      true,
    );
  });
});
