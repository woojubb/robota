import type { TAppToolOutcome, TAppToolPart, TAppView } from './types.js';
import type { IActiveTool } from '../hooks/session-client-types.js';

export type TCallToolContent =
  | { type: 'text'; text: string }
  | { type: 'image'; data: string; mimeType: string }
  | { type: 'audio'; data: string; mimeType: string };

export interface ICallToolResult {
  content: TCallToolContent[];
  structuredContent?: Record<string, unknown>;
  isError: boolean;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function contentFromParts(parts: readonly TAppToolPart[] | undefined): TCallToolContent[] {
  const content: TCallToolContent[] = [];
  for (const part of parts ?? []) {
    if (part.type === 'text') {
      content.push({ type: 'text', text: part.text });
    } else if (part.type === 'image_inline') {
      content.push({ type: 'image', data: part.data, mimeType: part.mimeType });
    } else if (part.type === 'audio_inline') {
      content.push({ type: 'audio', data: part.data, mimeType: part.mimeType });
    }
  }
  return content;
}

export function outcomeToCallToolResult(outcome: TAppToolOutcome): ICallToolResult {
  let content = contentFromParts(outcome.parts);
  if (content.length === 0 && typeof outcome.data === 'string') {
    content = [{ type: 'text', text: outcome.data }];
  }
  if (!outcome.success && outcome.error !== undefined) {
    content = [...content, { type: 'text', text: outcome.error }];
  }
  return {
    content,
    ...(isRecord(outcome.data) ? { structuredContent: outcome.data } : {}),
    isError: !outcome.success,
  };
}

export function toCallToolResult(tool: IActiveTool, view: TAppView): ICallToolResult {
  let content = contentFromParts(tool.toolResultParts);
  if (content.length === 0 && tool.toolResultData !== undefined) {
    content = [{ type: 'text', text: tool.toolResultData }];
  }
  return {
    content,
    ...(isRecord(view.structuredContent) ? { structuredContent: view.structuredContent } : {}),
    isError: tool.status === 'error',
  };
}
