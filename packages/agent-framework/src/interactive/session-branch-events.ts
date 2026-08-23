import { DEFAULT_BRANCH_ID } from '../checkpoints/edit-checkpoint-store-helpers.js';

import type { EditCheckpointStore } from '../checkpoints/edit-checkpoint-store.js';
import type { IBranchEvent } from '@robota-sdk/agent-interface-session';

/** Exhaustive owner policy for checkpoint operations; resume hydration intentionally has no event. */
export const BRANCH_OPERATION_EVENT_MATRIX = {
  create: 'checkpoint_created',
  fork: 'branch_forked',
  switch: 'branch_switched',
  restore: 'checkpoint_restored',
  rollback: 'checkpoint_rolled_back',
  resume_pointer: 'non_event',
} as const satisfies Record<
  'create' | 'fork' | 'switch' | 'restore' | 'rollback' | 'resume_pointer',
  IBranchEvent['kind'] | 'non_event'
>;

export class SessionBranchEvents {
  constructor(
    private readonly getStore: () => EditCheckpointStore,
    private readonly getSessionId: () => string,
    private readonly persistSession: () => void,
    private readonly emitEvent: (event: IBranchEvent) => void,
    private readonly onError: (error: Error) => void,
  ) {}

  emit(
    operation: Exclude<keyof typeof BRANCH_OPERATION_EVENT_MATRIX, 'resume_pointer'>,
    checkpointId: string,
  ): void {
    const kind = BRANCH_OPERATION_EVENT_MATRIX[operation];
    const branchId =
      this.getStore().getActiveBranchPointer(this.getSessionId())?.branchId ?? DEFAULT_BRANCH_ID;
    this.emitEvent({ kind, checkpointId, branchId });
  }

  async finalize(): Promise<void> {
    try {
      const checkpoint = await this.getStore().finalizeTurn();
      if (!checkpoint) return;
      this.persistSession();
      this.emit('create', checkpoint.id);
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.onError(normalized);
      throw normalized;
    }
  }
}
