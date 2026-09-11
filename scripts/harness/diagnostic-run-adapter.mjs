/**
 * Pure diagnostic adapter for scan-runner outcomes.
 *
 * This owns diagnostic input recovery, scan-outcome normalization, stable identity derivation, and
 * renderer composition. The runner owns concurrency, summary text, process I/O, and caller policy.
 */

import {
  DIAGNOSTIC_REPORT_VERSION,
  assertDiagnosticResult,
  createDiagnosticReport,
} from './diagnostic-core.mjs';
import { renderDiagnosticReportJson, renderDiagnosticReportText } from './diagnostic-renderer.mjs';

export function errorDetail(error) {
  try {
    if (error instanceof Error && typeof error.message === 'string' && error.message.length > 0)
      return error.message;
    const detail = String(error);
    return detail.length > 0 ? detail : 'unknown diagnostic failure';
  } catch {
    return 'unknown diagnostic failure';
  }
}

function nextDiagnosticId(prefix, index, usedIds) {
  let suffix = index + 1;
  let id = `${prefix}-${suffix}`;
  while (usedIds.has(id)) {
    suffix += 1;
    id = `${prefix}-${suffix}`;
  }
  usedIds.add(id);
  return id;
}

function unavailableDiagnostic({ id, detectorId, subject, detail }) {
  return {
    version: DIAGNOSTIC_REPORT_VERSION,
    id,
    detectorId,
    state: 'unavailable',
    subject,
    examined: [subject],
    severity: 'error',
    evidence: [detail],
    recommendation: 'Inspect the diagnostic dependency and run the affected command again.',
    unavailable: { code: 'diagnostic-dependency-failure', detail },
  };
}

function normalizeDiagnosticInputs(inputs) {
  const usedIds = new Set();
  return inputs.map((input, index) => {
    try {
      const normalized = assertDiagnosticResult(input);
      if (usedIds.has(normalized.id))
        throw new TypeError(`duplicate diagnostic ID ${normalized.id}`);
      usedIds.add(normalized.id);
      return normalized;
    } catch (error) {
      return unavailableDiagnostic({
        id: nextDiagnosticId('harness.diagnostic-input', index, usedIds),
        detectorId: 'harness.diagnostic-contract',
        subject: { kind: 'diagnostic-result', value: `input-${index + 1}` },
        detail: `Diagnostic input could not be validated: ${errorDetail(error)}`,
      });
    }
  });
}

export function publicationUnavailableDiagnostic(detail) {
  return {
    version: DIAGNOSTIC_REPORT_VERSION,
    id: 'harness.diagnostic-publication',
    detectorId: 'harness.diagnostic-runner',
    state: 'diagnostic-publication-unavailable',
    subject: { kind: 'report', value: 'run-all-scans' },
    examined: [{ kind: 'report', value: 'run-all-scans' }],
    severity: 'error',
    evidence: [detail],
    recommendation:
      'Inspect the report renderer or publication target and retry the diagnostic run.',
    publication: { target: 'run-all-scans writer', detail },
  };
}

export function publishDiagnosticResults(inputs, emit, onDiagnosticPublicationUnavailable) {
  const report = createDiagnosticReport(normalizeDiagnosticInputs(inputs));
  let json;
  let text;
  try {
    json = renderDiagnosticReportJson(report);
    text = renderDiagnosticReportText(report);
  } catch (error) {
    onDiagnosticPublicationUnavailable(publicationUnavailableDiagnostic(errorDetail(error)));
    return report;
  }
  emit('');
  emit('Diagnostic report JSON:');
  for (const line of json.trimEnd().split('\n')) emit(line);
  emit('');
  for (const line of text.trimEnd().split('\n')) emit(line);
  emit('');
  return report;
}

function canonicalScanIdentity(name, index) {
  const raw = String(name ?? `scan-${index + 1}`);
  // Encode every code point rather than folding punctuation to a dash. `same scan` and
  // `same-scan` are distinct scan identities; collapsing them would turn the second finding into
  // an unrelated duplicate-ID validation failure when both scans run together.
  const encoded = [...raw]
    .map((character) => `c${character.codePointAt(0).toString(36)}`)
    .join('-');
  return `scan-${encoded || `c${index + 1}`}`;
}

export function normalizeScanOutcome(scan, index, outcome) {
  const name = scan.name || `scan-${index + 1}`;
  if (typeof outcome === 'number') {
    if (!Number.isInteger(outcome)) {
      throw new TypeError(`Scan ${name} returned a non-integer exit code`);
    }
    return { name, code: outcome, output: '' };
  }
  if (outcome === null || typeof outcome !== 'object' || Array.isArray(outcome)) {
    throw new TypeError(`Scan ${name} returned no valid outcome object`);
  }
  if (!Number.isInteger(outcome.code)) {
    throw new TypeError(`Scan ${name} returned a non-integer exit code`);
  }
  if (outcome.output !== undefined && typeof outcome.output !== 'string') {
    throw new TypeError(`Scan ${name} returned a non-string output`);
  }
  return { name, code: outcome.code, output: outcome.output ?? '' };
}

export function scanUnavailableDiagnostic(scan, index, error) {
  const identity = canonicalScanIdentity(scan.name, index);
  const subject = { kind: 'scan', value: scan.name || `scan-${index + 1}` };
  return unavailableDiagnostic({
    id: `harness.scan-unavailable.${identity}`,
    detectorId: `harness.scan.${identity}`,
    subject,
    detail: `Scan ${scan.name || index + 1} could not run: ${errorDetail(error)}`,
  });
}

export function scanFindingDiagnostic(result, index) {
  const subject = { kind: 'scan', value: result.name || `scan-${index + 1}` };
  const identity = canonicalScanIdentity(result.name, index);
  return {
    version: DIAGNOSTIC_REPORT_VERSION,
    id: `harness.scan-finding.${identity}`,
    detectorId: `harness.scan.${identity}`,
    state: 'finding',
    subject,
    examined: [subject],
    severity: 'error',
    evidence: [`Scan ${result.name || index + 1} exited with status ${result.code}.`],
    recommendation: `Inspect the ${result.name || `scan-${index + 1}`} scan output above.`,
  };
}
