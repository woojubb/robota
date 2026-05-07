import type {
  IEventService,
  IParameterValidationResult,
  IToolExecutionContext,
  IToolResult,
  IToolSchema,
  IToolWithEventService,
  TToolArgs,
  TToolParameters,
} from '@robota-sdk/agent-core';

const FILE_MUTATION_TOOLS = new Set(['Write', 'Edit']);
const HOST_SHELL_TOOLS = new Set(['Bash', 'BackgroundProcess']);
const READ_ONLY_TOOLS = new Set(['Read', 'Glob', 'Grep', 'WebFetch', 'WebSearch']);

export type TReversibleExecutionIsolation = 'none' | 'worktree' | 'provider-sandbox';
export type TReversibleRollbackLayer = 'none' | 'edit-checkpoint' | 'worktree' | 'provider-sandbox';
export type TReversibleSideEffect =
  | 'none'
  | 'file-mutation'
  | 'shell-process'
  | 'subagent'
  | 'unknown';
export type TReversibleSafetyStatus =
  | 'reversible'
  | 'read-only'
  | 'requires-checkpoint'
  | 'requires-isolation'
  | 'unknown';

export interface IReversibleExecutionOptions {
  mode: 'local-first';
  isolation?: TReversibleExecutionIsolation;
  enforceUntrackedSideEffects?: boolean;
}

export interface IReversibleToolSafetyContext {
  checkpointAvailable: boolean;
  isolation: TReversibleExecutionIsolation;
}

export interface IReversibleToolSafetyInput {
  toolName: string;
  toolArgs?: TToolArgs;
  context: IReversibleToolSafetyContext;
}

export interface IReversibleToolSafetyReport {
  toolName: string;
  reversible: boolean;
  sideEffect: TReversibleSideEffect;
  rollbackLayer: TReversibleRollbackLayer;
  status: TReversibleSafetyStatus;
  message: string;
}

interface IReversibleExecutionToolWrapperOptions {
  safetyContext: IReversibleToolSafetyContext;
  enforceUntrackedSideEffects: boolean;
}

type TReversibleToolArgValue = string | number | boolean | object | undefined;
type TReversibleToolArgRecord = Record<string, TReversibleToolArgValue>;

export function evaluateReversibleToolSafety(
  input: IReversibleToolSafetyInput,
): IReversibleToolSafetyReport {
  const toolName = input.toolName;
  if (READ_ONLY_TOOLS.has(toolName)) {
    return {
      toolName,
      reversible: true,
      sideEffect: 'none',
      rollbackLayer: 'none',
      status: 'read-only',
      message: `${toolName} does not mutate the local workspace.`,
    };
  }

  if (FILE_MUTATION_TOOLS.has(toolName)) {
    if (input.context.isolation === 'worktree' || input.context.isolation === 'provider-sandbox') {
      return evaluateIsolatedSideEffect(toolName, 'file-mutation', input.context);
    }
    if (input.context.checkpointAvailable) {
      return {
        toolName,
        reversible: true,
        sideEffect: 'file-mutation',
        rollbackLayer: 'edit-checkpoint',
        status: 'reversible',
        message: `${toolName} is reversible through the active edit checkpoint.`,
      };
    }
    return {
      toolName,
      reversible: false,
      sideEffect: 'file-mutation',
      rollbackLayer: 'none',
      status: 'requires-checkpoint',
      message: `${toolName} requires an edit checkpoint before file mutation.`,
    };
  }

  if (HOST_SHELL_TOOLS.has(toolName)) {
    return evaluateIsolatedSideEffect(toolName, 'shell-process', input.context);
  }

  if (toolName === 'Agent') {
    return evaluateAgentSafety(input.toolArgs, input.context);
  }

  return {
    toolName,
    reversible: false,
    sideEffect: 'unknown',
    rollbackLayer: 'none',
    status: 'unknown',
    message: `${toolName} has no reversible execution contract.`,
  };
}

export function wrapReversibleExecutionTools(
  tools: readonly IToolWithEventService[],
  options: IReversibleExecutionOptions & { checkpointAvailable: boolean },
): IToolWithEventService[] {
  const safetyContext: IReversibleToolSafetyContext = {
    checkpointAvailable: options.checkpointAvailable,
    isolation: options.isolation ?? 'none',
  };
  const enforceUntrackedSideEffects = options.enforceUntrackedSideEffects ?? true;
  return tools.map(
    (tool) =>
      new ReversibleExecutionToolWrapper(tool, {
        safetyContext,
        enforceUntrackedSideEffects,
      }),
  );
}

class ReversibleExecutionToolWrapper implements IToolWithEventService {
  readonly schema: IToolSchema;

  constructor(
    private readonly delegate: IToolWithEventService,
    private readonly options: IReversibleExecutionToolWrapperOptions,
  ) {
    this.schema = delegate.schema;
  }

  setEventService(eventService: IEventService | undefined): void {
    this.delegate.setEventService(eventService);
  }

  async execute(parameters: TToolParameters, context: IToolExecutionContext): Promise<IToolResult> {
    const report = evaluateReversibleToolSafety({
      toolName: this.getName(),
      toolArgs: toToolArgs(parameters),
      context: this.options.safetyContext,
    });
    if (!report.reversible && this.options.enforceUntrackedSideEffects) {
      return createBlockedResult(report);
    }
    return this.delegate.execute(parameters, context);
  }

  validate(parameters: TToolParameters): boolean {
    return this.delegate.validate(parameters);
  }

  validateParameters(parameters: TToolParameters): IParameterValidationResult {
    return this.delegate.validateParameters(parameters);
  }

  getDescription(): string {
    return this.delegate.getDescription();
  }

  getName(): string {
    return this.delegate.getName();
  }
}

function evaluateIsolatedSideEffect(
  toolName: string,
  sideEffect: TReversibleSideEffect,
  context: IReversibleToolSafetyContext,
): IReversibleToolSafetyReport {
  if (context.isolation === 'worktree') {
    return {
      toolName,
      reversible: true,
      sideEffect,
      rollbackLayer: 'worktree',
      status: 'reversible',
      message: `${toolName} side effects are contained in an isolated Git worktree.`,
    };
  }
  if (context.isolation === 'provider-sandbox') {
    return {
      toolName,
      reversible: true,
      sideEffect,
      rollbackLayer: 'provider-sandbox',
      status: 'reversible',
      message: `${toolName} side effects are contained in a provider sandbox snapshot.`,
    };
  }
  return {
    toolName,
    reversible: false,
    sideEffect,
    rollbackLayer: 'none',
    status: 'requires-isolation',
    message: `${toolName} can create host shell side effects that edit checkpoints cannot restore; use worktree or provider sandbox isolation.`,
  };
}

function evaluateAgentSafety(
  toolArgs: TToolArgs | undefined,
  context: IReversibleToolSafetyContext,
): IReversibleToolSafetyReport {
  if (context.isolation === 'worktree' || context.isolation === 'provider-sandbox') {
    return evaluateIsolatedSideEffect('Agent', 'subagent', context);
  }

  if (agentRequestUsesWorktree(toolArgs)) {
    return {
      toolName: 'Agent',
      reversible: true,
      sideEffect: 'subagent',
      rollbackLayer: 'worktree',
      status: 'reversible',
      message:
        'Agent jobs request worktree isolation, so shell side effects stay outside the parent workspace.',
    };
  }

  return {
    toolName: 'Agent',
    reversible: false,
    sideEffect: 'subagent',
    rollbackLayer: 'none',
    status: 'requires-isolation',
    message: 'Agent jobs must request worktree isolation to be reversible in local-first mode.',
  };
}

function agentRequestUsesWorktree(toolArgs: TToolArgs | undefined): boolean {
  if (!toolArgs) return false;
  const jobs = toolArgs.jobs;
  if (Array.isArray(jobs)) {
    return (
      jobs.length > 0 &&
      jobs.every((job: TReversibleToolArgValue) => {
        if (!isToolArgRecord(job)) return false;
        return readIsolation(job) === 'worktree';
      })
    );
  }
  return readIsolation(toolArgs) === 'worktree';
}

function readIsolation(value: TReversibleToolArgRecord): string | undefined {
  const isolation = value['isolation'];
  return typeof isolation === 'string' ? isolation : undefined;
}

function isToolArgRecord(value: TReversibleToolArgValue): value is TReversibleToolArgRecord {
  return value !== undefined && typeof value === 'object' && !Array.isArray(value);
}

function toToolArgs(parameters: TToolParameters): TToolArgs | undefined {
  if (!parameters || typeof parameters !== 'object' || Array.isArray(parameters)) return undefined;
  return parameters as TToolArgs;
}

function createBlockedResult(report: IReversibleToolSafetyReport): IToolResult {
  return {
    success: true,
    data: {
      success: false,
      output: '',
      error: report.message,
      reversibleSafety: {
        toolName: report.toolName,
        sideEffect: report.sideEffect,
        rollbackLayer: report.rollbackLayer,
        status: report.status,
      },
    },
    metadata: {
      reversibleSafetyStatus: report.status,
      rollbackLayer: report.rollbackLayer,
    },
  };
}
