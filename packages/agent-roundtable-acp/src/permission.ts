import type { RequestPermissionRequest, RequestPermissionResponse } from '@agentclientprotocol/sdk';

/**
 * The answer to an agent's permission request: the one-time reject option when it offers one, and
 * a cancelled outcome otherwise. Never an option that allows, and never one that remembers a
 * decision, so the agent never gains authority from this adapter.
 */
export function rejectPermission(request: RequestPermissionRequest): RequestPermissionResponse {
  const reject = request.options.find((option) => option.kind === 'reject_once');
  return reject
    ? { outcome: { outcome: 'selected', optionId: reject.optionId } }
    : { outcome: { outcome: 'cancelled' } };
}
