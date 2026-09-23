/**
 * MCP-002: project the product's own workspace-trust decision into the secret-free
 * `IMCPActivationWorkspace` `agent-mcp`'s admission service reads (MCP-001). No I/O — both inputs
 * are already-resolved decisions; this module only reshapes them.
 */

import type { TWorkspaceProjectAccess, TWorkspaceTrustState } from '@robota-sdk/agent-framework';
import type { IMCPActivationWorkspace, TMCPWorkspaceTrustState } from '@robota-sdk/agent-mcp';

/**
 * `agent-framework`'s `TWorkspaceTrustState` and `agent-mcp`'s `TMCPWorkspaceTrustState` name the
 * same six states. They are two separate declarations (ADR-005's "one declaration cannot diverge
 * from itself" applies one level up, across packages, not within one), so this maps by VALUE
 * through an exhaustive switch rather than a cast — a member added to one union without the other
 * fails here at compile time instead of silently reading as `undefined`.
 */
function mapTrustState(state: TWorkspaceTrustState): TMCPWorkspaceTrustState {
  switch (state) {
    case 'trusted':
      return 'trusted';
    case 'untrusted':
      return 'untrusted';
    case 'revoked':
      return 'revoked';
    case 'stale/replaced':
      return 'stale/replaced';
    case 'identity-unavailable':
      return 'identity-unavailable';
    case 'store-unavailable':
      return 'store-unavailable';
  }
}

/**
 * `trust` carries the workspace-trust GENERATION, which `TWorkspaceProjectAccess` itself never
 * exposes (`WorkspaceTrustService` tracks it internally to detect a replaced worktree, but returns
 * only the admission decision) — the caller resolves it separately, e.g. via the node host trust
 * store's own `inspect`.
 */
export function toMcpActivationWorkspace(
  projectAccess: TWorkspaceProjectAccess,
  trust: { readonly state: TWorkspaceTrustState; readonly generation: number },
): IMCPActivationWorkspace {
  if (projectAccess.status === 'trusted') {
    return {
      repositoryKey: projectAccess.identity.repositoryKey,
      trustState: mapTrustState(trust.state),
      generation: trust.generation,
    };
  }

  // `identity` is present for every restricted state except `identity-unavailable`
  // (`IRestrictedWorkspaceProjectAccess`'s own doc comment) — when it is absent, the access's own
  // `trustState` is authoritative (it IS `'identity-unavailable'`), not the separately-resolved
  // `trust` argument.
  if (projectAccess.identity === undefined) {
    return {
      repositoryKey: 'identity-unavailable',
      trustState: mapTrustState(projectAccess.trustState),
      generation: trust.generation,
    };
  }

  return {
    repositoryKey: projectAccess.identity.repositoryKey,
    trustState: mapTrustState(trust.state),
    generation: trust.generation,
  };
}
