import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  ICreateLineDetailPageInput,
  ICreateMainThreadDetailPageInput,
  IExecutionDetailPage,
} from './execution-workspace-types.js';

const EXECUTION_DETAIL_PAGE_SIZE = 80;

export function createMainThreadDetailPage(
  input: ICreateMainThreadDetailPageInput,
): IExecutionDetailPage {
  const offset = normalizeOffset(input.cursor?.offset);
  const page = input.history.slice(offset, offset + EXECUTION_DETAIL_PAGE_SIZE);
  const records = page.map((entry) => ({
    id: entry.id,
    kind: entry.category === 'chat' ? ('message' as const) : ('progress' as const),
    text: formatHistoryEntry(entry),
    timestamp: entry.timestamp.toISOString(),
    sourceId: entry.type,
  }));
  return {
    entryId: input.entryId,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(offset + page.length < input.history.length
      ? { nextCursor: { offset: offset + page.length } }
      : {}),
    records,
  };
}

export function createLineDetailPage(input: ICreateLineDetailPageInput): IExecutionDetailPage {
  const offset = input.cursor?.offset ?? 0;
  const records = input.lines.map((line, index) => ({
    id: `${input.entryId}:${offset}:${index}`,
    kind: input.kind ?? ('process_output' as const),
    text: line,
  }));
  return {
    entryId: input.entryId,
    ...(input.cursor ? { cursor: input.cursor } : {}),
    ...(input.nextCursor ? { nextCursor: input.nextCursor } : {}),
    records,
  };
}

function normalizeOffset(offset: number | undefined): number {
  return typeof offset === 'number' && Number.isFinite(offset) && offset > 0
    ? Math.floor(offset)
    : 0;
}

function formatHistoryEntry(entry: IHistoryEntry): string {
  if (typeof entry.data === 'string') return entry.data;
  return entry.type;
}
