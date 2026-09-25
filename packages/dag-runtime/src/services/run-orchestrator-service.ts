import {
  TimeSemanticsService,
  buildDispatchError,
  buildValidationError,
  buildTaskExecutionError,
  type IClockPort,
  type IDagError,
  type IRunProgressEventReporter,
  type IQueuePort,
  type IStoragePort,
  type TDagRunStatus,
  type TDagTriggerType,
  type TPortPayload,
  type TResult,
  type ITaskSnapshotBudget,
  type IDagExecutionLineage,
  decodeDagExecutionLineage,
} from '@robota-sdk/dag-core';
import { parsePortPayload, parseDefinitionSnapshot } from './snapshot-parser.js';
import { dispatchEntryTasks } from './entry-task-dispatcher.js';

/** Structural equality for decoded lineage; field order in the persisted record is not significant. */
function lineagesEqual(
  a: IDagExecutionLineage | undefined,
  b: IDagExecutionLineage | undefined,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return (
    a.rootRunId === b.rootRunId &&
    a.parentRunId === b.parentRunId &&
    a.depth === b.depth &&
    a.maxDepth === b.maxDepth &&
    a.ancestorCompositeNodeTypes.length === b.ancestorCompositeNodeTypes.length &&
    a.ancestorCompositeNodeTypes.every((type, index) => type === b.ancestorCompositeNodeTypes[index])
  );
}

/** Input parameters for initiating a DAG run. */
export interface IStartRunInput {
  /** Trusted host-provided ancestry for a composite child run. */
  lineage?: IDagExecutionLineage;
  dagId: string;
  version?: number;
  trigger: TDagTriggerType;
  logicalDate?: string;
  rerunKey?: string;
  input: TPortPayload;
}

/** Result returned after a DAG run record is created (before task dispatch). */
export interface ICreateRunResult {
  dagRunId: string;
  dagId: string;
  version: number;
  logicalDate: string;
  status: TDagRunStatus;
}

/** Result returned after a DAG run is fully started with entry tasks dispatched. */
export interface IStartRunResult {
  dagRunId: string;
  dagId: string;
  version: number;
  logicalDate: string;
  taskRunIds: string[];
}

/**
 * Orchestrates the lifecycle of DAG runs: creation, validation, state
 * transitions, and entry-task dispatch.
 *
 * @see IStoragePort for persistence contracts
 * @see IQueuePort for task queue contracts
 * @see DagRunStateMachine for run state transitions
 */
export class RunOrchestratorService {
  private readonly timeSemanticsService: TimeSemanticsService;

  public constructor(
    private readonly storage: IStoragePort,
    private readonly queue: IQueuePort,
    private readonly clock: IClockPort,
    private readonly runProgressEventReporter?: IRunProgressEventReporter,
    private readonly snapshotBudget?: ITaskSnapshotBudget,
  ) {
    this.timeSemanticsService = new TimeSemanticsService(clock);
  }

  /**
   * Creates a DAG run record without dispatching tasks. Validates the
   * definition, resolves time semantics, and enforces idempotency via run key.
   */
  public async createRun(input: IStartRunInput): Promise<TResult<ICreateRunResult, IDagError>> {
    const definition = input.version
      ? await this.storage.getDefinition(input.dagId, input.version)
      : await this.storage.getLatestPublishedDefinition(input.dagId);

    if (!definition) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_DEFINITION_NOT_FOUND',
          'Published DAG definition was not found',
          { dagId: input.dagId, hasVersion: Boolean(input.version) },
        ),
      };
    }
    if (definition.status !== 'published') {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_DEFINITION_NOT_PUBLISHED',
          'Only published definitions can be executed',
          { dagId: definition.dagId, version: definition.version, status: definition.status },
        ),
      };
    }

    const resolvedTime = this.timeSemanticsService.resolve(input.trigger, input.logicalDate);
    if (!resolvedTime.ok) {
      return resolvedTime;
    }

    let lineage: IDagExecutionLineage | undefined;
    try {
      lineage = decodeDagExecutionLineage(input.lineage);
    } catch {
      return { ok: false, error: buildValidationError(
        'DAG_VALIDATION_RUN_LINEAGE_INVALID',
        'Composite child run lineage is invalid',
        { dagId: definition.dagId },
      ) };
    }

    const runKey = input.rerunKey
      ? `${definition.dagId}:${resolvedTime.value.logicalDate}:rerun:${input.rerunKey}`
      : `${definition.dagId}:${resolvedTime.value.logicalDate}`;
    const existingRun = await this.storage.getDagRunByRunKey(runKey);
    if (existingRun) {
      let existingLineage: IDagExecutionLineage | undefined;
      try {
        existingLineage = decodeDagExecutionLineage(existingRun.lineage);
      } catch {
        return { ok: false, error: buildValidationError(
          'DAG_VALIDATION_RUN_LINEAGE_INVALID',
          'Existing run for this run key has invalid persisted lineage',
          { dagId: definition.dagId, runKey },
        ) };
      }
      // A run key is meant to dedupe retries of the SAME logical trigger, not to let a differently
      // ancestored composite child reuse another child's run record. Silently returning the
      // existing run here would let that second caller inherit the wrong depth/ancestry authority.
      if (!lineagesEqual(existingLineage, lineage)) {
        return { ok: false, error: buildValidationError(
          'DAG_VALIDATION_RUN_KEY_LINEAGE_MISMATCH',
          'An existing run for this run key has different composite lineage',
          { dagId: definition.dagId, runKey, existingDagRunId: existingRun.dagRunId },
        ) };
      }
      return {
        ok: true,
        value: {
          dagRunId: existingRun.dagRunId,
          dagId: existingRun.dagId,
          version: existingRun.version,
          logicalDate: existingRun.logicalDate,
          status: existingRun.status,
        },
      };
    }

    const dagRunId = this.generateDagRunId(
      definition.dagId,
      resolvedTime.value.logicalDate,
      input.rerunKey,
    );
    try {
      const persist = (definitionSnapshot: string, inputSnapshot: string) => this.storage.createDagRun({
        dagRunId,
        dagId: definition.dagId,
        version: definition.version,
        status: 'created',
        definitionSnapshot,
        inputSnapshot,
        runKey,
        logicalDate: resolvedTime.value.logicalDate,
        trigger: input.trigger,
        ...(lineage === undefined ? {} : { lineage }),
        startedAt: this.clock.nowIso(),
      });
      if (this.snapshotBudget) {
        const admission = await this.snapshotBudget.admitRun(definition, input.input, persist);
        if (!admission.ok) return admission;
      } else {
        await persist(JSON.stringify(definition), JSON.stringify(input.input));
      }
    } catch (error) {
      if (this.snapshotBudget) {
        return { ok: false, error: buildTaskExecutionError(
          'DAG_RUN_SNAPSHOT_PERSISTENCE_UNCERTAIN',
          'Run snapshot persistence outcome is uncertain; root snapshot admission is closed',
          false,
        ) };
      }
      return {
        ok: false,
        error: buildDispatchError('DAG_DISPATCH_DAG_RUN_CREATE_FAILED', 'Failed to create DagRun', {
          dagId: definition.dagId,
          version: definition.version,
          runKey,
          errorMessage: this.resolveErrorMessage(error instanceof Error ? error : undefined),
        }),
      };
    }

    return {
      ok: true,
      value: {
        dagRunId,
        dagId: definition.dagId,
        version: definition.version,
        logicalDate: resolvedTime.value.logicalDate,
        status: 'created',
      },
    };
  }

  /**
   * Transitions a previously created run to running and dispatches entry tasks to the queue.
   */
  public async startCreatedRun(dagRunId: string): Promise<TResult<IStartRunResult, IDagError>> {
    const dagRun = await this.storage.getDagRun(dagRunId);
    if (!dagRun) {
      return {
        ok: false,
        error: buildValidationError('DAG_VALIDATION_DAG_RUN_NOT_FOUND', 'DagRun was not found', {
          dagRunId,
        }),
      };
    }
    if (dagRun.status !== 'created') {
      const existingTaskRuns = await this.storage.listTaskRunsByDagRunId(dagRunId);
      return {
        ok: true,
        value: {
          dagRunId,
          dagId: dagRun.dagId,
          version: dagRun.version,
          logicalDate: dagRun.logicalDate,
          taskRunIds: existingTaskRuns.map((taskRun) => taskRun.taskRunId),
        },
      };
    }
    if (
      typeof dagRun.definitionSnapshot !== 'string' ||
      dagRun.definitionSnapshot.trim().length === 0
    ) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_DEFINITION_SNAPSHOT_MISSING',
          'DagRun definition snapshot is missing',
          { dagRunId },
        ),
      };
    }
    const parsedDefinition = parseDefinitionSnapshot(dagRun.definitionSnapshot);
    if (!parsedDefinition.ok) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_DEFINITION_SNAPSHOT_INVALID',
          'DagRun definition snapshot is invalid',
          { dagRunId },
        ),
      };
    }
    const parsedInput = parsePortPayload(dagRun.inputSnapshot ?? '{}');
    if (!parsedInput.ok) {
      return {
        ok: false,
        error: buildValidationError(
          'DAG_VALIDATION_RUN_INPUT_SNAPSHOT_INVALID',
          'DagRun input snapshot is invalid',
          { dagRunId },
        ),
      };
    }

    const dispatched = await dispatchEntryTasks(
      { dagRunId, definition: parsedDefinition.value, input: parsedInput.value },
      this.storage,
      this.queue,
      this.clock,
      this.runProgressEventReporter,
    );
    if (!dispatched.ok) {
      return dispatched;
    }
    return {
      ok: true,
      value: {
        dagRunId,
        dagId: dagRun.dagId,
        version: dagRun.version,
        logicalDate: dagRun.logicalDate,
        taskRunIds: dispatched.value.taskRunIds,
      },
    };
  }

  /**
   * Creates and starts a DAG run in a single call.
   */
  public async startRun(input: IStartRunInput): Promise<TResult<IStartRunResult, IDagError>> {
    const created = await this.createRun(input);
    if (!created.ok) {
      return created;
    }
    if (created.value.status === 'created') {
      return this.startCreatedRun(created.value.dagRunId);
    }
    const existingTaskRuns = await this.storage.listTaskRunsByDagRunId(created.value.dagRunId);
    return {
      ok: true,
      value: {
        dagRunId: created.value.dagRunId,
        dagId: created.value.dagId,
        version: created.value.version,
        logicalDate: created.value.logicalDate,
        taskRunIds: existingTaskRuns.map((taskRun) => taskRun.taskRunId),
      },
    };
  }

  private generateDagRunId(dagId: string, logicalDate: string, rerunKey?: string): string {
    const logicalEpochMs = Date.parse(logicalDate);
    return rerunKey
      ? `${dagId}:run:${logicalEpochMs}:rerun:${rerunKey}`
      : `${dagId}:run:${logicalEpochMs}`;
  }

  private resolveErrorMessage(error: Error | undefined): string {
    if (error instanceof Error && error.message.trim().length > 0) {
      return error.message;
    }
    return 'Unknown error';
  }
}
