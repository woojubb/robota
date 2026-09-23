import { randomUUID } from 'node:crypto';
import {
  buildDagError,
  buildValidationError,
  type IClockPort,
  type IDagError,
  type IOverwriteRunDraftNodeResultInput,
  type IRunDraft,
  type IRunDraftOperationsPort,
  type IRunDraftStore,
  type ISaveRunDraftInput,
  type TResult,
} from '@robota-sdk/dag-core';

/** In-process run-draft capability backed by an injected store and clock. */
export class DagFrameworkRunDraftOperations implements IRunDraftOperationsPort {
  public constructor(
    private readonly store: IRunDraftStore,
    private readonly clock: IClockPort,
  ) {}

  public async createRunDraft(input: ISaveRunDraftInput): Promise<TResult<IRunDraft, IDagError>> {
    return this.perform(async () => {
      const now = this.clock.nowIso();
      const draft: IRunDraft = {
        draftId: input.draftId ?? randomUUID(),
        definition: input.definition,
        input: input.input ?? {},
        nodeStateMap: input.nodeStateMap ?? {},
        ...(input.runResult ? { runResult: input.runResult } : {}),
        createdAt: now,
        updatedAt: now,
      };
      await this.store.saveRunDraft(draft);
      return { ok: true, value: draft };
    });
  }

  public async getRunDraft(draftId: string): Promise<TResult<IRunDraft, IDagError>> {
    return this.perform(async () => {
      const draft = await this.store.getRunDraft(draftId);
      return draft ? { ok: true, value: draft } : this.notFound(draftId);
    });
  }

  public async replaceRunDraft(
    draftId: string,
    input: Omit<ISaveRunDraftInput, 'draftId'>,
  ): Promise<TResult<IRunDraft, IDagError>> {
    return this.perform(async () => {
      const existing = await this.store.getRunDraft(draftId);
      const now = this.clock.nowIso();
      const draft: IRunDraft = {
        draftId,
        definition: input.definition,
        input: input.input ?? {},
        nodeStateMap: input.nodeStateMap ?? {},
        ...(input.runResult ? { runResult: input.runResult } : {}),
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };
      await this.store.saveRunDraft(draft);
      return { ok: true, value: draft };
    });
  }

  public async resetRunDraftNodeResult(
    draftId: string,
    nodeId: string,
  ): Promise<TResult<IRunDraft, IDagError>> {
    return this.perform(async () => {
      const existing = await this.store.getRunDraft(draftId);
      if (!existing) return this.notFound(draftId);
      const nodeStateMap = { ...existing.nodeStateMap };
      delete nodeStateMap[nodeId];
      const draft: IRunDraft = {
        ...existing,
        nodeStateMap,
        updatedAt: this.clock.nowIso(),
      };
      await this.store.saveRunDraft(draft);
      return { ok: true, value: draft };
    });
  }

  public async overwriteRunDraftNodeResult(
    draftId: string,
    nodeId: string,
    input: IOverwriteRunDraftNodeResultInput,
  ): Promise<TResult<IRunDraft, IDagError>> {
    return this.perform(async () => {
      const existing = await this.store.getRunDraft(draftId);
      if (!existing) return this.notFound(draftId);
      const previous = existing.nodeStateMap[nodeId];
      const draft: IRunDraft = {
        ...existing,
        nodeStateMap: {
          ...existing.nodeStateMap,
          [nodeId]: {
            operationStatus: previous?.operationStatus ?? 'idle',
            executionStatus: 'success',
            ...(previous?.pendingDescription !== undefined
              ? { pendingDescription: previous.pendingDescription }
              : {}),
            trace: {
              nodeId,
              ...(input.input ? { input: input.input } : {}),
              output: input.output,
            },
          },
        },
        updatedAt: this.clock.nowIso(),
      };
      await this.store.saveRunDraft(draft);
      return { ok: true, value: draft };
    });
  }

  private async perform(
    operation: () => Promise<TResult<IRunDraft, IDagError>>,
  ): Promise<TResult<IRunDraft, IDagError>> {
    try {
      return await operation();
    } catch {
      return {
        ok: false,
        error: buildDagError(
          'dispatch',
          'DAG_RUN_DRAFT_STORAGE_ERROR',
          'Run draft storage operation failed.',
          true,
        ),
      };
    }
  }

  private notFound(draftId: string): TResult<never, IDagError> {
    return {
      ok: false,
      error: buildValidationError('DAG_RUN_DRAFT_NOT_FOUND', 'Run draft not found', { draftId }),
    };
  }
}
