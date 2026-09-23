/**
 * MCP-002: the ONE place that turns product startup inputs into a live `IMcpClientComposition`,
 * completing the reachability step MCP-002's spec asks for — sourcing (`mcp-definition-sources.ts`)
 * → workspace projection (`mcp-workspace.ts`) → composition (`mcp-client-composition.ts`, MCP-002's
 * existing manager wiring) → the `/mcp` adapter and connected tools `cli.ts` consumes.
 *
 * MCP-004 S3 adds: reading `mcp.autoBackgroundMs` / `mcp.callTimeoutMs` beside `mcpServers`
 * (`mcp-settings.ts`), setting the supervisor's `toolCallMs` from the resolved `callTimeoutMs`, and
 * — via {@link IMcpStartupComposition.buildToolCallHandoff} — producing the per-mode
 * `toolCallHandoff` session-option contribution once `connect()` has resolved. `print` never
 * receives a policy; a positive `autoBackgroundMs` in `print` mode is reported once as ignored.
 */

import { createNodeWorkspaceTrustStore } from '@robota-sdk/agent-framework';

import { buildMcpClientTimeouts, createMcpClientComposition } from './mcp-client-composition.js';
import { resolveMcpDefinitions } from './mcp-definition-sources.js';
import { resolveMcpSettings } from './mcp-settings.js';
import { toMcpActivationWorkspace } from './mcp-workspace.js';

import type {
  IWorkspaceIdentity,
  TSettingsSource,
  TWorkspaceProjectAccess,
  TWorkspaceTrustState,
} from '@robota-sdk/agent-framework';
import type {
  IToolCallHandoffPolicy,
  IToolCallHandoffProvenance,
} from '@robota-sdk/agent-framework';
import type { TPermissionMode } from '@robota-sdk/agent-core';
import type { IMCPStdioAuthority } from '@robota-sdk/agent-mcp';
import type { IMcpClientComposition } from './mcp-client-composition.js';

/**
 * The three session runtimes that ever compose MCP tools (spec § Modes). `interactive` is the ink
 * TUI, `serve` is the headless GUI runtime over the same `InteractiveSession`; both adopt
 * `toolCallHandoff`. `print` is a one-shot run with no drain and never adopts it.
 */
export type TMcpStartupMode = 'interactive' | 'serve' | 'print';

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
  /** Host execution capabilities supplied independently of settings. */
  readonly stdioAuthorities?: Readonly<Record<string, IMCPStdioAuthority>>;
  /** Every sourcing/admission/connection/settings problem, one line each — never swallowed. */
  readonly reportDiagnostic: (message: string) => void;
  /** Overridable for tests; defaults to the real node host workspace-trust store. */
  readonly inspectTrust?: (cwd: string) => Promise<IMcpWorkspaceTrustSnapshot>;
  /** MCP-004 S3: which runtime this composition serves — gates `toolCallHandoff` (§ Modes). */
  readonly mode: TMcpStartupMode;
}

/**
 * MCP-002's composition plus MCP-004 S3's per-mode `toolCallHandoff` builder. `buildToolCallHandoff`
 * reads `connect()`'s already-resolved tool provenance (`IMcpClientComposition.connectedToolProvenance`)
 * — call it AFTER `await connect()`, exactly where `cli.ts` builds each mode's session options.
 */
export interface IMcpStartupComposition extends IMcpClientComposition {
  /**
   * `undefined` in every one of these cases: `mode === 'print'`; `mcp.autoBackgroundMs === 0`; or
   * `mcp.autoBackgroundMs >= mcp.callTimeoutMs` (already reported as one diagnostic by
   * `composeMcpClientForStartup`). Otherwise carries `thresholdMs`/`budgetMs` from the resolved
   * settings and one provenance entry per tool `connect()` returned, stamped with `permissionMode`.
   */
  buildToolCallHandoff(
    permissionMode: TPermissionMode | undefined,
  ): IToolCallHandoffPolicy | undefined;
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
 * resolve `mcp.autoBackgroundMs` / `mcp.callTimeoutMs` (MCP-004 S3) from the SAME layers, report
 * every problem, resolve the workspace-trust snapshot, and hand it all to
 * `createMcpClientComposition`.
 *
 * Zero resolved definitions is a normal outcome — the returned composition's adapter simply lists
 * nothing, and `connect()` opens no connections.
 */
export async function composeMcpClientForStartup(
  input: IComposeMcpClientForStartupInput,
): Promise<IMcpStartupComposition> {
  const { entries, problems } = resolveMcpDefinitions(input.settingsSources, input.env);
  for (const problem of problems) {
    input.reportDiagnostic(
      `MCP definition "${problem.name}" from ${problem.source} (${problem.origin}) was refused: ${problem.reason}`,
    );
  }

  const settings = resolveMcpSettings(input.settingsSources);
  for (const problem of settings.problems) {
    input.reportDiagnostic(
      `MCP setting "${problem.key}" from ${problem.source} (${problem.origin}) was refused: ${problem.reason}`,
    );
  }
  for (const diagnostic of settings.diagnostics) input.reportDiagnostic(diagnostic);
  // spec § Modes: `print` is a one-shot run with no drain and never adopts the policy; a positive
  // `autoBackgroundMs` is still the operator's stated intent, so its being ignored here is reported
  // once — independently of `settings.handoffEnabled` (an already-disabled setting has nothing new
  // to say in print mode, and stays silent per the `0`/`>=` rules above).
  if (input.mode === 'print' && settings.autoBackgroundMs > 0) {
    input.reportDiagnostic(
      'MCP tool-call handoff ("mcp.autoBackgroundMs") is ignored in print mode; a long MCP tool call ' +
        'runs to completion in the foreground, bounded only by "mcp.callTimeoutMs".',
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

  const mcp = createMcpClientComposition({
    resolvedEntries: entries,
    workspace,
    ...(input.stdioAuthorities === undefined ? {} : { stdioAuthorities: input.stdioAuthorities }),
    timeouts: buildMcpClientTimeouts(settings.callTimeoutMs),
    reportDiagnostic: input.reportDiagnostic,
  });

  function buildToolCallHandoff(
    permissionMode: TPermissionMode | undefined,
  ): IToolCallHandoffPolicy | undefined {
    if (input.mode !== 'interactive' && input.mode !== 'serve') return undefined;
    if (!settings.handoffEnabled) return undefined;

    // `IToolCallHandoffProvenance.permissionMode` is informational metadata for `/tasks` and the
    // notification, never an enforcement carrier (spec § Permission context and provenance) — so
    // when the shell has not resolved an explicit mode yet, this mirrors the framework's OWN
    // ultimate fallback (`create-session-runtime.ts`'s `options.permissionMode ?? ... ?? 'default'`)
    // rather than inventing a second default.
    const resolvedPermissionMode: string = permissionMode ?? 'default';
    const toolNames: string[] = [];
    const provenance: Record<string, IToolCallHandoffProvenance> = {};
    for (const [canonicalName, toolProvenance] of mcp.connectedToolProvenance) {
      toolNames.push(canonicalName);
      provenance[canonicalName] = {
        serverId: toolProvenance.serverId,
        sourceName: toolProvenance.sourceName,
        securityIdentity: toolProvenance.securityIdentity,
        permissionMode: resolvedPermissionMode,
      };
    }

    return {
      thresholdMs: settings.autoBackgroundMs,
      budgetMs: settings.callTimeoutMs,
      toolNames,
      provenance,
    };
  }

  return { ...mcp, buildToolCallHandoff };
}
