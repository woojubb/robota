import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import type { IRuntimeRunProgressEventBusPort } from '@robota-sdk/dag-api';
import type { IDagCliIo } from '../types.js';

const CHECK = '✓';
const CROSS = '✗';
const SPIN = '⠸';

/** Subscribes to run progress events and writes human-readable lines to io. */
export class RunProgressRenderer {
  private readonly io: IDagCliIo;
  private readonly nodeStartedAt = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;

  public constructor(io: IDagCliIo) {
    this.io = io;
  }

  public attach(eventBus: IRuntimeRunProgressEventBusPort, fileName: string): void {
    this.io.write(`Running: ${fileName}\n${'─'.repeat(42)}\n`);
    this.unsubscribe = eventBus.subscribe((event: TRunProgressEvent) => {
      this.handleEvent(event);
    });
  }

  public detach(): void {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  private handleEvent(event: TRunProgressEvent): void {
    if (event.eventType === 'task.started') {
      this.nodeStartedAt.set(event.nodeId, Date.now());
      this.io.write(`  ${SPIN} ${event.nodeId}\n`);
    } else if (event.eventType === 'task.completed') {
      const startMs = this.nodeStartedAt.get(event.nodeId) ?? Date.now();
      const durationMs = Date.now() - startMs;
      this.io.write(`  ${CHECK} ${event.nodeId.padEnd(16)} [${durationMs}ms]\n`);
    } else if (event.eventType === 'task.failed') {
      const startMs = this.nodeStartedAt.get(event.nodeId) ?? Date.now();
      const durationMs = Date.now() - startMs;
      const errorMsg = event.error.message ?? event.error.code;
      this.io.write(`  ${CROSS} ${event.nodeId.padEnd(16)} [${durationMs}ms]  — ${errorMsg}\n`);
    } else if (event.eventType === 'execution.completed') {
      this.io.write(`${'─'.repeat(42)}\n`);
    } else if (event.eventType === 'execution.failed') {
      this.io.write(`${'─'.repeat(42)}\n`);
      this.io.write(`Run failed: ${event.error.message ?? event.error.code}\n`);
    }
  }
}
