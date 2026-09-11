/**
 * Private, I/O-free diagnostic result contract for repository harness adapters.
 *
 * A result is deliberately distinct from a process exit code: repository-policy adapters can expose
 * a finding or an unavailable dependency without claiming the detector ran cleanly or forcing the
 * caller's workflow. Filesystem, subprocess, registry, hook, receipt, and CI concerns belong to
 * adapters above this module.
 */

export const DIAGNOSTIC_REPORT_VERSION = 1;

const STABLE_ID_PATTERN = /^[a-z][a-z0-9]*(?:[.-][a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const STATES = new Set(['clean', 'finding', 'unavailable', 'diagnostic-publication-unavailable']);
const SEVERITIES = new Set(['info', 'warning', 'error']);

function assertObject(value, name) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${name} must be an object`);
  }
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) {
    throw new TypeError(`${name} must be a plain object with its declared fields`);
  }
}

function assertExactKeys(value, keys, name) {
  const allowed = new Set(keys);
  for (const key of Object.keys(value)) {
    if (!allowed.has(key)) throw new TypeError(`${name} contains unsupported field ${key}`);
  }
  for (const key of keys) {
    if (!Object.hasOwn(value, key)) throw new TypeError(`${name} is missing required field ${key}`);
  }
}

function assertNonEmptyString(value, name) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw new TypeError(`${name} must be a non-empty string`);
  }
}

function assertStableId(value, name) {
  assertNonEmptyString(value, name);
  if (!STABLE_ID_PATTERN.test(value)) {
    throw new TypeError(`${name} must be a stable lowercase dot-or-dash identifier`);
  }
}

function assertSubject(subject, name) {
  assertObject(subject, name);
  assertExactKeys(subject, ['kind', 'value'], name);
  assertNonEmptyString(subject.kind, `${name}.kind`);
  assertNonEmptyString(subject.value, `${name}.value`);
  return { kind: subject.kind, value: subject.value };
}

function assertEvidence(evidence) {
  if (!Array.isArray(evidence) || evidence.length === 0) {
    throw new TypeError('evidence must contain at least one item');
  }
  for (const [index, item] of evidence.entries()) {
    assertNonEmptyString(item, `evidence[${index}]`);
  }
  return [...evidence];
}

/**
 * Validate and return one diagnostic result. The function is deliberately pure so every adapter
 * reports the same schema before a renderer decides how to present it.
 */
export function assertDiagnosticResult(result) {
  assertObject(result, 'diagnostic result');
  if (result.version !== DIAGNOSTIC_REPORT_VERSION) {
    throw new TypeError(`diagnostic result.version must equal ${DIAGNOSTIC_REPORT_VERSION}`);
  }
  assertStableId(result.id, 'diagnostic result.id');
  assertStableId(result.detectorId, 'diagnostic result.detectorId');
  if (!STATES.has(result.state)) {
    throw new TypeError(`diagnostic result.state must be one of ${[...STATES].join(', ')}`);
  }
  const commonFields = ['version', 'id', 'detectorId', 'state', 'subject', 'examined'];
  const correlationId =
    result.correlationId === undefined
      ? undefined
      : (assertStableId(result.correlationId, 'diagnostic result.correlationId'),
        result.correlationId);
  const optionalCorrelationField = correlationId === undefined ? [] : ['correlationId'];
  const subject = assertSubject(result.subject, 'diagnostic result.subject');
  if (!Array.isArray(result.examined) || result.examined.length === 0) {
    throw new TypeError('diagnostic result.examined must contain at least one subject');
  }
  const examined = result.examined.map((item, index) =>
    assertSubject(item, `diagnostic result.examined[${index}]`),
  );

  if (result.state === 'clean') {
    assertExactKeys(
      result,
      [...commonFields, ...optionalCorrelationField, 'summary'],
      'diagnostic result',
    );
    assertNonEmptyString(result.summary, 'diagnostic result.summary');
    return {
      version: result.version,
      id: result.id,
      detectorId: result.detectorId,
      ...(correlationId === undefined ? {} : { correlationId }),
      state: result.state,
      subject,
      examined,
      summary: result.summary,
    };
  }

  const nonCleanFields = [
    ...commonFields,
    ...optionalCorrelationField,
    'severity',
    'evidence',
    'recommendation',
  ];
  if (!SEVERITIES.has(result.severity)) {
    throw new TypeError(`diagnostic result.severity must be one of ${[...SEVERITIES].join(', ')}`);
  }
  const evidence = assertEvidence(result.evidence);
  assertNonEmptyString(result.recommendation, 'diagnostic result.recommendation');

  let stateFields = nonCleanFields;
  let unavailable;
  let publication;
  if (result.state === 'unavailable') {
    assertObject(result.unavailable, 'diagnostic result.unavailable');
    assertExactKeys(result.unavailable, ['code', 'detail'], 'diagnostic result.unavailable');
    assertStableId(result.unavailable.code, 'diagnostic result.unavailable.code');
    assertNonEmptyString(result.unavailable.detail, 'diagnostic result.unavailable.detail');
    unavailable = { code: result.unavailable.code, detail: result.unavailable.detail };
    stateFields = [...nonCleanFields, 'unavailable'];
  }
  if (result.state === 'diagnostic-publication-unavailable') {
    assertObject(result.publication, 'diagnostic result.publication');
    assertExactKeys(result.publication, ['target', 'detail'], 'diagnostic result.publication');
    assertNonEmptyString(result.publication.target, 'diagnostic result.publication.target');
    assertNonEmptyString(result.publication.detail, 'diagnostic result.publication.detail');
    publication = { target: result.publication.target, detail: result.publication.detail };
    stateFields = [...nonCleanFields, 'publication'];
  }
  assertExactKeys(result, stateFields, 'diagnostic result');
  return {
    version: result.version,
    id: result.id,
    detectorId: result.detectorId,
    ...(correlationId === undefined ? {} : { correlationId }),
    state: result.state,
    subject,
    examined,
    severity: result.severity,
    evidence,
    recommendation: result.recommendation,
    ...(unavailable === undefined ? {} : { unavailable }),
    ...(publication === undefined ? {} : { publication }),
  };
}

/** Build one versioned report and make duplicate result identifiers a validation error. */
export function createDiagnosticReport(results) {
  if (!Array.isArray(results)) throw new TypeError('diagnostic report results must be an array');
  const validated = results.map((result) => assertDiagnosticResult(result));
  const ids = new Set();
  for (const result of validated) {
    if (ids.has(result.id))
      throw new TypeError(`diagnostic report contains duplicate ID ${result.id}`);
    ids.add(result.id);
  }
  const totals = {
    clean: 0,
    finding: 0,
    unavailable: 0,
    diagnosticPublicationUnavailable: 0,
    nonClean: 0,
  };
  for (const result of validated) {
    if (result.state === 'diagnostic-publication-unavailable') {
      totals.diagnosticPublicationUnavailable += 1;
    } else {
      totals[result.state] += 1;
    }
    if (result.state !== 'clean') totals.nonClean += 1;
  }
  return { version: DIAGNOSTIC_REPORT_VERSION, results: validated, totals };
}

/** Validate the small top-level report shape before presentation adapters consume it. */
export function assertDiagnosticReport(report) {
  assertObject(report, 'diagnostic report');
  assertExactKeys(report, ['version', 'results', 'totals'], 'diagnostic report');
  if (report.version !== DIAGNOSTIC_REPORT_VERSION) {
    throw new TypeError(`diagnostic report.version must equal ${DIAGNOSTIC_REPORT_VERSION}`);
  }
  assertObject(report.totals, 'diagnostic report.totals');
  const expected = createDiagnosticReport(report.results);
  assertExactKeys(report.totals, Object.keys(expected.totals), 'diagnostic report.totals');
  for (const [key, value] of Object.entries(expected.totals)) {
    if (report.totals?.[key] !== value) {
      throw new TypeError(`diagnostic report.totals.${key} does not match its results`);
    }
  }
  return expected;
}
