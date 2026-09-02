/** Required contexts that local verification cannot reproduce deterministically. */
const NOT_MIRRORED_ENTRIES = [
  {
    context: 'regression-red-proof (enforcing: accidental-green only)',
    reason:
      "the checker RUNS locally and is useful there, but it cannot reproduce this context's VERDICT. The opt-out is read from `PR_BODY` joined with the commit subjects, and off a pull request `PR_BODY` is empty — so an `allow-green-at-base: <reason>` declared in the body ALONE is invisible locally and the run reports `accidental-green` for a case CI legitimately excuses. A mirror that can disagree with the gate on the gate's own escape hatch is worse than no mirror: it would report a blocking verdict the required check does not hold.",
    relevance: 'code',
    relevantWhen: 'the diff changes product code — ci.yml reports docs-only work as N/A',
    manualCommand:
      'REGRESSION_RED_PROOF_ENFORCE=1 node scripts/harness/check-regression-red-proof.mjs   (reads the opt-out from commit subjects only; a PR-body opt-out will NOT be seen, so a local `accidental-green` is a question to check against the pull request, not a verdict)',
  },
  {
    context: 'dependency audit',
    reason:
      'downloads the osv-scanner binary from GitHub and scans the lockfile against the OSV.dev database — it needs network access and an external toolchain, so a local run could not be made deterministic or offline.',
    relevance: 'manifest-or-lockfile',
    relevantWhen: 'the diff touches `pnpm-lock.yaml` or any `package.json`',
    manualCommand:
      'osv-scanner scan source --config osv-scanner.toml --lockfile pnpm-lock.yaml   (see ci.yml → dependency-audit for the pinned version)',
  },
  {
    context: 'windows-shell',
    reason:
      'runs on `windows-latest` and exists precisely to exercise the win32 process-spawn path that no Linux or macOS host can execute. Mocked-platform unit tests are what it was added to stop being sufficient.',
    relevance: 'code',
    relevantWhen: 'the diff changes product code — ci.yml reports infrastructure-only work as N/A',
    manualCommand:
      'no local equivalent off a Windows host — review the win32 branches by hand, or push and read the check.',
  },
  {
    context: 'workflow provenance',
    reason:
      "runs on `pull_request_target` and judges the pull request's CHANGED-FILE LIST against the workflows that provide a required context, reading both from the base. Off a real pull request there is no file list and no base to compare it to, so a local run would either invent one or report a pass over a control plane it never inspected — which is the vacuity INFRA-097 built this gate to close.",
    relevance: 'guarded-workflow',
    relevantWhen: 'the diff touches any file under `.github/workflows/`',
    manualCommand:
      'node scripts/harness/scan-workflow-provenance.mjs --base-ref <base-sha> --head-ref <head-sha>   (the arguments are part of the entry point: with neither, the scan reports the standing exposure and judges no change)',
  },
  {
    context: 'review-gate',
    reason:
      "reads GitHub's code-scanning API for this PR's merge ref and compares it against the base branch. Both sides only exist once CodeQL has analysed a real pull request, so there is nothing a local run could read — a mirror would either invent the input or report a pass over an analysis that was never performed, which is the exact defect INFRA-048 built this gate to close.",
    relevance: 'every-pull-request',
    relevantWhen:
      'every pull request — the code-scanning half resolves to `PASS (not-applicable)` on a docs-only diff, but the PR-body half (RULE-016: first heading `## Background`, no agent-session link) judges every PR, so the check is never irrelevant',
    manualCommand:
      'the body half: gh pr view <n> --json body -q .body | node scripts/harness/check-pr-body.mjs. The code-scanning half has no local equivalent — push and read the check, or query it directly: gh api "repos/<owner>/<repo>/code-scanning/alerts?pr=<n>&state=open" --paginate  (note --paginate: a single page silently truncates, which is how a 40-high backlog once read as clean)',
  },
];

function keyByContext(entries) {
  const byContext = new Map();
  for (const entry of entries) {
    const existing = byContext.get(entry.context);
    if (existing) {
      throw new Error(
        `ci-mirror-map: NOT_MIRRORED declares \`${entry.context}\` twice. A required check cannot ` +
          'have two reasons for being un-mirrorable — verify-like-ci prints both and names neither ' +
          `as governing. First reason: ${existing.reason.slice(0, 80)}… Second: ${entry.reason.slice(0, 80)}…`,
      );
    }
    byContext.set(entry.context, entry);
  }
  return byContext;
}

export const NOT_MIRRORED_BY_CONTEXT = keyByContext(NOT_MIRRORED_ENTRIES);
export const NOT_MIRRORED = [...NOT_MIRRORED_BY_CONTEXT.values()];
export const RELEVANCE_KEYS = [
  'manifest-or-lockfile',
  'code',
  'guarded-workflow',
  'every-pull-request',
];
