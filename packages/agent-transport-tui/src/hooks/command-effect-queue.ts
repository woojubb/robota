import type { ICommandInteraction, TCommandEffect } from '@robota-sdk/agent-sdk';

export type TQueuedCommandState =
  | {
      type: 'interaction';
      interaction: ICommandInteraction;
    }
  | {
      type: 'effects';
      effects: readonly TCommandEffect[];
    };

export interface ICommandEffectQueue {
  enqueueInteraction(interaction: ICommandInteraction): void;
  enqueueEffects(effects: readonly TCommandEffect[]): void;
  drain(): TQueuedCommandState | undefined;
  clear(): void;
}

export class CommandEffectQueue implements ICommandEffectQueue {
  private readonly queue: TQueuedCommandState[] = [];

  enqueueInteraction(interaction: ICommandInteraction): void {
    this.queue.push({ type: 'interaction', interaction });
  }

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
