import type {
  IAIProvider,
  IHookTypeExecutor,
  IToolWithEventService,
  TPermissionMode,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type { ITerminalOutput, TPermissionHandler } from '@robota-sdk/agent-sessions';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import { getBuiltInAgent } from '../agents/built-in-agents.js';
import type { ISubagentOptions } from '../assembly/create-subagent-session.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { ISubagentJobHandle, ISubagentJobStart, ISubagentRunner } from './types.js';

export interface IInProcessSubagentRunnerDeps {
  config: IResolvedConfig;
  context: ILoadedContext;
  tools: IToolWithEventService[];
  terminal: ITerminalOutput;
  provider: IAIProvider;
  permissionMode?: TPermissionMode;
  permissionHandler?: TPermissionHandler;
  hooks?: ISubagentOptions['hooks'];
  hookTypeExecutors?: IHookTypeExecutor[];
  onTextDelta?: (delta: string) => void;
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
  }) => void;
  customAgentRegistry?: (name: string) => IAgentDefinition | undefined;
}

function resolveAgentDefinition(
  agentType: string,
  customRegistry?: (name: string) => IAgentDefinition | undefined,
): IAgentDefinition {
  const definition = customRegistry?.(agentType) ?? getBuiltInAgent(agentType);
  if (!definition) {
    throw new Error(`Unknown agent type: ${agentType}`);
  }
  return definition;
}

function applyRequestOverrides(
  definition: IAgentDefinition,
  job: ISubagentJobStart,
): IAgentDefinition {
  return {
    ...definition,
    ...(job.request.model ? { model: job.request.model } : {}),
    ...(job.request.allowedTools ? { tools: job.request.allowedTools } : {}),
  };
}

export function createInProcessSubagentRunner(deps: IInProcessSubagentRunnerDeps): ISubagentRunner {
  return {
    start(job: ISubagentJobStart): ISubagentJobHandle {
      const definition = resolveAgentDefinition(job.request.type, deps.customAgentRegistry);
      const session = createSubagentSession({
        agentDefinition: applyRequestOverrides(definition, job),
        parentConfig: deps.config,
        parentContext: deps.context,
        parentTools: deps.tools,
        provider: deps.provider,
        terminal: deps.terminal,
        permissionMode: deps.permissionMode,
        permissionHandler: deps.permissionHandler,
        hooks: deps.hooks,
        hookTypeExecutors: deps.hookTypeExecutors,
        onTextDelta: deps.onTextDelta,
        onToolExecution: deps.onToolExecution,
      });

      return {
        jobId: job.jobId,
        result: session.run(job.request.prompt).then((output) => ({
          jobId: job.jobId,
          output,
        })),
        cancel: () => {
          session.abort();
          return Promise.resolve();
        },
      };
    },
  };
}
