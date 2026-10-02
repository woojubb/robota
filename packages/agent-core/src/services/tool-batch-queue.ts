import { TOOL_QUEUE_EVENTS } from '../event-service/span-events.js';
import type { IToolExecutionRequest } from '../interfaces/service.js';
import type { IToolExecutionResult } from '../interfaces/tool.js';

/** One submission's informational owner; restored settlements never enter this queue. */
export class ToolBatchQueue {
  private readonly queuedAt = new Date().toISOString();
  private readonly pending: Set<IToolExecutionRequest>;

  constructor(requests: readonly IToolExecutionRequest[], recovered?: ReadonlyMap<number, IToolExecutionResult>) {
    this.pending = new Set(requests.filter((_request, index) => !recovered?.has(index)));
  }

  end(request: IToolExecutionRequest, disposition: 'admission-started' | 'not-dispatched'): void {
    if (!this.pending.delete(request)) return;
    try {
      const timestamp = new Date();
      const endedAt = timestamp.toISOString();
      // A synchronous throw or an untyped rejecting emitter cannot alter dispatch or settlement.
      void Promise.resolve(request.eventService?.emit(TOOL_QUEUE_EVENTS.COMPLETED, {
        executionId: request.executionId, queuedAt: this.queuedAt,
        timestamp, endedAt, disposition,
      })).catch(() => undefined);
    } catch {
      // This observer is never an admission or journal boundary.
    }
  }

  finish(): void {
    for (const request of this.pending) this.end(request, 'not-dispatched');
  }
}
