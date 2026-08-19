import { sumHistoryUsage } from '@robota-sdk/agent-core';
import { subagentExecutionRoot } from '@robota-sdk/agent-executor';

import { getBuiltInAgent } from '../agents/built-in-agents.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';

import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { ISubagentOptions } from '../assembly/create-subagent-session.js';
import type { ISystemCommandSemanticRoles } from '../command-api/index.js';
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
import type { ISandboxClient } from '@robota-sdk/agent-tools';

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
  /**
   * NEUT-003: injectable built-in agent set. When supplied it REPLACES the module
   * built-ins (`BUILT_IN_AGENTS`) for type resolution; an empty array removes all
   * built-ins. Omitted keeps the documented default three.
   */
  builtInAgents?: readonly IAgentDefinition[];
  /**
   * The PARENT's resolved agent roster — discovered definitions merged over the built-in tier.
   *
   * Issue #1854, the agent axis. A runner in another process used to resolve an unknown type by
   * importing `getBuiltInAgent` from this package's barrel, which is the same "compose from imported
   * defaults instead of from the product" shape ARCH-021 closed on the provider axis and ARCH-035 on
   * the tool axis. The parent already knows the answer — `buildAgentRuntime` computes this list —
   * so carrying it is what lets the child stop asking the framework.
   *
   * Absent ⇒ the composition root offered no roster, and an unresolved type fails closed rather than
   * silently falling back to a set the product never chose.
   */
  agentDefinitions?: readonly IAgentDefinition[];
  commandSemanticRoles?: ISystemCommandSemanticRoles;
  /**
   * ARCH-034: which session-assembly tiers the PARENT's tool surface carried.
   *
   * The in-process runner does not read it — it receives the parent's already-assembled `tools`. A
   * runner that rebuilds the surface in another process does, and this is the only place the parent's
   * choice is still in scope. Without it the child assembles a DIFFERENT surface from the sibling
   * that shares this contract, which is the asymmetry ARCH-034 is about.
   */
  sessionTiers?: { readonly includeGoalTool?: boolean };
  /**
   * ARCH-033: the parent's sandbox and the NAME a child uses to rebuild one like it.
   *
   * A live client cannot cross a process boundary; `(type, snapshotId)` can. Both halves are carried
   * because either alone is worse than neither — a snapshot with no registered type is a reference
   * nothing opens, and a type with no snapshot rebuilds an EMPTY sandbox, which is a child that looks
   * sandboxed while sharing none of the parent's state.
   */
  sandboxClient?: ISandboxClient;
  sandboxType?: string;
}

export type TSubagentRunnerFactory = (deps: IInProcessSubagentRunnerDeps) => ISubagentRunner;

function resolveAgentDefinition(
  agentType: string,
  deps: Pick<IInProcessSubagentRunnerDeps, 'customAgentRegistry' | 'builtInAgents'>,
): IAgentDefinition {
  const definition =
    deps.customAgentRegistry?.(agentType) ??
    (deps.builtInAgents
      ? deps.builtInAgents.find((agent) => agent.name === agentType)
      : getBuiltInAgent(agentType));
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
      const definition = resolveAgentDefinition(job.request.agentType, deps);
      const session = createSubagentSession({
        agentDefinition: applyRequestOverrides(definition, job),
        parentConfig: deps.config,
        parentContext: deps.context,
        parentTools: deps.tools,
        provider: deps.provider,
        terminal: deps.terminal,
        // ARCH-010: the spawn request has always declared `cwd` required; there was simply no option
        // to pass it to, so the child session read `process.cwd()` — the PARENT's directory.
        cwd: subagentExecutionRoot(job),
        permissionMode: deps.permissionMode,
        ...(deps.commandSemanticRoles ? { commandSemanticRoles: deps.commandSemanticRoles } : {}),
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
        taskId: job.taskId,
        result: session.run(job.request.prompt).then((output) => {
          // ANALYTICS-001 (Phase 2): capture the subagent's total token usage so the parent log can
          // attribute it to this agent as a source. Best-effort — never let usage capture fail the run.
          const usage = readSubagentUsage(session);
          return { taskId: job.taskId, output, ...(usage ? { usage } : {}) };
        }),
        cancel: () => {
          session.abort();
          return Promise.resolve();
        },
      };
    },
  };
}
