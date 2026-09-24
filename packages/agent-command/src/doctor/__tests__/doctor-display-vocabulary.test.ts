import { describe, expect, it } from 'vitest';

import { renderDoctorReport } from '../doctor-render.js';

import type { IDoctorReport } from '../doctor-types.js';

const REPORT: IDoctorReport = {
  checks: [{ id: 'storage.user', label: 'Storage', status: 'warn', repair: 'storage.user' }],
  failCount: 0,
  warnCount: 1,
  repairable: ['storage.user'],
  exitCode: 0,
};

describe('doctor display vocabulary', () => {
  it('uses neutral report and repair text without a host vocabulary', () => {
    const text = renderDoctorReport(REPORT).join('\n');
    expect(text).not.toMatch(/robota/i);
    expect(text).not.toContain('--repair');
    expect(text).toContain('storage.user');
  });

  it('uses the host-selected title, product name, and repair command', () => {
    const text = renderDoctorReport(REPORT, 'Atlas doctor', {
      productName: 'Atlas',
      formatRepairCommand: (id) => `atlas doctor --repair ${id}`,
      repairOffer: 'run atlas doctor --repair <check-id>',
    }).join('\n');
    expect(text).toContain('Atlas doctor');
    expect(text).toContain('atlas doctor --repair storage.user');
    expect(text).toContain('Atlas may work');
    expect(text).toContain('run atlas doctor --repair <check-id>');
  });

  it('preserves the public string title argument', () => {
    expect(renderDoctorReport(REPORT, 'Atlas doctor')).toContain('Atlas doctor');
  });
});
