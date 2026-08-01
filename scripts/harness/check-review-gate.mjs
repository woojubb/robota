#!/usr/bin/env node

/**
 * Review gate (INFRA-048-A) — turn a PR review's findings into a signal the MERGE DECISION can see.
 *
 * ## The defect
 *
 * The checks that gate a merge on `develop` are build / quality / scans / dependency audit /
 * commitlint / tui-e2e / examples-typecheck / windows-shell. **Not one of them produces review
 * feedback.** The two jobs that do — `Claude review` and CodeQL's `Analyze` — are advisory and
 * report `success` whether or not they found anything. Measured on #1409: CodeQL's inline review
 * posted 74 seconds BEFORE the merge, an armed auto-merge fired on the eight green gates, and the
 * flagged defect landed on `develop`. Feedback was produced and never read.
 *
 * ## The design, and the trade-off it has to survive
 *
 * A gate that hard-fails on ANY review finding blocks merges on NITs. This repo makes that
 * concrete: every one of its ~100 open code-scanning alerts is severity `note` (mostly
 * `js/unused-local-variable`), so a "fail on any finding" gate would be red on every PR from day
 * one and would be bypassed within a day — strictly worse than advisory, because a bypassed gate
 * also teaches everyone to bypass. So:
 *
 *   - **Blocking** = an alert this PR INTRODUCES whose severity is `error`, or whose
 *     security-severity is `high`/`critical`. Nothing else can block.
 *   - **Advisory** = every other open alert on the PR. Reported, counted and printed on the check
 *     — visible where nothing was visible before — but never blocking.
 *   - **Pre-existing** = an alert already open on the base branch. Never this PR's problem.
 *   - **Unavailable** = the analysis has not completed, or the alert list could not be read. This
 *     BLOCKS. A review whose output cannot be read has not cleared anything; reporting a pass for
 *     it is the same defect one level up (cf. INFRA-048-B/C).
 *   - **Not applicable** = this PR changes no code, so no analysis is produced for it and none is
 *     expected. PASSES. This is a THIRD state, and conflating it with `unavailable` is what blocked
 *     #1436 — a single backlog markdown file — for 15 m 23 s and forced the required-check entry to
 *     be rolled back. "Not applicable" is not "unreadable": one means the answer does not exist,
 *     the other means the answer exists and could not be read.
 *
 *     The caller must NOT decide this for itself. `codeChanged` is supplied by
 *     `classify-changed-paths.mjs` — the SAME module whose verdict decides whether the required
 *     build/test matrix runs at all — so a PR can only reach this branch by being the kind of PR
 *     that also skipped its whole code pipeline. Only the literal value `false` selects it;
 *     anything else (missing, unknown, unparseable) is treated as "code changed" and takes the
 *     normal path, so an undeterminable classification still fails closed.
 *   - **Acknowledged** = the PR carries the acknowledge label. Passes, with the overridden findings
 *     printed in full so the decision is recorded on the PR rather than exercised as a silent
 *     admin bypass. One auditable escape beats a gate people learn to route around.
 *
 * Consumed by `.github/workflows/review-gate.yml`, which is a thin caller: it fetches the two alert
 * lists and the labels, and this module decides. All logic is pure and unit-tested.
 *
 * Usage:
 *   node scripts/harness/check-review-gate.mjs \
 *     --alerts-file <pr-alerts.json> --base-alerts-file <base-alerts.json> [--labels a,b] \
 *     [--code-changed true|false]
 *
 * Either alerts file may contain the literal string `UNAVAILABLE` (the workflow writes that when
 * the API call fails), which is what triggers the fail-closed path. `--code-changed false` selects
 * the not-applicable path, and is the only value that does; the alert files are then not read at
 * all, because no analysis exists to have produced them.
 *
 * Exit code 0 = the merge decision may proceed, 1 = blocked.
 */

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** Rule severities that may block. CodeQL severities are: none | note | warning | error. */
export const BLOCKING_RULE_SEVERITIES = new Set(['error']);

/** Security severities that may block, independent of the rule severity. */
export const BLOCKING_SECURITY_SEVERITIES = new Set(['high', 'critical']);

/** The single, auditable escape hatch. Applying it is a recorded act on the PR. */
export const ACKNOWLEDGE_LABEL = 'review-findings-acknowledged';

/** Sentinel the workflow writes when an alert list could not be retrieved. */
export const UNAVAILABLE = 'UNAVAILABLE';

function alertSeverity(alert) {
  return String(alert?.rule?.severity ?? '').toLowerCase();
}

function alertSecuritySeverity(alert) {
  return String(alert?.rule?.security_severity_level ?? '').toLowerCase();
}

/** Whether an alert is severe enough to block a merge on its own. */
export function isBlockingAlert(alert) {
  return (
    BLOCKING_RULE_SEVERITIES.has(alertSeverity(alert)) ||
    BLOCKING_SECURITY_SEVERITIES.has(alertSecuritySeverity(alert))
  );
}

function describeAlert(alert) {
  const rule = alert?.rule?.id ?? alert?.rule?.name ?? '(unknown rule)';
  const location = alert?.most_recent_instance?.location?.path ?? '(unknown file)';
  const line = alert?.most_recent_instance?.location?.start_line;
  const severity = alertSeverity(alert) || 'unknown';
  const security = alertSecuritySeverity(alert);
  const severityText = security ? `${severity}/security:${security}` : severity;
  return `${rule} [${severityText}] ${location}${line ? `:${line}` : ''}`;
}

/**
 * Decide whether the review output permits a merge.
 *
 * @param {object} input
 * @param {Array<object>|'UNAVAILABLE'} input.prAlerts     open alerts on the PR's merge ref
 * @param {Array<object>|'UNAVAILABLE'} input.baseAlerts   open alerts on the base branch
 * @param {string[]} [input.labels]                        labels currently on the PR
 * @param {boolean} [input.codeChanged]                    the `changes` classifier's verdict;
 *                                                         only literal `false` is not-applicable
 * @returns {{blocked: boolean, reason: string, blocking: object[], advisory: object[],
 *            preExisting: object[], acknowledged: boolean, summary: string}}
 */
export function decideReviewGate({
  prAlerts,
  baseAlerts,
  labels = [],
  labelsUnavailable = false,
  codeChanged = true,
}) {
  // An unreadable label list cannot ACKNOWLEDGE anything. Reading it as "no labels" would block for
  // the wrong cause, and reading it as acknowledged would clear on an override nobody gave.
  const acknowledged = !labelsUnavailable && labels.includes(ACKNOWLEDGE_LABEL);

  // Checked FIRST, and only on the literal `false`. A docs-only PR never triggers CodeQL
  // (`codeql.yml` `paths-ignore`), so its alert lists are legitimately absent — reaching the
  // UNAVAILABLE branch below would block it on the absence of an analysis that was never owed.
  if (codeChanged === false) {
    return {
      blocked: false,
      reason: 'not-applicable',
      blocking: [],
      advisory: [],
      preExisting: [],
      acknowledged,
      summary:
        'no code changed — this PR touches documentation only, so CodeQL never analyses it and no ' +
        'review verdict exists to read. Nothing was skipped: the same classification also skipped ' +
        'this PR’s build and test matrix. A PR that changes code cannot reach this outcome.',
    };
  }

  // Checked BEFORE the alerts, because it is the one failure the acknowledge label cannot excuse:
  // the label is exactly what could not be read. Every other "could not read X" branch here produces
  // a gate report on the PR, and this one used to `exit 1` out of the collecting step instead — the
  // job went red with the reason visible only in an Actions annotation. A gate that blocks without
  // saying why on the PR is the shape this whole workflow exists to remove. (#1588 review)
  if (labelsUnavailable) {
    return {
      blocked: true,
      reason: 'labels-unavailable',
      blocking: [],
      advisory: [],
      preExisting: [],
      acknowledged: false,
      summary:
        'the labels on this PR could not be read, so the acknowledge override can be neither ruled ' +
        'in nor ruled out. This gate does not report a pass it did not compute, and the label that ' +
        'would overrule it is the thing that is unreadable — applying one cannot clear this. Re-run ' +
        'this job; if the read keeps failing, the token or the API is the cause.',
    };
  }

  if (prAlerts === UNAVAILABLE || baseAlerts === UNAVAILABLE) {
    const which = prAlerts === UNAVAILABLE ? "the PR's" : "the base branch's";
    return {
      blocked: !acknowledged,
      reason: 'verdict-unavailable',
      blocking: [],
      advisory: [],
      preExisting: [],
      acknowledged,
      summary:
        `${which} code-scanning result could not be read, so no review finding has been cleared. ` +
        'This gate does not report a pass it did not compute — re-run the analysis, or apply the ' +
        `\`${ACKNOWLEDGE_LABEL}\` label to record an explicit decision to merge without it.`,
    };
  }

  const openPrAlerts = prAlerts.filter((alert) => (alert?.state ?? 'open') === 'open');
  const baseNumbers = new Set(
    baseAlerts.filter((alert) => (alert?.state ?? 'open') === 'open').map((alert) => alert?.number),
  );

  const preExisting = openPrAlerts.filter((alert) => baseNumbers.has(alert?.number));
  const introduced = openPrAlerts.filter((alert) => !baseNumbers.has(alert?.number));
  const blocking = introduced.filter(isBlockingAlert);
  const advisory = introduced.filter((alert) => !isBlockingAlert(alert));

  if (blocking.length === 0) {
    return {
      blocked: false,
      reason: advisory.length > 0 ? 'advisory-only' : 'clean',
      blocking,
      advisory,
      preExisting,
      acknowledged,
      summary:
        advisory.length > 0
          ? `${advisory.length} advisory finding(s) introduced by this PR — reported, not blocking.`
          : 'no findings introduced by this PR.',
    };
  }

  return {
    blocked: !acknowledged,
    reason: 'blocking-findings',
    blocking,
    advisory,
    preExisting,
    acknowledged,
    summary:
      `${blocking.length} blocking finding(s) introduced by this PR (severity \`error\`, or ` +
      'security-severity high/critical). Fix them, or record an explicit decision with the ' +
      `\`${ACKNOWLEDGE_LABEL}\` label.`,
  };
}

/** Render the decision for the check's log. Returns the text; the caller owns the exit code. */
export function renderDecision(decision) {
  const overridden =
    decision.acknowledged &&
    (decision.reason === 'blocking-findings' || decision.reason === 'verdict-unavailable');
  const lines = [];
  lines.push(
    `review-gate: ${decision.blocked ? 'BLOCK' : 'PASS'} (${decision.reason}${
      overridden ? ', acknowledged' : ''
    })`,
  );
  lines.push(decision.summary);

  if (decision.blocking.length > 0) {
    lines.push('', 'Blocking findings introduced by this PR:');
    for (const alert of decision.blocking) lines.push(`  - ${describeAlert(alert)}`);
  }
  if (decision.advisory.length > 0) {
    lines.push('', 'Advisory findings introduced by this PR (not blocking, still worth reading):');
    for (const alert of decision.advisory) lines.push(`  - ${describeAlert(alert)}`);
  }
  if (decision.preExisting.length > 0) {
    lines.push(
      '',
      `${decision.preExisting.length} finding(s) already open on the base branch — not this PR's.`,
    );
  }
  if (overridden) {
    lines.push(
      '',
      `OVERRIDDEN: the \`${ACKNOWLEDGE_LABEL}\` label is applied, so this gate passes with the ` +
        'findings above on the record.',
    );
  }
  return lines.join('\n') + '\n';
}

function readAlerts(filePath) {
  const raw = readFileSync(filePath, 'utf8').trim();
  if (raw === UNAVAILABLE || raw === '') return UNAVAILABLE;
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : UNAVAILABLE;
  } catch {
    return UNAVAILABLE;
  }
}

function argValue(argv, flag) {
  const index = argv.indexOf(flag);
  return index === -1 ? undefined : argv[index + 1];
}

export function main(argv = process.argv.slice(2)) {
  // `--labels UNAVAILABLE` is the same sentinel the alert files carry, and it means the same thing:
  // the read failed, so nothing about the labels has been established. It is spelled the same way on
  // purpose — one vocabulary for "I could not read this", not two. A label literally named
  // `UNAVAILABLE` would be misread; no such label exists here, and the alternative (a second flag
  // beside the sentinel) forks the contract this is meant to join. (#1588 review)
  const labelsRaw = argValue(argv, '--labels') ?? '';
  const labelsUnavailable = labelsRaw.trim() === UNAVAILABLE;
  const labels = labelsUnavailable
    ? []
    : labelsRaw
        .split(',')
        .map((label) => label.trim())
        .filter(Boolean);

  // Fail-closed parsing: ONLY the literal `false` is "no code changed". A missing flag, an empty
  // value, or anything the classifier could not determine leaves this `true`, which requires a
  // readable analysis — the INFRA-048 invariant.
  const codeChanged = (argValue(argv, '--code-changed') ?? '').trim() !== 'false';

  if (!codeChanged) {
    // The alert files are not read, and need not exist: no analysis was produced for this PR.
    process.stdout.write(renderDecision(decideReviewGate({ codeChanged: false, labels })));
    process.exitCode = 0;
    return;
  }

  const alertsFile = argValue(argv, '--alerts-file');
  const baseAlertsFile = argValue(argv, '--base-alerts-file');
  if (!alertsFile || !baseAlertsFile) {
    process.stderr.write(
      'usage: check-review-gate.mjs --alerts-file <json> --base-alerts-file <json> [--labels a,b] ' +
        '[--code-changed true|false]\n',
    );
    process.exitCode = 1;
    return;
  }

  const decision = decideReviewGate({
    prAlerts: readAlerts(alertsFile),
    baseAlerts: readAlerts(baseAlertsFile),
    labels,
    labelsUnavailable,
    codeChanged,
  });

  process.stdout.write(renderDecision(decision));
  process.exitCode = decision.blocked ? 1 : 0;
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
