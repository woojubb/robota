/**
 * ARCH-006 — the session's TOOL assembly, split out of `createSession`.
 *
 * One cohesive concern: resolve the default tool tier, compose the contributed tiers on top, collapse the
 * result to one entry per tool name, and apply the session-context wrappers (edit checkpoints, reversible
 * execution). `createSession` keeps provider/prompt/permission assembly; this owns which tools exist.
 *
 * See `docs/SPEC.md` § "Session-level tool composition" for the published contract.
 */

import { createDefaultTools } from '@robota-sdk/agent-tool-defaults';

import { wrapEditCheckpointTools } from '../checkpoints/edit-checkpoint-tools.js';
import { createGoalStatusTool } from '../goal/index.js';
import { wrapReversibleExecutionTools } from '../reversible-execution/index.js';

import type { ICreateSessionOptions } from './create-session-types.js';
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
 * (`cwd` supplies the working-directory path guard, plus the sandbox client and retrieval adapter), and a
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

/** The assembled tool list plus the one flag the reversible-execution policy reads back. */
export interface IAssembledSessionTools {
  tools: IToolWithEventService[];
  /** Host-side edit checkpointing is active (recorder present, no sandbox) — `checkpointAvailable`. */
  checkpointAvailable: boolean;
}

/** Assemble the session's tool list from the default tier, the contributed tiers, and the wrappers. */
export function assembleSessionTools(
  options: ICreateSessionOptions,
  cwd: string,
): IAssembledSessionTools {
  // The default tool tier is INJECTABLE. `options.defaultTools` REPLACES `createDefaultTools()` outright
  // (an empty array suppresses every framework default), mirroring NEUT-003's `builtInAgents` seam for
  // subagents. Absent ⇒ the framework tier is constructed exactly as before, WITH the session context
  // (cwd → the working-directory path guard, sandbox client, retrieval adapter) — which is why a name
  // collision must never silently displace it (see `dedupeToolsByName`).
  const defaultTools =
    options.defaultTools ??
    createDefaultTools({
      sandboxClient: options.sandboxClient,
      cwd,
      ...(options.retrievalAdapter ? { retrievalAdapter: options.retrievalAdapter } : {}),
    });
  const checkpointAvailable =
    options.editCheckpointRecorder !== undefined && options.sandboxClient === undefined;
  const dedupedTools = dedupeToolsByName([
    ...defaultTools,
    ...(options.additionalTools ?? []),
    ...(options.includeGoalTool ? [createGoalStatusTool()] : []),
  ]);
  // The edit-checkpoint wrap covers the ASSEMBLED set, not just the default tier: once a product can hand
  // the tool axis to its capability packs (`defaultTools: []` + pack-supplied `additionalTools`), a
  // contributed `Write`/`Edit` must still be checkpointed. With no contributed Write/Edit this is
  // byte-identical to wrapping the default tier alone.
  const assembledTools =
    checkpointAvailable && options.editCheckpointRecorder
      ? wrapEditCheckpointTools(dedupedTools, options.editCheckpointRecorder)
      : dedupedTools;
  const reversibleExecution = options.reversibleExecution
    ? {
        ...options.reversibleExecution,
        isolation:
          options.reversibleExecution.isolation ??
          (options.sandboxClient ? ('provider-sandbox' as const) : undefined),
      }
    : undefined;

  return {
    tools: reversibleExecution
      ? wrapReversibleExecutionTools(assembledTools, {
          ...reversibleExecution,
          checkpointAvailable,
        })
      : assembledTools,
    checkpointAvailable,
  };
}
