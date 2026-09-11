/**
 * Pure delivery adapter for hook-migration diagnostics.
 *
 * The publisher is an injected port. This module owns report construction and
 * presentation, while the caller owns filesystem discovery and process I/O.
 */

import { DIAGNOSTIC_REPORT_VERSION, createDiagnosticReport } from './diagnostic-core.mjs';
import { renderDiagnosticReportJson, renderDiagnosticReportText } from './diagnostic-renderer.mjs';

function errorDetail(error) {
  if (error instanceof Error && error.message.trim().length > 0) return error.message;
  const detail = String(error);
  return detail.trim().length > 0 ? detail : 'unknown diagnostic publication failure';
}

function publicationUnavailableDiagnostic(correlationId, detail) {
  const subject = { kind: 'hook-diagnostic-delivery', value: 'publisher' };
  return {
    version: DIAGNOSTIC_REPORT_VERSION,
    id: 'hook.diagnostic-publication-unavailable',
    detectorId: 'hook.diagnostic-delivery',
    correlationId,
    state: 'diagnostic-publication-unavailable',
    subject,
    examined: [subject],
    severity: 'error',
    evidence: [detail],
    recommendation: 'Inspect the hook diagnostic publisher and run the migration inventory again.',
    publication: { target: 'hook diagnostic publisher', detail },
  };
}

/**
 * Build and publish one correlated hook diagnostic report.
 *
 * @param {{
 *   results: unknown[],
 *   correlationId: string,
 *   publish: (payload: {report: object, json: string, text: string}) => unknown | Promise<unknown>,
 * }} input
 * @returns {Promise<{delivered: boolean, report: object}>}
 */
export async function deliverHookDiagnosticReport({ results, correlationId, publish }) {
  const correlated = results.map((result) =>
    result !== null && typeof result === 'object' && !Array.isArray(result)
      ? { ...result, correlationId: result.correlationId ?? correlationId }
      : result,
  );
  const report = createDiagnosticReport(correlated);

  try {
    const payload = {
      report,
      json: renderDiagnosticReportJson(report),
      text: renderDiagnosticReportText(report),
    };
    if (typeof publish !== 'function')
      throw new TypeError('hook diagnostic publisher is not callable');
    await publish(payload);
    return { delivered: true, report };
  } catch (error) {
    // Do not attempt to publish this replacement report: a failed publisher must
    // leave one canonical non-clean result, not recursively retry its own failure.
    return {
      delivered: false,
      report: createDiagnosticReport([
        ...report.results,
        publicationUnavailableDiagnostic(correlationId, errorDetail(error)),
      ]),
    };
  }
}
