/**
 * MCP-002: the ONE place that turns product startup inputs into a live `IMcpClientComposition`,
 * completing the reachability step MCP-002's spec asks for — sourcing (`mcp-definition-sources.ts`)
 * → workspace projection (`mcp-workspace.ts`) → composition (`mcp-client-composition.ts`, MCP-002's
 * existing manager wiring) → the `/mcp` adapter and connected tools `cli.ts` consumes.
 */

import { createNodeWorkspaceTrustStore } from '@robota-sdk/agent-framework';

import { createMcpClientComposition } from './mcp-client-composition.js';
import { resolveMcpDefinitions } from './mcp-definition-sources.js';
import { toMcpActivationWorkspace } from './mcp-workspace.js';

import type {
  IWorkspaceIdentity,
  TSettingsSource,
  TWorkspaceProjectAccess,
  TWorkspaceTrustState,
} from '@robota-sdk/agent-framework';
import type { IMcpClientComposition } from './mcp-client-composition.js';

/** The raw `{ state, generation }` a workspace-trust inspection produces for one `cwd`. */
export interface IMcpWorkspaceTrustSnapshot {
  readonly state: TWorkspaceTrustState;
  readonly generation: number;
}

export interface IComposeMcpClientForStartupInput {
  readonly settingsSources: readonly TSettingsSource[];
  readonly projectAccess: TWorkspaceProjectAccess;
  readonly cwd: string;
  readonly env: NodeJS.ProcessEnv;
  /** Every sourcing/admission/connection problem, one line each — never swallowed. */
  readonly reportDiagnostic: (message: string) => void;
  /** Overridable for tests; defaults to the real node host workspace-trust store. */
  readonly inspectTrust?: (cwd: string) => Promise<IMcpWorkspaceTrustSnapshot>;
}

/**
 * The real trust inspection, keyed by the IDENTITY `projectAccess` already resolved — never
 * re-derived from `cwd` via a fresh Git call. A caller is free to supply a `projectAccess` whose
 * identity did not come from this process's `cwd` at all (an embedding host, or a test fixture like
 * `createTrustedWorkspaceProjectAccess`); re-resolving from `cwd` would then either disagree with
 * that identity or, for a `cwd` that is not a Git worktree at all, throw outright. Reusing
 * `agent-framework`'s own trust store (`node-host-workspace-trust.ts`) is the one thing this
 * function does — no store file is read directly.
 */
async function inspectRealWorkspaceTrust(
  identity: IWorkspaceIdentity,
): Promise<IMcpWorkspaceTrustSnapshot> {
  return createNodeWorkspaceTrustStore().inspect(identity);
}

/**
 * Compose the product's live MCP client for one startup: source every layer's `mcpServers`,
 * report every problem, resolve the workspace-trust snapshot, and hand both to
 * `createMcpClientComposition`.
 *
 * Zero resolved definitions is a normal outcome — the returned composition's adapter simply lists
 * nothing, and `connect()` opens no connections.
 */
export async function composeMcpClientForStartup(
  input: IComposeMcpClientForStartupInput,
): Promise<IMcpClientComposition> {
  const { entries, problems } = resolveMcpDefinitions(input.settingsSources, input.env);
  for (const problem of problems) {
    input.reportDiagnostic(
      `MCP definition "${problem.name}" from ${problem.source} (${problem.origin}) was refused: ${problem.reason}`,
    );
  }

  // Restricted-without-identity means the workspace identity itself does not resolve
  // (`IRestrictedWorkspaceProjectAccess`'s `identity-unavailable` state) — the same state
  // `toMcpActivationWorkspace` reads straight off `projectAccess` in that case, so the trust
  // inspection (which needs a resolvable identity) is never attempted.
  const identity = input.projectAccess.identity;
  const trust: IMcpWorkspaceTrustSnapshot =
    identity === undefined
      ? { state: 'identity-unavailable', generation: 0 }
      : await (input.inspectTrust ?? (() => inspectRealWorkspaceTrust(identity)))(input.cwd);

  const workspace = toMcpActivationWorkspace(input.projectAccess, trust);

  return createMcpClientComposition({
    resolvedEntries: entries,
    workspace,
    reportDiagnostic: input.reportDiagnostic,
  });
}
