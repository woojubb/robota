/**
 * The session's TOOL assembly, split out of `createSession`.
 *
 * One cohesive concern: resolve the default tool tier, compose the contributed tiers on top, collapse the
 * result to one entry per tool name, and apply the session-context wrappers (edit checkpoints, reversible
 * execution). `createSession` keeps provider/prompt/permission assembly; this owns which tools exist.
 *
 * See `docs/SPEC.md` § "Session-level tool composition" for the published contract.
 */

import { assertResidentToolRemains } from '@robota-sdk/agent-core';
import { createToolSearchTool, routesFilesThroughSandbox } from '@robota-sdk/agent-tools';

import { bindAdvisorTools } from '../advisor/advisor-tool.js';
import { wrapEditCheckpointTools } from '../checkpoints/edit-checkpoint-tools.js';
import { createGoalStatusTool } from '../goal/index.js';
import { createSessionLoopDecisionTool } from '../interactive/session-loop-decision-tool.js';
import { createPeerReplyTool } from '../tools/peer-reply-tool.js';
import { createPeerSendFileTool } from '../tools/peer-send-file-tool.js';
import { wrapReversibleExecutionTools } from '../reversible-execution/index.js';

import type { ICreateSessionOptions } from './create-session-types.js';
import type { IAdvisorSessionAccess } from '../advisor/advisor-tool.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';

/**
 * Collapse the assembled tool list to one entry per tool NAME.
 *
 * Precedence: the FIRST occurrence of a name wins, over the fixed tier order
 * `defaultTools ⊕ additionalTools ⊕ goalTool`. This is the same "first entry for a name wins" rule
 * `AgentDefinitionLoader` already applies within the subagent built-in tier.
 *
 * So a contributed tool whose name is NEW is additive (the axis stays open), and a contributed tool whose
 * name collides with a framework default is DROPPED rather than listed twice — it does not silently
 * displace the default. That direction is deliberate: the default tier is built with the session context
 * (`cwd` supplies the working-directory path guard, plus the sandbox client), and a
 * context-free contribution replacing it would silently weaken those guarantees. Replacement stays fully
 * expressible — through the EXPLICIT `defaultTools` injection seam, never as a side effect of a collision.
 * That mirrors `mergeCapabilityPacks`' own rule: additive merge, never a silent override.
 */
function dedupeToolsByName(tools: readonly IToolWithEventService[]): IToolWithEventService[] {
  const seen = new Set<string>();
  const deduped: IToolWithEventService[] = [];
  for (const tool of tools) {
    const name = tool.getName();
    if (seen.has(name)) continue;
    seen.add(name);
    deduped.push(tool);
  }
  return deduped;
}

/**
 * Whether this session has anything to search FOR.
 *
 * The search tool is added only when some assembled tool declares `deferLoading` — a session of ten
 * resident built-ins gets exactly the ten it gets today, and no eleventh tool appears in a prompt
 * that has nothing to load. Whether deferral actually ENGAGES is a separate, later question the
 * per-round policy answers (`resolveToolSearchMode`); this only decides whether the door exists.
 */
function hasDeferrableTool(tools: readonly IToolWithEventService[]): boolean {
  return tools.some((tool) => tool.schema.deferLoading === true);
}

/** The assembled tool list plus the one flag the reversible-execution policy reads back. */
export interface IAssembledSessionTools {
  tools: IToolWithEventService[];
  /** Host-side edit checkpointing is active (recorder present, files not in a sandbox) — `checkpointAvailable`. */
  checkpointAvailable: boolean;
  /** The session-context wrappers `tools` got, for a tool the session adds later. */
  wrapAdded: (tools: IToolWithEventService[]) => IToolWithEventService[];
}

/** Assemble the session's tool list from the default tier, the contributed tiers, and the wrappers. */
export function assembleSessionTools(
  options: ICreateSessionOptions,
  cwd: string,
  sessionAccess: () => IAdvisorSessionAccess | undefined = () => undefined,
): IAssembledSessionTools {
  // The default tool tier is INJECTABLE. `options.defaultTools` REPLACES the host's tier outright
  // (an empty array suppresses every framework default), mirroring the `builtInAgents` seam for
  // subagents. Absent ⇒ the tier is whatever the host builds (`host.createDefaultTools`), WITH the
  // session context (cwd → the working-directory path guard, sandbox client) — which is why a name
  // collision must never silently displace it (see `dedupeToolsByName`).
  //
  // The assembly names no default tool set. A Node composition root passes `createDefaultTools` from
  // `@robota-sdk/agent-tools/defaults` to `createNodeFrameworkHost`, so the composition root chooses
  // the tier. A host that lends none (`{}`, a browser) has no default tier: the session holds
  // `additionalTools` and its own tools, and nothing else.
  const defaultTools =
    options.defaultTools ??
    options.host.createDefaultTools?.({
      cwd,
      ...(options.sandboxClient !== undefined ? { sandboxClient: options.sandboxClient } : {}),
    }) ??
    [];
  // What matters is where FILE writes land, not whether a sandbox exists. A shared-
  // filesystem sandbox confines commands but writes files on the host, so those edits still need
  // checkpoints and are not contained in any provider snapshot.
  const filesInSandbox = routesFilesThroughSandbox(options.sandboxClient);
  const checkpointAvailable = options.editCheckpointRecorder !== undefined && !filesInSandbox;
  // The DECLARED set — every tier the session was configured with, before the framework
  // adds anything of its own. Dedupe keeps the first entry for a name, so the surviving tool carries
  // its own residency marker; nothing here rewrites one.
  // The host's Advisor tool is bound to this session here, before any wrapper hides it.
  const declaredTools = dedupeToolsByName(
    bindAdvisorTools(
      [
        ...defaultTools,
        ...(options.additionalTools ?? []),
        ...(options.includeGoalTool ? [createGoalStatusTool()] : []),
        ...(options.includeSessionLoopDecisionTool ? [createSessionLoopDecisionTool()] : []),
        ...(options.peerReply ? [createPeerReplyTool(options.peerReply)] : []),
        ...(options.peerSendFile ? [createPeerSendFileTool(options.peerSendFile)] : []),
      ],
      sessionAccess,
    ),
  );
  // Asserted over the DECLARED set, before the search tool is added. Adding a resident tool first
  // would make the invariant unfailable — an all-deferred configuration would silently acquire the
  // one resident tool that satisfies it instead of being reported, which is the misconfiguration
  // this check exists to name.
  assertResidentToolRemains(declaredTools.map((tool) => tool.schema));
  const dedupedTools = hasDeferrableTool(declaredTools)
    ? dedupeToolsByName([...declaredTools, createToolSearchTool()])
    : declaredTools;
  const reversibleExecution = options.reversibleExecution
    ? {
        ...options.reversibleExecution,
        isolation:
          options.reversibleExecution.isolation ??
          (filesInSandbox ? ('provider-sandbox' as const) : undefined),
      }
    : undefined;
  // The edit-checkpoint wrap covers the ASSEMBLED set, not just the default tier: once a product can hand
  // the tool axis to its capability packs (`defaultTools: []` + pack-supplied `additionalTools`), a
  // contributed `Write`/`Edit` must still be checkpointed. With no contributed Write/Edit this is
  // byte-identical to wrapping the default tier alone. A tool added after assembly gets the same wraps.
  const wrapAdded = (tools: IToolWithEventService[]): IToolWithEventService[] => {
    const checkpointed =
      checkpointAvailable && options.editCheckpointRecorder
        ? wrapEditCheckpointTools(tools, options.editCheckpointRecorder)
        : tools;
    return reversibleExecution
      ? wrapReversibleExecutionTools(checkpointed, { ...reversibleExecution, checkpointAvailable })
      : checkpointed;
  };

  return { tools: wrapAdded(dedupedTools), checkpointAvailable, wrapAdded };
}
