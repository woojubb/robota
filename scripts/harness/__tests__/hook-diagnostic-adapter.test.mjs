import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { DIAGNOSTIC_REPORT_VERSION } from '../diagnostic-core.mjs';
import { deliverHookDiagnosticReport } from '../hook-diagnostic-adapter.mjs';

const HARNESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function finding() {
  return {
    version: DIAGNOSTIC_REPORT_VERSION,
    id: 'hook.fixture.finding',
    detectorId: 'hook.fixture.detector',
    state: 'finding',
    subject: { kind: 'hook-registration', value: 'fixture.sh' },
    examined: [{ kind: 'hook-registration', value: 'fixture.sh' }],
    severity: 'warning',
    evidence: ['fixture hook requires a migration disposition'],
    recommendation: 'Inspect the fixture hook migration record.',
  };
}

describe('hook diagnostic delivery adapter', () => {
  it('publishes a correlated canonical report through its injected port', async () => {
    const published = [];
    const delivery = await deliverHookDiagnosticReport({
      results: [finding()],
      correlationId: 'hook-migration.run-1',
      publish: async (payload) => published.push(payload),
    });

    expect(delivery.delivered).toBe(true);
    expect(delivery.report.results[0]).toMatchObject({
      id: 'hook.fixture.finding',
      correlationId: 'hook-migration.run-1',
    });
    expect(published).toHaveLength(1);
    expect(published[0].text).toContain('correlation: hook-migration.run-1');
  });

  it('returns a non-clean publication-unavailable report without recursively publishing it', async () => {
    let attempts = 0;
    const delivery = await deliverHookDiagnosticReport({
      results: [finding()],
      correlationId: 'hook-migration.run-2',
      publish: async () => {
        attempts += 1;
        throw new Error('fixture target rejected the report');
      },
    });

    expect(attempts).toBe(1);
    expect(delivery.delivered).toBe(false);
    expect(delivery.report.totals.nonClean).toBe(2);
    expect(delivery.report.results.at(-1)).toMatchObject({
      state: 'diagnostic-publication-unavailable',
      correlationId: 'hook-migration.run-2',
      publication: { target: 'hook diagnostic publisher' },
    });
  });

  it('keeps two independently identified outcomes correlated to one hook delivery', async () => {
    const other = { ...finding(), id: 'hook.fixture.other-finding' };
    const delivery = await deliverHookDiagnosticReport({
      results: [finding(), other],
      correlationId: 'hook-migration.run-3',
      publish: () => {},
    });

    expect(delivery.report.results.map(({ id, correlationId }) => ({ id, correlationId }))).toEqual(
      [
        { id: 'hook.fixture.finding', correlationId: 'hook-migration.run-3' },
        { id: 'hook.fixture.other-finding', correlationId: 'hook-migration.run-3' },
      ],
    );
  });

  it('keeps the hook adapter private and free of runner, product, filesystem, and process dependencies', () => {
    const source = readFileSync(path.join(HARNESS_DIR, 'hook-diagnostic-adapter.mjs'), 'utf8');

    expect(source).not.toContain("from './run-all-scans.mjs'");
    expect(source).not.toMatch(/from ['"](?:\.\.\/){2,}packages\//);
    expect(source).not.toMatch(/from ['"]@robota-sdk\//);
    expect(source).not.toMatch(/node:(?:fs|child_process|http|https|net|process)/);
  });
});
