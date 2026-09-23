/**
 * Leaf type module for {@link IAgentToolDeps}.
 *
 * Split out of `agent-tool.ts` so `agent-tool-batch.ts` can depend on this type without importing
 * back from `agent-tool.ts`, which previously created an import cycle between the two.
 */
import type { IInProcessSubagentRunnerDeps } from '../subagents/index.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { TModelEffort } from '@robota-sdk/agent-core';
import type { ISubagentManager, IBackgroundTaskManager } from '@robota-sdk/agent-executor';

/** Dependencies injected at creation time via createAgentTool factory */
export interface IAgentToolDeps extends IInProcessSubagentRunnerDeps {
  cwd?: string;
  parentSessionId?: string;
  subagentDepth?: number;
  subagentManager?: ISubagentManager;
  backgroundTaskManager?: IBackgroundTaskManager;
  /** Optional custom agent registry for resolving non-built-in agent types. */
  customAgentRegistry?: (name: string) => IAgentDefinition | undefined;
  /** Model-visible and command-visible agent definitions available to this session. */
  agentDefinitions?: IAgentDefinition[];
  /** The parent Session's concrete effort, if it overrides provider-default selection. */
  getParentModelEffort?: () => TModelEffort | undefined;
  /** PRESET-016 — runtime gate; when present and returns false, subagent dispatch is refused. */
  isParallelSubagentsEnabled?: () => boolean;
}
