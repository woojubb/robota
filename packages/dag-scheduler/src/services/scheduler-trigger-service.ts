import {
    buildValidationError,
    type IDagError,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
// dag-scheduler depends on dag-runtime for RunOrchestratorService.
// This is a known exception to the dag-core-only dependency rule:
// the scheduler delegates run creation to the runtime orchestrator rather than
// reimplementing that logic, keeping the single-responsibility boundary intact.
import { type RunOrchestratorService, type IStartRunResult } from '@robota-sdk/dag-runtime';

/** Request parameters for triggering a single scheduled DAG run. */
export interface IScheduledTriggerRequest {
    dagId: string;
    version?: number;
    logicalDate: string;
    input: TPortPayload;
}

/** Request containing multiple scheduled trigger items to execute sequentially. */
export interface IScheduledBatchTriggerRequest {
    items: IScheduledTriggerRequest[];
}

/** Result of a batch trigger operation, including any partial failure. */
export interface IScheduledBatchTriggerResult {
    startedRuns: IStartRunResult[];
    /** Present when the batch was interrupted by a failure mid-iteration. */
    partialError?: IDagError;
}

/** Request parameters for a catchup trigger across a date range with fixed-interval slots. */
export interface ICatchupTriggerRequest {
    dagId: string;
    version?: number;
    rangeStartLogicalDate: string;
    rangeEndLogicalDate: string;
    slotIntervalMs: number;
    maxSlots: number;
    input: TPortPayload;
}

/** Result of a catchup trigger, including the number of computed slots and started runs. */
export interface ICatchupTriggerResult {
    requestedSlotCount: number;
    startedRuns: IStartRunResult[];
}

/**
 * Scheduler service that delegates scheduled, batch, and catchup triggers
 * to the runtime RunOrchestratorService. Validates catchup parameters
 * (date ranges, slot intervals, max slots) before dispatching.
 *
 * @see RunOrchestratorService for the underlying run creation and dispatch
 */
export class SchedulerTriggerService {
    private readonly runOrchestrator: RunOrchestratorService;

    public constructor(runOrchestrator: RunOrchestratorService) {
        this.runOrchestrator = runOrchestrator;
    }

    /**
     * Triggers a single scheduled DAG run.
     * @param request - The trigger request with DAG ID, logical date, and input.
     * @returns The started run result or an error.
     */
    public async triggerScheduledRun(
        request: IScheduledTriggerRequest
    ): Promise<TResult<IStartRunResult, IDagError>> {
        return this.runOrchestrator.startRun({
            dagId: request.dagId,
            version: request.version,
            trigger: 'scheduled',
            logicalDate: request.logicalDate,
            input: request.input
        });
    }

    /**
     * Triggers a batch of scheduled runs sequentially. If a failure occurs
     * mid-batch, returns successfully started runs with a partial error.
     * @param request - The batch request containing multiple trigger items.
     * @returns The batch result with started runs and optional partial error.
     */
    public async triggerScheduledBatch(
        request: IScheduledBatchTriggerRequest
    ): Promise<TResult<IScheduledBatchTriggerResult, IDagError>> {
        const startedRuns: IStartRunResult[] = [];

        for (const item of request.items) {
            const started = await this.triggerScheduledRun(item);
            if (!started.ok) {
                if (startedRuns.length > 0) {
                    return {
                        ok: true,
                        value: {
                            startedRuns,
                            partialError: started.error
                        }
                    };
                }
                return started;
            }
            startedRuns.push(started.value);
        }

        return {
            ok: true,
            value: {
                startedRuns
            }
        };
    }

    /**
     * Triggers runs for each time slot in a catchup date range. Validates date
     * range, slot interval, and max-slot constraints before dispatching.
     * @param request - The catchup request with date range, interval, and slot limit.
     * @returns The catchup result with slot count and started runs, or a validation error.
     */
    public async triggerCatchup(
        request: ICatchupTriggerRequest
    ): Promise<TResult<ICatchupTriggerResult, IDagError>> {
        const rangeStartEpochMs = Date.parse(request.rangeStartLogicalDate);
        const rangeEndEpochMs = Date.parse(request.rangeEndLogicalDate);

        if (!Number.isFinite(rangeStartEpochMs) || !Number.isFinite(rangeEndEpochMs)) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_INVALID_LOGICAL_DATE',
                    'Catchup range dates must be valid ISO-8601 timestamps',
                    {
                        rangeStartLogicalDate: request.rangeStartLogicalDate,
                        rangeEndLogicalDate: request.rangeEndLogicalDate
                    }
                )
            };
        }

        if (request.slotIntervalMs <= 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_INVALID_SLOT_INTERVAL',
                    'slotIntervalMs must be greater than zero',
                    { slotIntervalMs: request.slotIntervalMs }
                )
            };
        }

        if (request.maxSlots <= 0) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_INVALID_MAX_SLOTS',
                    'maxSlots must be greater than zero',
                    { maxSlots: request.maxSlots }
                )
            };
        }

        if (rangeEndEpochMs < rangeStartEpochMs) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_INVALID_CATCHUP_RANGE',
                    'rangeEndLogicalDate must be later than or equal to rangeStartLogicalDate',
                    {
                        rangeStartLogicalDate: request.rangeStartLogicalDate,
                        rangeEndLogicalDate: request.rangeEndLogicalDate
                    }
                )
            };
        }

        const spanMs = rangeEndEpochMs - rangeStartEpochMs;
        const requestedSlotCount = Math.floor(spanMs / request.slotIntervalMs) + 1;
        if (requestedSlotCount > request.maxSlots) {
            return {
                ok: false,
                error: buildValidationError(
                    'DAG_VALIDATION_CATCHUP_RANGE_EXCEEDS_LIMIT',
                    'Catchup range exceeds maxSlots limit',
                    {
                        requestedSlotCount,
                        maxSlots: request.maxSlots
                    }
                )
            };
        }

        const startedRuns: IStartRunResult[] = [];
        for (let cursorEpochMs = rangeStartEpochMs; cursorEpochMs <= rangeEndEpochMs; cursorEpochMs += request.slotIntervalMs) {
            const logicalDate = new Date(cursorEpochMs).toISOString();
            const started = await this.triggerScheduledRun({
                dagId: request.dagId,
                version: request.version,
                logicalDate,
                input: request.input
            });
            if (!started.ok) {
                return started;
            }
            startedRuns.push(started.value);
        }

        return {
            ok: true,
            value: {
                requestedSlotCount,
                startedRuns
            }
        };
    }
}
