import { adapterFailure, consumeBudget, runGitHubJson } from './work-run-report-github-client.mjs';
import { resolveAttestedOpeningHeadFromHistory } from './work-run-opening-head-history.mjs';
import { attestedOpeningHeadFromComments } from './work-run-opening-head-evidence.mjs';
import { pullRequestTimeline } from './work-run-pr-timeline.mjs';

function completeCommentList(pages, maxPages) {
  if (
    !Array.isArray(pages) ||
    pages.length === 0 ||
    pages.length > maxPages ||
    pages.some((page) => !Array.isArray(page))
  ) {
    throw adapterFailure('incomplete-pagination', 'GitHub commit comments are incomplete');
  }
  return pages.flat();
}

function openingComments(repository, headOid, context) {
  const pages = runGitHubJson(
    [
      'api',
      '--paginate',
      '--slurp',
      `/repos/${repository}/commits/${headOid}/comments?per_page=100`,
    ],
    context,
  );
  consumeBudget(context.budget, 'remainingPages', pages.length, 'page-budget-exhausted');
  return completeCommentList(pages, context.maxPages);
}

export function queryReportPullRequestTimeline(repository, number, context) {
  return pullRequestTimeline(repository, number, (args) => {
    const response = runGitHubJson(args, context);
    consumeBudget(context.budget, 'remainingPages', 1, 'page-budget-exhausted');
    return response;
  });
}

export function queryReportOpeningHeadEvidence(repository, pr, receipt, _range, context) {
  try {
    const initial = resolveAttestedOpeningHeadFromHistory({
      timeline: context.timeline,
      expectedRunId: receipt.runId,
      loadCommit: (oid) => runGitHubJson(['api', `/repos/${repository}/commits/${oid}`], context),
      isAttested: ({ runId, headOid }) =>
        attestedOpeningHeadFromComments(
          openingComments(repository, headOid, context),
          pr?.created_at,
          { runId, headOid },
        ) !== null,
    });
    return { ok: true, headOid: initial.headOid };
  } catch (error) {
    if (error?.adapterReason) throw error;
    return {
      ok: false,
      reason: error?.evidenceReason ?? 'opening-head-evidence-invalid',
    };
  }
}
