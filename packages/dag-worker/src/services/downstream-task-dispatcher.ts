import {
    buildDispatchError,
    TaskRunStateMachine,
    type IClockPort,
    type IDagDefinition,
    type IDagRun,
    type IDagError,
    type IQueueMessage,
    type IQueuePort,
    type IStoragePort,
    type ITaskRun,
    type TPortPayload,
    type TResult
} from '@robota-sdk/dag-core';
import { buildDownstreamPayload } from './downstream-payload-builder.js';

/** Resolves an error message from an unknown error value. */
function resolveErrorMessage(error: unknown): string {
    if (error instanceof Error && error.message.trim().length > 0) {
        return error.message;
    }
    return 'Unknown error';
}

/**
 * Dispatches all downstream nodes that are ready for execution after a node
 * completes successfully. A node is ready when all of its upstream dependencies
 * have succeeded and it hasn't already been created.
 *
 * @param dagRun - The current DAG run.
 * @param definition - The DAG definition containing node and edge topology.
 * @param completedNodeId - The node that just completed successfully.
 * @param _output - The completed node's output (reserved for future use).
 * @param storage - Storage port for reading/writing task runs.
 * @param queue - Queue port for enqueuing downstream messages.
 * @param clock - Clock port for timestamps.
 * @returns Success or a dispatch error.
 */
export async function dispatchDownstreamReadyTasks(
    dagRun: IDagRun,
    definition: IDagDefinition,
    completedNodeId: string,
    _output: TPortPayload,
    storage: IStoragePort,
    queue: IQueuePort,
    clock: IClockPort
): Promise<TResult<void, IDagError>> {
    const downstreamNodes = definition.nodes.filter((node) => node.dependsOn.includes(completedNodeId));
    if (downstreamNodes.length === 0) {
        return { ok: true, value: undefined };
    }

    const allTaskRuns = await storage.listTaskRunsByDagRunId(dagRun.dagRunId);
    for (const downstreamNode of downstreamNodes) {
        const result = await dispatchSingleDownstreamNode(dagRun, definition, downstreamNode, allTaskRuns, storage, queue, clock);
        if (!result.ok) {
            return result;
        }
    }

    return { ok: true, value: undefined };
}

/** Creates a task run and enqueues a message for a single downstream node if it is ready. */
async function dispatchSingleDownstreamNode(
    dagRun: IDagRun,
    definition: IDagDefinition,
    downstreamNode: IDagDefinition['nodes'][number],
    allTaskRuns: ITaskRun[],
    storage: IStoragePort,
    queue: IQueuePort,
    clock: IClockPort
): Promise<TResult<void, IDagError>> {
    const alreadyCreated = allTaskRuns.some((taskRun) => taskRun.nodeId === downstreamNode.nodeId);
    if (alreadyCreated) {
        return { ok: true, value: undefined };
    }

    const ready = downstreamNode.dependsOn.every((upstreamNodeId) =>
        allTaskRuns.some((taskRun) => taskRun.nodeId === upstreamNodeId && taskRun.status === 'success')
    );
    if (!ready) {
        return { ok: true, value: undefined };
    }

    const nextTaskRunId = `${dagRun.dagRunId}:${downstreamNode.nodeId}:attempt:1`;
    await storage.createTaskRun({
        taskRunId: nextTaskRunId,
        dagRunId: dagRun.dagRunId,
        nodeId: downstreamNode.nodeId,
        status: 'queued',
        attempt: 1
    });

    const nextPayloadResult = buildDownstreamPayload(definition, allTaskRuns, downstreamNode.nodeId);
    if (!nextPayloadResult.ok) {
        return nextPayloadResult;
    }
    const nextPayload: TPortPayload = downstreamNode.timeoutMs
        ? { ...nextPayloadResult.value, timeoutMs: downstreamNode.timeoutMs }
        : nextPayloadResult.value;

    const nextMessage: IQueueMessage = {
        messageId: `${nextTaskRunId}:message:1`,
        dagRunId: dagRun.dagRunId,
        taskRunId: nextTaskRunId,
        nodeId: downstreamNode.nodeId,
        attempt: 1,
        executionPath: [
            `dagId:${dagRun.dagId}`,
            `dagRunId:${dagRun.dagRunId}`,
            `nodeId:${downstreamNode.nodeId}`,
            `taskRunId:${nextTaskRunId}`,
            'attempt:1'
        ],
        payload: nextPayload,
        createdAt: clock.nowIso()
    };

    try {
        await queue.enqueue(nextMessage);
    } catch (error) {
        const cancelTransition = TaskRunStateMachine.transition('queued', 'CANCEL');
        if (cancelTransition.ok) {
            await storage.updateTaskRunStatus(nextTaskRunId, cancelTransition.value.nextStatus);
        }
        return {
            ok: false,
            error: buildDispatchError(
                'DAG_DISPATCH_ENQUEUE_DOWNSTREAM_FAILED',
                'Failed to enqueue downstream task',
                {
                    dagRunId: dagRun.dagRunId,
                    nodeId: downstreamNode.nodeId,
                    errorMessage: resolveErrorMessage(error)
                }
            )
        };
    }

    allTaskRuns.push({
        taskRunId: nextTaskRunId,
        dagRunId: dagRun.dagRunId,
        nodeId: downstreamNode.nodeId,
        status: 'queued',
        attempt: 1
    });

    return { ok: true, value: undefined };
}
