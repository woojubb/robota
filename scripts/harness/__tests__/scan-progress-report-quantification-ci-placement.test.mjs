import { describe, expect, it } from 'vitest';

import { SCAN_COMMANDS, selectScansForExecutionContext } from '../run-all-scans.mjs';

const SCAN_NAME = 'progress-report-quantification';

describe('progress-report quantification runs only where its narrative channel exists', () => {
  it('keeps the local integration diagnostic reachable', () => {
    const selected = selectScansForExecutionContext(SCAN_COMMANDS, {
      context: 'integration',
      environment: {},
    });
    expect(selected.map((scan) => scan.name)).toContain(SCAN_NAME);
  });

  it('removes the N/A-only child process from ordinary pull-request checks', () => {
    const selected = selectScansForExecutionContext(SCAN_COMMANDS, {
      context: 'pr',
      environment: {},
    });
    expect(selected.map((scan) => scan.name)).not.toContain(SCAN_NAME);
  });

  it('removes the N/A-only child process from CI integration runs', () => {
    const selected = selectScansForExecutionContext(SCAN_COMMANDS, {
      context: 'integration',
      environment: { CI: 'true' },
    });
    expect(selected.map((scan) => scan.name)).not.toContain(SCAN_NAME);
  });

  it('leaves promotion ancestry to its dedicated main-PR required check', () => {
    expect(SCAN_COMMANDS.map((scan) => scan.name)).not.toContain('promotion-ancestry');
  });
});
