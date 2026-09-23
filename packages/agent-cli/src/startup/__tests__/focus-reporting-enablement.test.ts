import { describe, expect, it } from 'vitest';

import { resolveFocusReportingOverride } from '../focus-reporting-enablement.js';

describe('resolveFocusReportingOverride (SCREEN-1992)', () => {
  it('maps ROBOTA_FOCUS_EVENTS=1/0 to an override and leaves anything else to the TUI gate', () => {
    expect(resolveFocusReportingOverride({ ROBOTA_FOCUS_EVENTS: '1' })).toBe(true);
    expect(resolveFocusReportingOverride({ ROBOTA_FOCUS_EVENTS: ' 0 ' })).toBe(false);
    expect(resolveFocusReportingOverride({ ROBOTA_FOCUS_EVENTS: 'yes' })).toBeUndefined();
    expect(resolveFocusReportingOverride({})).toBeUndefined();
  });
});
