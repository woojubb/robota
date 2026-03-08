import type { Router, Request, Response } from 'express';
import {
    EXECUTION_PROGRESS_EVENTS,
    TASK_EVENTS,
    TASK_PROGRESS_EVENTS,
    type IClockPort,
    type TRunProgressEvent
} from '@robota-sdk/dag-core';
import type { IDagExecutionComposition } from '@robota-sdk/dag-api';
import { parseTaskRunPayloadSnapshot } from './route-utils.js';

/**
 * Registers SSE event streaming routes on the provided router.
 */
export function registerSseRoutes(
    router: Router,
    sseClientsByDagRunId: Map<string, Set<Response>>,
    runQuery: IDagExecutionComposition['runQuery'],
    clock: IClockPort,
    sseKeepAliveMs: number
): void {
    router.get('/v1/dag/runs/:dagRunId/events', async (req: Request<{ dagRunId: string }>, res: Response) => {
        const dagRunId = req.params.dagRunId;
        const emitSseEvent = (event: TRunProgressEvent): void => {
            const payload = JSON.stringify({ event });
            res.write(`data: ${payload}\n\n`);
        };
        res.setHeader('Content-Type', 'text/event-stream');
        res.setHeader('Cache-Control', 'no-cache, no-transform');
        res.setHeader('Connection', 'keep-alive');
        res.flushHeaders();
        res.write(':\n\n');

        const keepAliveTimer = setInterval(() => {
            res.write(':\n\n');
        }, sseKeepAliveMs);
        const clients = sseClientsByDagRunId.get(dagRunId) ?? new Set<Response>();
        clients.add(res);
        sseClientsByDagRunId.set(dagRunId, clients);

        const releaseClient = (): void => {
            const subscribedClients = sseClientsByDagRunId.get(dagRunId);
            if (!subscribedClients) {
                return;
            }
            subscribedClients.delete(res);
            if (subscribedClients.size === 0) {
                sseClientsByDagRunId.delete(dagRunId);
            }
        };

        const queried = await runQuery.getRun(dagRunId);
        if (queried.ok) {
            const snapshotDagRun = queried.value.dagRun;
            for (const taskRun of queried.value.taskRuns) {
                const input = parseTaskRunPayloadSnapshot(taskRun.inputSnapshot);
                const output = parseTaskRunPayloadSnapshot(taskRun.outputSnapshot);
                if (
                    taskRun.status === TASK_EVENTS.RUNNING
                    || taskRun.status === TASK_EVENTS.SUCCESS
                    || taskRun.status === TASK_EVENTS.FAILED
                    || taskRun.status === TASK_EVENTS.UPSTREAM_FAILED
                    || taskRun.status === TASK_EVENTS.CANCELLED
                ) {
                    emitSseEvent({
                        dagRunId,
                        eventType: TASK_PROGRESS_EVENTS.STARTED,
                        occurredAt: clock.nowIso(),
                        taskRunId: taskRun.taskRunId,
                        nodeId: taskRun.nodeId,
                        input
                    });
                }
                if (taskRun.status === TASK_EVENTS.SUCCESS) {
                    emitSseEvent({
                        dagRunId,
                        eventType: TASK_PROGRESS_EVENTS.COMPLETED,
                        occurredAt: clock.nowIso(),
                        taskRunId: taskRun.taskRunId,
                        nodeId: taskRun.nodeId,
                        input,
                        output
                    });
                }
                if (
                    taskRun.status === TASK_EVENTS.FAILED
                    || taskRun.status === TASK_EVENTS.UPSTREAM_FAILED
                    || taskRun.status === TASK_EVENTS.CANCELLED
                ) {
                    emitSseEvent({
                        dagRunId,
                        eventType: TASK_PROGRESS_EVENTS.FAILED,
                        occurredAt: clock.nowIso(),
                        taskRunId: taskRun.taskRunId,
                        nodeId: taskRun.nodeId,
                        input,
                        output,
                        error: {
                            code: taskRun.errorCode ?? 'DAG_TASK_EXECUTION_FAILED',
                            category: 'task_execution',
                            message: taskRun.errorMessage ?? `Task finished with status ${taskRun.status}.`,
                            retryable: false
                        }
                    });
                }
            }
            if (snapshotDagRun.status === 'success') {
                emitSseEvent({
                    dagRunId,
                    eventType: EXECUTION_PROGRESS_EVENTS.COMPLETED,
                    occurredAt: clock.nowIso()
                });
            } else if (snapshotDagRun.status === 'failed' || snapshotDagRun.status === 'cancelled') {
                emitSseEvent({
                    dagRunId,
                    eventType: EXECUTION_PROGRESS_EVENTS.FAILED,
                    occurredAt: clock.nowIso(),
                    error: {
                        code: 'DAG_RUN_FAILED',
                        category: 'task_execution',
                        message: `Run is already in terminal status: ${snapshotDagRun.status}`,
                        retryable: false,
                        context: { dagRunId, status: snapshotDagRun.status }
                    }
                });
            } else if (snapshotDagRun.status === 'queued' || snapshotDagRun.status === 'running') {
                emitSseEvent({
                    dagRunId,
                    eventType: EXECUTION_PROGRESS_EVENTS.STARTED,
                    occurredAt: clock.nowIso(),
                    dagId: snapshotDagRun.dagId,
                    version: snapshotDagRun.version
                });
            }
        } else {
            emitSseEvent({
                dagRunId,
                eventType: EXECUTION_PROGRESS_EVENTS.FAILED,
                occurredAt: clock.nowIso(),
                error: {
                    code: queried.error.code,
                    category: queried.error.category,
                    message: queried.error.message,
                    retryable: queried.error.retryable,
                    context: queried.error.context
                }
            });
            clearInterval(keepAliveTimer);
            releaseClient();
            res.end();
            return;
        }

        req.on('close', () => {
            clearInterval(keepAliveTimer);
            releaseClient();
        });
    });
}
