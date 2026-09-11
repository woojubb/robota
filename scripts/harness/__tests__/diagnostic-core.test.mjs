import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  DIAGNOSTIC_REPORT_VERSION,
  assertDiagnosticReport,
  assertDiagnosticResult,
  createDiagnosticReport,
} from '../diagnostic-core.mjs';
import { renderDiagnosticReportJson, renderDiagnosticReportText } from '../diagnostic-renderer.mjs';
import { runScans } from '../run-all-scans.mjs';

const HARNESS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function productionHarnessScripts(directory = HARNESS_DIR, prefix = '') {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === '__tests__') return [];
    const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`;
    if (entry.isDirectory())
      return productionHarnessScripts(path.join(directory, entry.name), relative);
    return entry.name.endsWith('.mjs') ? [relative] : [];
  });
}

function result(state, overrides = {}) {
  const shared = {
    version: DIAGNOSTIC_REPORT_VERSION,
    id: `harness.fixture.${state}`,
    detectorId: 'fixture.detector',
    state,
    subject: { kind: 'path', value: 'scripts/harness/fixture.mjs' },
    examined: [{ kind: 'path', value: 'scripts/harness/fixture.mjs' }],
  };
  if (state === 'clean') return { ...shared, summary: 'fixture inspected cleanly', ...overrides };
  if (state === 'finding') {
    return {
      ...shared,
      severity: 'warning',
      evidence: ['fixture evidence'],
      recommendation: 'inspect the fixture',
      ...overrides,
    };
  }
  if (state === 'unavailable') {
    return {
      ...shared,
      severity: 'warning',
      evidence: ['fixture dependency did not respond'],
      recommendation: 'restore the fixture dependency',
      unavailable: { code: 'timeout', detail: 'fixture timed out after 10 ms' },
      ...overrides,
    };
  }
  return {
    ...shared,
    severity: 'error',
    evidence: ['report target rejected output'],
    recommendation: 'inspect the report target',
    publication: { target: 'stdout', detail: 'fixture write failed' },
    ...overrides,
  };
}

describe('diagnostic result core', () => {
  it.each(['clean', 'finding', 'unavailable', 'diagnostic-publication-unavailable'])(
    'validates the %s state',
    (state) => {
      expect(assertDiagnosticResult(result(state))).toEqual(result(state));
    },
  );

  it.each([
    ['stable result ID', result('finding', { id: 'not a stable id' })],
    ['examined subject', result('finding', { examined: [] })],
    ['finding evidence', result('finding', { evidence: [] })],
    ['finding severity', result('finding', { severity: undefined })],
    ['recommendation', result('finding', { recommendation: '' })],
    [
      'unexpected cyclic data',
      (() => {
        const unexpected = {};
        unexpected.self = unexpected;
        return result('finding', { unexpected });
      })(),
    ],
    ['unavailable detail', result('unavailable', { unavailable: { code: 'timeout' } })],
    [
      'publication detail',
      result('diagnostic-publication-unavailable', { publication: { target: 'stdout' } }),
    ],
  ])('rejects a missing or invalid %s', (_name, invalid) => {
    expect(() => assertDiagnosticResult(invalid)).toThrow();
  });

  it('counts each state in a versioned report', () => {
    expect(
      createDiagnosticReport([
        result('clean'),
        result('finding'),
        result('unavailable'),
        result('diagnostic-publication-unavailable'),
      ]),
    ).toMatchObject({
      version: DIAGNOSTIC_REPORT_VERSION,
      totals: {
        clean: 1,
        finding: 1,
        unavailable: 1,
        diagnosticPublicationUnavailable: 1,
        nonClean: 3,
      },
    });
  });
});

describe('diagnostic renderer', () => {
  it('renders deterministic JSON and explicit concise non-clean results without I/O', () => {
    const report = createDiagnosticReport([
      result('clean'),
      result('finding'),
      result('unavailable'),
      result('diagnostic-publication-unavailable'),
    ]);
    const json = renderDiagnosticReportJson(report);
    const text = renderDiagnosticReportText(report);

    expect(renderDiagnosticReportJson(report)).toBe(json);
    expect(JSON.parse(json)).toMatchObject({
      version: DIAGNOSTIC_REPORT_VERSION,
      results: report.results,
    });
    for (const state of ['finding', 'unavailable', 'diagnostic-publication-unavailable']) {
      expect(text).toContain(`harness.fixture.${state}`);
    }
    expect(text).toContain('fixture dependency did not respond');
    expect(text).toContain('restore the fixture dependency');
    expect(text).toContain('report target rejected output');
  });

  it('normalizes field order before canonical JSON rendering', () => {
    const forward = result('finding');
    const reverse = Object.fromEntries(Object.entries(forward).reverse());
    reverse.subject = Object.fromEntries(Object.entries(forward.subject).reverse());
    reverse.examined = forward.examined.map((subject) =>
      Object.fromEntries(Object.entries(subject).reverse()),
    );

    expect(renderDiagnosticReportJson(createDiagnosticReport([forward]))).toBe(
      renderDiagnosticReportJson(createDiagnosticReport([reverse])),
    );
  });

  it('rejects undeclared report and totals fields rather than dropping them during normalization', () => {
    const report = createDiagnosticReport([result('finding')]);

    expect(() => assertDiagnosticReport({ ...report, extra: 'not part of v1' })).toThrow(
      /unsupported field extra/,
    );
    expect(() =>
      assertDiagnosticReport({
        ...report,
        totals: { ...report.totals, extra: 1 },
      }),
    ).toThrow(/totals contains unsupported field extra/);
  });

  it('rejects inherited fields rather than reading them as an exact result contract', () => {
    expect(() => assertDiagnosticResult(Object.create(result('finding')))).toThrow(/plain object/);

    const report = createDiagnosticReport([result('finding')]);
    expect(() => assertDiagnosticReport(Object.create(report))).toThrow(/plain object/);
  });
});

describe('diagnostic runner seam and import boundaries', () => {
  it('renders finding and unavailable outcomes next to a clean scan without changing the zero exit', async () => {
    const lines = [];
    const exit = await runScans(
      [
        { name: 'clean-sibling', run: () => Promise.resolve(0) },
        { name: 'policy-finding', run: () => Promise.resolve(0) },
      ],
      (line) => lines.push(line),
      2,
      {
        diagnosticResults: [result('finding'), result('unavailable')],
      },
    );

    const output = lines.join('\n');
    expect(exit).toBe(0);
    expect(output).toContain('clean-sibling');
    expect(output).toContain('harness.fixture.finding');
    expect(output).toContain('harness.fixture.unavailable');
    expect(output).toContain('scripts/harness/fixture.mjs');
  });

  it('keeps the core, renderer, output protocol, and runner adapter independent of the runner and product packages', () => {
    for (const file of [
      'diagnostic-core.mjs',
      'diagnostic-renderer.mjs',
      'diagnostic-run-adapter.mjs',
      'output-markers.mjs',
    ]) {
      const source = readFileSync(path.join(HARNESS_DIR, file), 'utf8');
      expect(source).not.toContain("from './run-all-scans.mjs'");
      expect(source).not.toMatch(/from ['"](?:\.\.\/){2,}packages\//);
      expect(source).not.toMatch(/from ['"]@robota-sdk\//);
      expect(source).not.toMatch(/node:(?:fs|child_process|http|https|net)/);
    }
  });

  it('keeps legacy output markers out of the structured diagnostic result contract', () => {
    const core = readFileSync(path.join(HARNESS_DIR, 'diagnostic-core.mjs'), 'utf8');
    expect(core).not.toContain('::advisory::');
    expect(core).not.toContain('::examined::');
  });

  it('keeps every production marker/examined helper consumer off the runner', () => {
    const runnerImports = productionHarnessScripts()
      .filter((file) => file !== 'run-all-scans.mjs')
      .map((file) => ({ file, source: readFileSync(path.join(HARNESS_DIR, file), 'utf8') }))
      .filter(({ source }) => source.includes("from './run-all-scans.mjs'"));

    for (const { file, source } of runnerImports) {
      expect(source, file).not.toMatch(
        /import\s*\{[^}]*\b(?:ADVISORY_MARKER|EXAMINED_MARKER|EXPECTED_EMPTY_MARKER|extractAdvisories|extractExamined)\b[^}]*\}\s*from ['"]\.\/run-all-scans\.mjs['"]/,
      );
    }
  });
});
