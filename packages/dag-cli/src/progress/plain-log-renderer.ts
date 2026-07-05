import type { TRunProgressEvent } from '@robota-sdk/dag-core';
import type { IRuntimeRunProgressEventBusPort } from '@robota-sdk/dag-api';
import type { IDagCliIo } from '../types.js';

/** Emits timestamped plain-text log lines. Used in non-TTY / CI environments. */
export class PlainLogRenderer {
  private readonly io: IDagCliIo;
  private readonly nodeStartedAt = new Map<string, number>();
  private startMs: number | null = null;
  private unsubscribe: (() => void) | null = null;

  public constructor(io: IDagCliIo) {
    this.io = io;
  }

  public attach(eventBus: IRuntimeRunProgressEventBusPort, fileName: string): void {
    this.startMs = Date.now();
    this.log(`dag-run started: ${fileName}`);
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

  private log(msg: string): void {
    this.io.write(`[${new Date().toISOString()}] ${msg}\n`);
  }

  private handleEvent(event: TRunProgressEvent): void {
    if (event.eventType === 'task.started') {
      this.nodeStartedAt.set(event.nodeId, Date.now());
      this.log(`node:${event.nodeId} status=running`);
    } else if (event.eventType === 'task.completed') {
      const startMs = this.nodeStartedAt.get(event.nodeId) ?? Date.now();
      const durationMs = Date.now() - startMs;
      this.log(`node:${event.nodeId} status=success duration_ms=${durationMs}`);
    } else if (event.eventType === 'task.failed') {
      const startMs = this.nodeStartedAt.get(event.nodeId) ?? Date.now();
      const durationMs = Date.now() - startMs;
      const errorMsg = event.error.message ?? event.error.code;
      this.log(`node:${event.nodeId} status=failed duration_ms=${durationMs} error=${errorMsg}`);
    } else if (event.eventType === 'execution.completed') {
      const durationMs = this.startMs !== null ? Date.now() - this.startMs : 0;
      this.log(`dag-run completed status=success duration_ms=${durationMs}`);
    } else if (event.eventType === 'execution.failed') {
      const durationMs = this.startMs !== null ? Date.now() - this.startMs : 0;
      const errorMsg = event.error.message ?? event.error.code;
      this.log(`dag-run completed status=failed duration_ms=${durationMs} error=${errorMsg}`);
    }
  }
}
