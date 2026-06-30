import type { TRunProgressEvent, TPortPayload } from '@robota-sdk/dag-core';
import type { IRuntimeRunProgressEventBusPort } from '@robota-sdk/dag-api';
import type { IDagCliIo } from '../types.js';

const CHECK = '✓';
const CROSS = '✗';
const SPIN = '⠸';
const PREVIEW_MAX_LENGTH = 50;

/** Format a port payload value into a concise human-readable string (≤50 chars). */
function formatPreview(output: TPortPayload | undefined): string {
  if (output === undefined) return '';

  const keys = Object.keys(output);
  if (keys.length === 0) return '';

  // Build a preview from the first value.
  const firstKey = keys[0] as string;
  const firstValue = output[firstKey];
  let raw: string;
  if (typeof firstValue === 'string') {
    raw = firstValue;
  } else {
    raw = JSON.stringify(firstValue);
  }

  // Truncate to PREVIEW_MAX_LENGTH characters.
  if (raw.length > PREVIEW_MAX_LENGTH) {
    return `"${raw.slice(0, PREVIEW_MAX_LENGTH - 3)}..."`;
  }
  return `"${raw}"`;
}

/**
 * Streams node-by-node progress to io with elapsed timestamps.
 * Outputs a line for each task start and completion in the format:
 *   [MM:SS.mmm] ✓ nodeId → "preview"
 */
export class StreamLogRenderer {
  private readonly io: IDagCliIo;
  private readonly startTime: number;
  private readonly nodeStartedAt = new Map<string, number>();
  private unsubscribe: (() => void) | null = null;

  public constructor(io: IDagCliIo) {
    this.io = io;
    this.startTime = Date.now();
  }

  private elapsed(): string {
    const ms = Date.now() - this.startTime;
    const totalSec = Math.floor(ms / 1000);
    const min = Math.floor(totalSec / 60);
    const sec = totalSec % 60;
    const msPart = ms % 1000;
    return `[${String(min).padStart(2, '0')}:${String(sec).padStart(2, '0')}.${String(msPart).padStart(3, '0')}]`;
  }

  public attach(eventBus: IRuntimeRunProgressEventBusPort, _fileName: string): void {
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

  public onComplete(totalMs: number): void {
    const sec = (totalMs / 1000).toFixed(1);
    this.io.write(`\nCompleted in ${sec}s\n`);
  }

  private handleEvent(event: TRunProgressEvent): void {
    if (event.eventType === 'task.started') {
      this.nodeStartedAt.set(event.nodeId, Date.now());
      this.io.write(`${this.elapsed()} ${SPIN} ${event.nodeId}  (running...)\n`);
    } else if (event.eventType === 'task.completed') {
      const preview = formatPreview(event.output);
      const arrow = preview.length > 0 ? ` → ${preview}` : '';
      this.io.write(`${this.elapsed()} ${CHECK} ${event.nodeId}${arrow}\n`);
    } else if (event.eventType === 'task.failed') {
      const errorMsg = event.error.message ?? event.error.code;
      this.io.write(`${this.elapsed()} ${CROSS} ${event.nodeId}: ${errorMsg}\n`);
    } else if (event.eventType === 'execution.failed') {
      const errorMsg = event.error.message ?? event.error.code;
      this.io.write(`${this.elapsed()} ${CROSS} execution failed: ${errorMsg}\n`);
    }
  }
}
