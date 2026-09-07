import { sumHistoryUsage } from '@robota-sdk/agent-core';
import { subagentExecutionRoot } from '@robota-sdk/agent-executor';

import { getBuiltInAgent } from '../agents/built-in-agents.js';
import { createSubagentSession } from '../assembly/create-subagent-session.js';
import { restoreSessionRecordIntoSession } from '../interactive/interactive-session-restore.js';

import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { ISubagentOptions } from '../assembly/create-subagent-session.js';
import type { ISystemCommandSemanticRoles } from '../command-api/index.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IInteractiveSessionStore } from '../interactive/session-persistence.js';
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
   * Consulted AFTER `customAgentRegistry` and `builtInAgents`, by both runners. Absent ⇒ the
   * composition root offered no roster; `agent-subagent-runner` then fails closed rather than
   * silently resolving against a set the product never chose, while the in-process runner — which
   * lives in the package that OWNS the built-ins — falls back to them.
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
  /**
   * CLI-1994: the interactive-session record store a job's `resumeSessionId` names a record in — the
   * store `/fork` wrote the copy to. The runner only ever READS it, to restore the copied conversation
   * and its assembled system message into the child session before the first turn; the conversation
   * itself never travels on the request (ARCH-044). A fork job on a runner with no store fails, stated
   * as such, rather than starting empty.
   */
  resumeSessionStore?: IInteractiveSessionStore;
}

export type TSubagentRunnerFactory = (deps: IInProcessSubagentRunnerDeps) => ISubagentRunner;

/**
 * Both runners consult the same sources in the same ORDER: custom registry, injected set, then the
 * parent's roster. They differ only in the last resort, and only because of where each one lives.
 *
 * Reported in review of issue #1854's agent axis: the first cut documented `agentDefinitions` on the
 * shared deps type and wired it in the child-process runner alone, so a caller that supplied it saw
 * it silently ignored here. A field one implementer honours and the other drops is the asymmetry
 * ARCH-034 was about, reintroduced by the change closing its sibling.
 *
 * This runner keeps `getBuiltInAgent` as the last resort, and that is not the axis violation: it is
 * the framework's own runner reading the framework's own built-ins, in the package that owns them.
 * The violation was a NEUTRAL package importing them across a process boundary to compose a surface
 * the product had already decided — which is why `agent-subagent-runner` fails closed instead.
 */
function resolveAgentDefinition(
  agentType: string,
  deps: Pick<
    IInProcessSubagentRunnerDeps,
    'customAgentRegistry' | 'builtInAgents' | 'agentDefinitions'
  >,
): IAgentDefinition {
  const definition =
    deps.customAgentRegistry?.(agentType) ??
    deps.builtInAgents?.find((agent) => agent.name === agentType) ??
    deps.agentDefinitions?.find((agent) => agent.name === agentType) ??
    getBuiltInAgent(agentType);
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
    // The message names the recovery because this is where the operator meets it: the manager marks
    // the task failed and shows this text, after the command that spawned it has already returned.
    throw new Error(
      'Worktree isolation requires a runtime shell subagent runner, and this session runs subagents ' +
        'in-process. Ask for the job without isolation — `/fork --same-dir`, or `isolation: "none"` ' +
        'on a spawn — or run under a composition whose providers the child process can rebuild.',
    );
  }
}

/**
 * CLI-1994: a job that names a session record restores it — messages and assembled system message —
 * into the freshly built child before its first turn. Only the id reached this runner; the record is
 * read here. No store means the fork cannot be honoured, and that is a failed job, not an empty one.
 */
function resumeRequestedRecord(
  job: ISubagentJobStart,
  session: ReturnType<typeof createSubagentSession>,
  resumeSessionStore: IInteractiveSessionStore | undefined,
): void {
  const resumeSessionId = job.request.resumeSessionId;
  if (resumeSessionId === undefined) return;
  if (resumeSessionStore === undefined) {
    throw new Error(
      `Subagent job ${job.taskId} asks to resume session ${resumeSessionId}, but this runner was ` +
        'composed without a session record store (resumeSessionStore).',
    );
  }
  restoreSessionRecordIntoSession(resumeSessionStore, resumeSessionId, session);
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
      resumeRequestedRecord(job, session, deps.resumeSessionStore);

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
