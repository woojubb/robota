/** The strict write is the publication point for a self-paced loop transition. */

import { isDeepStrictEqual } from 'node:util';

import type { ISessionLoopState } from '@robota-sdk/agent-interface-session';

export interface IDurableSessionLoopStoreDeps {
  /** Save the whole candidate collection; must report a definite failure or permit read-back. */
  persist(candidate: readonly ISessionLoopState[]): void;
  /** Undefined means the committed record could not be inspected. */
  readCommitted(): readonly ISessionLoopState[] | undefined;
}

export class DurableSessionLoopStore {
  private states: ISessionLoopState[];
  private suspended = false;

  constructor(initial: readonly ISessionLoopState[], private readonly deps: IDurableSessionLoopStoreDeps) {
    this.states = [...initial];
  }

  /** Used only during construction, before any loop transition can be admitted. */
  restore(initial: readonly ISessionLoopState[]): void {
    if (this.states.length > 0 || this.suspended) {
      throw new Error('Self-paced loops can only be restored before new transitions.');
    }
    this.states = [...initial];
  }

  list(): readonly ISessionLoopState[] {
    return [...this.states];
  }

  get(loopId: string): ISessionLoopState | undefined {
    return this.states.find((state) => state.loopId === loopId);
  }

  isSuspended(): boolean {
    return this.suspended;
  }

  /** An uncertain write must not be replaced by a best-effort snapshot of older memory. */
  snapshotForOrdinarySave(): readonly ISessionLoopState[] | undefined {
    return this.suspended ? undefined : this.states;
  }

  commit(next: ISessionLoopState): void {
    if (this.suspended) throw new Error('Self-paced loop admission is suspended until recovery.');
    const previous = this.get(next.loopId);
    if (previous ? next.revision !== previous.revision + 1 : next.revision !== 0) {
      throw new Error(`Invalid self-paced loop revision for ${next.loopId}.`);
    }
    const candidate = previous
      ? this.states.map((state) => (state.loopId === next.loopId ? next : state))
      : [...this.states, next];
    try {
      this.deps.persist(candidate);
    } catch (error) {
      let committed: readonly ISessionLoopState[] | undefined;
      try {
        committed = this.deps.readCommitted();
      } catch {
        committed = undefined;
      }
      if (!isDeepStrictEqual(committed, candidate)) {
        if (committed === undefined) {
          this.suspended = true;
          throw new Error('Self-paced loop write outcome is uncertain; admission is suspended.', {
            cause: error,
          });
        }
        throw error;
      }
    }
    this.states = candidate;
  }
}
