const CONVERSION_PREFIX = 'Conversion evidence: ';
const ELIGIBILITY_PREFIX = 'Combined lifecycle eligibility: ';
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;
const OID = /^[0-9a-f]{40}$/i;

function linesContaining(text, prefix) {
  return String(text ?? '')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith(prefix));
}

function refusal(reason) {
  return { kind: 'refused', reason };
}

function fields(line, prefix) {
  const body = line.slice(prefix.length);
  const entries = body.split('; ').map((entry) => entry.split('='));
  if (entries.some((entry) => entry.length !== 2 || entry[0] === '' || entry[1] === ''))
    return null;
  return Object.fromEntries(entries);
}

function issueFromUrl(value) {
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)$/.exec(value ?? '');
  return match ? Number(match[1]) : null;
}

function markerFromUrl(value) {
  const match = /^https:\/\/github\.com\/[^/]+\/[^/]+\/issues\/(\d+)#issuecomment-(\d+)$/.exec(
    value ?? '',
  );
  return match ? Number(match[1]) : null;
}

function validTimestamp(value) {
  return ISO_UTC.test(value) && !Number.isNaN(Date.parse(value));
}

/**
 * Parse and bind the conversion receipt and combined-lifecycle recommendation.
 * This is deliberately pure: GitHub mutation/read-back belongs to github-issue-triage.mjs.
 */
export function parseConversionEvidence({ taskText, specText, issueNumber, taskId, baseOid }) {
  const conversionLines = linesContaining(taskText, CONVERSION_PREFIX);
  if (conversionLines.length === 0) return refusal('conversion-evidence-missing');
  if (conversionLines.length > 1) return refusal('conversion-evidence-duplicate');

  const eligibilityLines = linesContaining(taskText, ELIGIBILITY_PREFIX);
  if (eligibilityLines.length !== 1) return refusal('eligibility-evidence-missing-or-duplicate');
  const conversion = fields(conversionLines[0], CONVERSION_PREFIX);
  const eligibility = fields(
    eligibilityLines[0].replace(
      `${ELIGIBILITY_PREFIX}eligible; `,
      `${ELIGIBILITY_PREFIX}eligible=eligible; `,
    ),
    ELIGIBILITY_PREFIX,
  );
  if (conversion === null || eligibility === null) return refusal('conversion-evidence-malformed');

  const issue = issueFromUrl(conversion.issue);
  const markerIssue = markerFromUrl(conversion.marker);
  if (
    issue === null ||
    markerIssue === null ||
    issue !== Number(issueNumber) ||
    markerIssue !== Number(issueNumber) ||
    conversion.task !== taskId ||
    !validTimestamp(conversion['marker-readback']) ||
    !validTimestamp(conversion['priority-removed']) ||
    conversion.base === undefined ||
    !OID.test(conversion['base-oid'])
  ) {
    return refusal(
      issue !== Number(issueNumber) ||
        markerIssue !== Number(issueNumber) ||
        conversion.task !== taskId
        ? 'conversion-evidence-subject-mismatch'
        : 'conversion-evidence-malformed',
    );
  }
  if (conversion['base-oid'].toLowerCase() !== String(baseOid ?? '').toLowerCase()) {
    return refusal('conversion-evidence-base-mismatch');
  }

  const expected = {
    'work-kind': 'enhancement',
    'issue-state': 'OPEN',
    'child-causes': '0',
    security: 'none',
    'data-correctness': 'none',
    'user-decision': 'none',
    'contract-change': 'none',
    'owner-count': '1',
  };
  const priority = eligibility.priority;
  if (
    eligibility.eligible !== 'eligible' ||
    expected['work-kind'] !== eligibility['work-kind'] ||
    !['P0', 'P1'].includes(priority) ||
    Object.entries(expected)
      .filter(([key]) => key !== 'work-kind')
      .some(([key, value]) => eligibility[key] !== value)
  ) {
    return refusal('combined-lifecycle-ineligible');
  }
  if (specText !== undefined && specText !== null && typeof specText !== 'string') {
    return refusal('conversion-evidence-malformed');
  }
  return { kind: 'eligible', conversion, eligibility };
}
