import {
  buildValidationError,
  type IDagDefinition,
  type IDagError,
  type IDagRun,
  type IQueueMessage,
  type IStoragePort,
  type TResult,
} from '@robota-sdk/dag-core';
import { parseDefinitionSnapshot } from './definition-snapshot-parser.js';

export interface IWorkerExecutionContext {
  dagRun: IDagRun;
  definition: IDagDefinition;
  nodeDefinition: IDagDefinition['nodes'][number];
}

export async function loadWorkerExecutionContext(
  storage: IStoragePort,
  message: IQueueMessage,
): Promise<TResult<IWorkerExecutionContext, IDagError>> {
  const dagRun = await storage.getDagRun(message.dagRunId);
  if (!dagRun) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_DAG_RUN_NOT_FOUND',
        'DagRun not found for dequeued message',
        { dagRunId: message.dagRunId },
      ),
    };
  }

  const definitionResult = parseDefinitionSnapshot(dagRun, message.dagRunId);
  if (!definitionResult.ok) {
    return definitionResult;
  }

  const definition = definitionResult.value;
  const nodeDefinition = definition.nodes.find((node) => node.nodeId === message.nodeId);
  if (!nodeDefinition) {
    return {
      ok: false,
      error: buildValidationError(
        'DAG_VALIDATION_NODE_NOT_FOUND',
        'Node definition not found for task execution',
        { nodeId: message.nodeId, dagId: dagRun.dagId, version: dagRun.version },
      ),
    };
  }

  return { ok: true, value: { dagRun, definition, nodeDefinition } };
}
