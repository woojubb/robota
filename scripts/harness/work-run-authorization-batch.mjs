import { fetchPostFindingsAuthorizations } from './post-findings-authorization.mjs';
import { isWorkRunVerificationBudgetError } from './work-run-verification-runtime.mjs';

function authorizationRequests(receipt) {
  const requests = new Map();
  for (const event of receipt.events ?? []) {
    if (event.type !== 'work.reopened' || event.data?.generation < 1) continue;
    const commentId = event.data?.authorization?.commentId;
    if (!Number.isSafeInteger(commentId)) continue;
    const current = requests.get(commentId);
    if (!current || Date.parse(event.at) < Date.parse(current.authorizedAt)) {
      requests.set(commentId, { commentId, authorizedAt: event.at });
    }
  }
  return [...requests.values()];
}

export function authorizationValidationOptions(options) {
  const normalized = {
    subjectRef: 'HEAD',
    subjectBranch: null,
    currentPrNumber: null,
    prObservation: 'post-push',
    fetchAuthorization: null,
    fetchAuthorizations: fetchPostFindingsAuthorizations,
    fetchPullRequestEvidence: null,
    ...options,
  };
  if (
    typeof options.fetchAuthorization === 'function' &&
    options.fetchAuthorizations === undefined
  ) {
    normalized.fetchAuthorizations = null;
  }
  return normalized;
}

export function loadLiveAuthorizations(context) {
  const requests = authorizationRequests(context.receipt);
  if (requests.length === 0) return { ok: true, authorizations: new Map() };
  try {
    const values = context.fetchAuthorizations
      ? context.fetchAuthorizations({
          repository: context.repository,
          prNumber: context.currentPrNumber,
          requests,
          runtime: context.runtime,
        })
      : requests.map((request) =>
          context.fetchAuthorization({
            repository: context.repository,
            ...request,
            runtime: context.runtime,
          }),
        );
    const authorizations = new Map(values.map((value) => [value.commentId, value]));
    return authorizations.size === requests.length
      ? { ok: true, authorizations }
      : { ok: false, reason: 'authorization-comment-unverified' };
  } catch (error) {
    if (isWorkRunVerificationBudgetError(error)) throw error;
    return { ok: false, reason: 'authorization-comment-unverified' };
  }
}
