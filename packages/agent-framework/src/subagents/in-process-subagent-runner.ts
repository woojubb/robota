import { sumHistoryUsage } from '@robota-sdk/agent-core';

import { getBuiltInAgent } from '../agents/built-in-agents.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';

import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { ISubagentOptions } from '../assembly/create-subagent-session.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type {
  IAIProvider,
  IHookTypeExecutor,
  IToolWithEventService,
  TPermissionMode,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type {
  ISubagentJobHandle,
  ISubagentJobStart,
  ISubagentRunner,
} from '@robota-sdk/agent-executor';
import type { TPermissionHandler } from '@robota-sdk/agent-session';

type TSubagentToolExecutionEvent = Parameters<
  NonNullable<IInProcessSubagentRunnerDeps['onToolExecution']>
>[0];

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
    denied?: boolean;
    toolResultData?: string;
    executionId?: string;
  }) => void;
  customAgentRegistry?: (name: string) => IAgentDefinition | undefined;
}

export type TSubagentRunnerFactory = (deps: IInProcessSubagentRunnerDeps) => ISubagentRunner;

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
    ...(job.request.disallowedTools ? { disallowedTools: job.request.disallowedTools } : {}),
  };
}

function extractFirstArg(toolArgs?: TToolArgs): string | undefined {
  if (!toolArgs) return undefined;
  const firstValue = Object.values(toolArgs)[0];
  if (firstValue === undefined) return undefined;
  return typeof firstValue === 'object' ? JSON.stringify(firstValue) : String(firstValue);
}

function assertSupportedIsolation(job: ISubagentJobStart): void {
  if (job.request.isolation === 'worktree') {
    throw new Error('Worktree isolation requires a runtime shell subagent runner');
  }
}

function emitToolExecutionEvent(job: ISubagentJobStart, event: TSubagentToolExecutionEvent): void {
  if (event.type === 'start') {
    job.emit?.({
      type: 'background_task_tool_start',
      toolName: event.toolName,
      firstArg: extractFirstArg(event.toolArgs),
    });
    return;
  }

  job.emit?.({
    type: 'background_task_tool_end',
    toolName: event.toolName,
    success: event.success ?? true,
  });
}

/** Best-effort total token usage of a finished subagent session; never throws. */
function readSubagentUsage(
  session: ReturnType<typeof createSubagentSession>,
): ReturnType<typeof sumHistoryUsage> {
  try {
    return sumHistoryUsage(session.getFullHistory());
  } catch {
    // allow-fallback: usage capture is auxiliary — a failure to read history must not fail the subagent run
    return undefined;
  }
}

export function createInProcessSubagentRunner(deps: IInProcessSubagentRunnerDeps): ISubagentRunner {
  return {
    start(job: ISubagentJobStart): ISubagentJobHandle {
      assertSupportedIsolation(job);
      const definition = resolveAgentDefinition(job.request.type, deps.customAgentRegistry);
      const session = createSubagentSession({
        agentDefinition: applyRequestOverrides(definition, job),
        parentConfig: deps.config,
        parentContext: deps.context,
        parentTools: deps.tools,
        provider: deps.provider,
        terminal: deps.terminal,
        permissionMode: deps.permissionMode,
        // CORE-025: carry the task's permission policy + its own tool lists so the child session gates tool
        // calls by policy BEFORE the inherited session mode (deny/preapproved bind even under bypass).
        ...(job.request.permissionPolicy !== undefined
          ? { permissionPolicy: job.request.permissionPolicy }
          : {}),
        ...(job.request.allowedTools !== undefined
          ? { taskAllowedTools: job.request.allowedTools }
          : {}),
        ...(job.request.disallowedTools !== undefined
          ? { taskDisallowedTools: job.request.disallowedTools }
          : {}),
        permissionHandler: deps.permissionHandler,
        hooks: deps.hooks,
        hookTypeExecutors: deps.hookTypeExecutors,
        onTextDelta: (delta) => {
          job.emit?.({ type: 'background_task_text_delta', delta });
          deps.onTextDelta?.(delta);
        },
        onToolExecution: (event) => {
          emitToolExecutionEvent(job, event);
          deps.onToolExecution?.(event);
        },
      });

      return {
        jobId: job.jobId,
        result: session.run(job.request.prompt).then((output) => {
          // ANALYTICS-001 (Phase 2): capture the subagent's total token usage so the parent log can
          // attribute it to this agent as a source. Best-effort — never let usage capture fail the run.
          const usage = readSubagentUsage(session);
          return { jobId: job.jobId, output, ...(usage ? { usage } : {}) };
        }),
        cancel: () => {
          session.abort();
          return Promise.resolve();
        },
      };
    },
  };
}
