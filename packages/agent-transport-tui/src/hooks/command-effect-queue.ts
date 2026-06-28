import type { TCommandEffect } from '@robota-sdk/agent-interface-transport';

export interface TQueuedCommandState {
  type: 'effects';
  effects: readonly TCommandEffect[];
}

export interface ICommandEffectQueue {
  enqueueEffects(effects: readonly TCommandEffect[]): void;
  drain(): TQueuedCommandState | undefined;
  clear(): void;
}

export class CommandEffectQueue implements ICommandEffectQueue {
  private readonly queue: TQueuedCommandState[] = [];

  enqueueEffects(effects: readonly TCommandEffect[]): void {
    if (effects.length === 0) return;
    this.queue.push({ type: 'effects', effects: [...effects] });
  }

  drain(): TQueuedCommandState | undefined {
    return this.queue.shift();
  }

  clear(): void {
    this.queue.length = 0;
  }
}
