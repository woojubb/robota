import type { IMemoryEvent } from './automatic-memory-types.js';

/** Memory event types that produce a visible transcript notice. */
export const VISIBLE_MEMORY_EVENT_TYPES: ReadonlySet<IMemoryEvent['type']> = new Set([
  'memory_candidate_saved',
  'memory_candidate_approved',
  'memory_candidate_rejected',
  'memory_retrieved',
]);

/** Format a memory event into the user-facing transcript message. */
export function formatMemoryEventMessage(event: IMemoryEvent): string {
  const topic = event.topic ? `: ${event.topic}` : '';
  switch (event.type) {
    case 'memory_candidate_saved':
      return `Memory saved${topic}`;
    case 'memory_candidate_approved':
      return `Memory approved${topic}`;
    case 'memory_candidate_rejected':
      return `Memory rejected${topic}${event.reason ? ` (${event.reason})` : ''}`;
    case 'memory_retrieved':
      return `Memory recalled${topic}`;
    case 'memory_candidate_extracted':
      return `Memory candidate extracted${topic}`;
    case 'memory_candidate_queued':
      return `Memory candidate queued${topic}`;
    case 'memory_candidate_skipped':
      return `Memory candidate skipped${topic}${event.reason ? ` (${event.reason})` : ''}`;
  }
}
