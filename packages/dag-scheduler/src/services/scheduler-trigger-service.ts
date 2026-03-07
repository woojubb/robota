import {
    buildValidationError,
    type IDagError,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { type RunOrchestratorService, type IStartRunResult } from '@robota-sdk/dag-runtime';

export interface IScheduledTriggerRequest {
    dagId: string;
    version?: number;
    logicalDate: string;
    input: TPortPayload;
}

export interface IScheduledBatchTriggerRequest {
    items: IScheduledTriggerRequest[];
}

export interface IScheduledBatchTriggerResult {
    startedRuns: IStartRunResult[];
}

export interface ICatchupTriggerRequest {
    dagId: string;
    version?: number;
    rangeStartLogicalDate: string;
    rangeEndLogicalDate: string;
    slotIntervalMs: number;
    maxSlots: number;
    input: TPortPayload;
}

export interface ICatchupTriggerResult {
    requestedSlotCount: number;
    startedRuns: IStartRunResult[];
}

export class SchedulerTriggerService {
    private readonly runOrchestrator: RunOrchestratorService;

    public constructor(runOrchestrator: RunOrchestratorService) {
        this.runOrchestrator = runOrchestrator;
    }

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

    public async triggerScheduledBatch(
        request: IScheduledBatchTriggerRequest
    ): Promise<TResult<IScheduledBatchTriggerResult, IDagError>> {
        const startedRuns: IStartRunResult[] = [];

        for (const item of request.items) {
            const started = await this.triggerScheduledRun(item);
            if (!started.ok) {
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
