import {
  DagDefinitionService,
  type IDagError,
  type IStoragePort,
  type TResult,
} from '@robota-sdk/dag-core';
import type {
  IDagRunLifecyclePort,
  IPrepareRunInput,
  IRuntimeCreateRunResult,
  IRuntimeRunCancelResult,
  IRuntimeRunReadResult,
  IRuntimeStartRunResult,
  TPrepareRunError,
} from '@robota-sdk/dag-api';
import type { TPortPayload } from '@robota-sdk/dag-core';
import type { IDagExecutionComposition } from '../types.js';

/** In-process execution lifecycle, including implicit definition preparation. */
export class DagFrameworkRunLifecycle implements IDagRunLifecyclePort {
  private readonly definitions: DagDefinitionService;

  constructor(
    private readonly storage: IStoragePort,
    private readonly execution: IDagExecutionComposition,
  ) {
    this.definitions = new DagDefinitionService(storage);
  }

  async createRun(
    input: IPrepareRunInput,
  ): Promise<TResult<IRuntimeCreateRunResult, TPrepareRunError>> {
    const definition = structuredClone(input.definition);
    const existing = await this.storage.getDefinition(definition.dagId, definition.version);
    if (!existing) {
      const created = await this.definitions.createDraft(definition);
      if (!created.ok) {
        return { ok: false, error: { phase: 'definition_create', errors: created.error } };
      }
    }

    const latest = await this.storage.getDefinition(definition.dagId, definition.version);
    let version = definition.version;
    if (latest?.status !== 'published') {
      const published = await this.definitions.publish(definition.dagId, definition.version);
      if (!published.ok) {
        return { ok: false, error: { phase: 'definition_publish', errors: published.error } };
      }
      version = published.value.version;
    }

    const createdRun = await this.execution.runOrchestrator.createRun({
      dagId: definition.dagId,
      version,
      trigger: 'manual',
      input: structuredClone(input.input ?? {}),
    });
    return createdRun.ok
      ? { ok: true, value: createdRun.value }
      : { ok: false, error: { phase: 'run_create', error: createdRun.error } };
  }

  startRun(preparationId: string): Promise<TResult<IRuntimeStartRunResult, IDagError>> {
    return this.execution.runOrchestrator.startCreatedRun(preparationId);
  }

  getRun(dagRunId: string): Promise<TResult<IRuntimeRunReadResult, IDagError>> {
    return this.execution.runQuery.getRun(dagRunId);
  }

  cancelRun(dagRunId: string): Promise<TResult<IRuntimeRunCancelResult, IDagError>> {
    return this.execution.runCancel.cancelRun(dagRunId);
  }

  startPublishedWorkflowRun(
    dagId: string,
    input?: TPortPayload,
    version?: number,
  ): Promise<TResult<IRuntimeStartRunResult, IDagError>> {
    return this.execution.runOrchestrator.startRun({
      dagId,
      version,
      trigger: 'manual',
      input: structuredClone(input ?? {}),
    });
  }
}
