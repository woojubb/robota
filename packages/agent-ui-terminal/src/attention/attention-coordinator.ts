import { IntervalRecap } from './interval-recap.js';

import type { IAttentionSource } from './attention-tracker.js';
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface-execution';

/**
 * SCREEN-1992: joins the attention level to the recap accumulator for one channel.
 *
 * The tracker outlives channels (it is the terminal's), the recap belongs to the session being
 * shown; the coordinator subscribes for the channel's lifetime and pushes each recap line into the
 * channel's notice store. It lives here rather than in `tui-state-manager.ts` (at its line ceiling).
 */
export interface IAttentionCoordinatorOptions {
  readonly source: IAttentionSource;
  readonly onRecap: (line: string) => void;
  readonly now?: () => number;
}

export class AttentionCoordinator {
  private readonly recap = new IntervalRecap();
  private unsubscribe: (() => void) | undefined;
  private readonly now: () => number;

  constructor(private readonly options: IAttentionCoordinatorOptions) {
    this.now = options.now ?? Date.now;
  }

  wire(): void {
    if (this.unsubscribe !== undefined) return;
    // A channel created while the user is already away starts its interval now.
    if (!this.options.source.attended) this.recap.onLost(new Date(this.now()).toISOString());
    this.unsubscribe = this.options.source.subscribe((change) => {
      if (change.kind === 'lost') {
        this.recap.onLost(change.at);
        return;
      }
      const line = this.recap.onReturned(change.at);
      if (line !== undefined) this.options.onRecap(line);
    });
  }

  unwire(): void {
    this.unsubscribe?.();
    this.unsubscribe = undefined;
  }

  onTurnSource = (source: string): void => {
    this.recap.turnSource(source);
  };

  onComplete = (): void => {
    this.recap.turnCompleted();
  };

  onError = (): void => {
    this.recap.error();
  };

  onNeedsInput = (): void => {
    this.recap.needsInput();
  };

  onWorkspaceSnapshot = (snapshot: IExecutionWorkspaceSnapshot): void => {
    for (const entry of snapshot.entries) {
      // The main thread's turns are counted from `complete`; its idle `completed` is not an event.
      if (entry.kind === 'main_thread') continue;
      this.recap.entryState(entry.id, entry.state);
    }
    this.recap.snapshotComplete();
  };
}
