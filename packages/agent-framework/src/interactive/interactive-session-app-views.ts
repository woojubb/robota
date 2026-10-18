import type { IToolAppView } from '@robota-sdk/agent-core';

/** Most views the session keeps for a surface to read. */
export const MAX_TOOL_APP_VIEWS = 16;
/** Most HTML bytes (UTF-8) the kept views may hold in total. */
export const MAX_TOOL_APP_VIEW_BYTES = 16 * 1024 * 1024;

export interface IToolAppViewStoreLimits {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
}

/**
 * The views of this session's finished model calls, kept live-only so a surface can read one on
 * demand instead of every surface receiving the document with the event. Bounded in count and in
 * HTML bytes; the oldest entry goes first, and a view that cannot fit alone is not kept.
 */
export class ToolAppViewStore {
  private readonly entries = new Map<string, { readonly view: IToolAppView; readonly bytes: number }>();
  private totalBytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;

  constructor(limits: IToolAppViewStoreLimits = {}) {
    this.maxEntries = limits.maxEntries ?? MAX_TOOL_APP_VIEWS;
    this.maxBytes = limits.maxBytes ?? MAX_TOOL_APP_VIEW_BYTES;
  }

  put(executionId: string, view: IToolAppView): void {
    this.delete(executionId);
    const bytes = Buffer.byteLength(view.html, 'utf8');
    this.entries.set(executionId, { view, bytes });
    this.totalBytes += bytes;
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
  }

  get(executionId: string): IToolAppView | undefined {
    return this.entries.get(executionId)?.view;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private delete(executionId: string): void {
    const entry = this.entries.get(executionId);
    if (!entry) return;
    this.entries.delete(executionId);
    this.totalBytes -= entry.bytes;
  }
}
