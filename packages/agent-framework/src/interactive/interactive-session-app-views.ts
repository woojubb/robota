import type { IToolAppView } from '@robota-sdk/agent-core';

/** Most views the session keeps for a surface to read. */
export const MAX_TOOL_APP_VIEWS = 16;
/** Most bytes (UTF-8, of the whole serialized view) the kept views may hold in total. */
export const MAX_TOOL_APP_VIEW_BYTES = 16 * 1024 * 1024;
/** Most bytes one view may take; a larger one is refused rather than flushing the others for it. */
export const MAX_TOOL_APP_VIEW_ENTRY_BYTES = 4 * 1024 * 1024;

export interface IToolAppViewStoreLimits {
  readonly maxEntries?: number;
  readonly maxBytes?: number;
  readonly maxEntryBytes?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * The view as the framework keeps and serves it, or undefined when a source sent something that is
 * not a view. Only the known fields are carried over, so what is measured and stored is exactly
 * what a surface is later given.
 */
export function pickToolAppView(value: unknown): IToolAppView | undefined {
  if (!isPlainObject(value)) return undefined;
  const { sourceId, resourceUri, mimeType, html, callableTools, toolInput, structuredContent } =
    value;
  if (
    typeof sourceId !== 'string' ||
    typeof resourceUri !== 'string' ||
    typeof mimeType !== 'string' ||
    typeof html !== 'string'
  ) {
    return undefined;
  }
  if (!isPlainObject(callableTools)) return undefined;
  const tools: Record<string, string> = {};
  for (const [sourceName, runtimeName] of Object.entries(callableTools)) {
    if (typeof runtimeName !== 'string') return undefined;
    tools[sourceName] = runtimeName;
  }
  if (toolInput !== undefined && !isPlainObject(toolInput)) return undefined;
  return {
    sourceId,
    resourceUri,
    mimeType,
    html,
    callableTools: tools,
    ...(toolInput !== undefined ? { toolInput: toolInput as IToolAppView['toolInput'] } : {}),
    ...(structuredContent !== undefined
      ? { structuredContent: structuredContent as IToolAppView['structuredContent'] }
      : {}),
  };
}

/**
 * The views of this session's finished model calls, kept live-only so a surface can read one on
 * demand instead of every surface receiving the document with the event. Keyed by the id the
 * session minted for each kept view, never by a provider's tool-call id, which repeats.
 *
 * Bounded in count and in the bytes of the whole serialized view. The oldest entry goes first when
 * the total is exceeded; a single view over the per-entry cap is refused before anything is evicted.
 */
export class ToolAppViewStore {
  private readonly entries = new Map<string, { readonly view: IToolAppView; readonly bytes: number }>();
  private totalBytes = 0;
  private readonly maxEntries: number;
  private readonly maxBytes: number;
  private readonly maxEntryBytes: number;

  constructor(limits: IToolAppViewStoreLimits = {}) {
    this.maxEntries = limits.maxEntries ?? MAX_TOOL_APP_VIEWS;
    this.maxBytes = limits.maxBytes ?? MAX_TOOL_APP_VIEW_BYTES;
    this.maxEntryBytes = limits.maxEntryBytes ?? MAX_TOOL_APP_VIEW_ENTRY_BYTES;
  }

  /** Whether the view was kept. A view that cannot be kept leaves every kept view as it was. */
  put(viewId: string, view: IToolAppView): boolean {
    const bytes = Buffer.byteLength(JSON.stringify(view), 'utf8');
    if (bytes > this.maxEntryBytes || bytes > this.maxBytes) return false;
    this.delete(viewId);
    this.entries.set(viewId, { view, bytes });
    this.totalBytes += bytes;
    while (this.entries.size > this.maxEntries || this.totalBytes > this.maxBytes) {
      const oldest = this.entries.keys().next();
      if (oldest.done) break;
      this.delete(oldest.value);
    }
    return true;
  }

  get(viewId: string): IToolAppView | undefined {
    return this.entries.get(viewId)?.view;
  }

  clear(): void {
    this.entries.clear();
    this.totalBytes = 0;
  }

  private delete(viewId: string): void {
    const entry = this.entries.get(viewId);
    if (!entry) return;
    this.entries.delete(viewId);
    this.totalBytes -= entry.bytes;
  }
}
