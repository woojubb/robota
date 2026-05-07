import type { IBackgroundTaskLogCursor, IBackgroundTaskLogPage } from './types.js';

const DEFAULT_TRUNCATION_MARKER = '\n[output truncated]\n';
const UTF8_ENCODER = new TextEncoder();

export const DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE = 200;

export interface ILimitedOutputCapture {
  appendOutput(text: string): void;
  getOutput(): string;
}

export interface ICreateLimitedOutputCaptureOptions {
  limitBytes: number;
  truncationMarker?: string;
}

export function createLimitedOutputCapture(
  options: ICreateLimitedOutputCaptureOptions,
): ILimitedOutputCapture {
  const chunks: string[] = [];
  let capturedBytes = 0;
  let truncated = false;
  const truncationMarker = options.truncationMarker ?? DEFAULT_TRUNCATION_MARKER;

  return {
    appendOutput(text: string): void {
      if (truncated) return;
      const remaining = options.limitBytes - capturedBytes;
      const byteLength = getUtf8ByteLength(text);
      if (byteLength <= remaining) {
        chunks.push(text);
        capturedBytes += byteLength;
        return;
      }
      const allowed = sliceUtf8ByByteLength(text, Math.max(remaining, 0));
      if (allowed.length > 0) {
        chunks.push(allowed);
      }
      chunks.push(truncationMarker);
      truncated = true;
    },
    getOutput(): string {
      return chunks.join('');
    },
  };
}

export function appendPrefixedLogLines(lines: string[], source: string, text: string): void {
  for (const line of text.split(/\r?\n/)) {
    if (line.length > 0) {
      lines.push(`[${source}] ${line}`);
    }
  }
}

export function createBackgroundTaskLogPage(
  taskId: string,
  lines: readonly string[],
  cursor?: IBackgroundTaskLogCursor,
  pageSize = DEFAULT_BACKGROUND_TASK_LOG_PAGE_SIZE,
): IBackgroundTaskLogPage {
  const offset = cursor?.offset ?? 0;
  const nextOffset = Math.min(offset + pageSize, lines.length);
  return {
    taskId,
    cursor,
    nextCursor: nextOffset < lines.length ? { offset: nextOffset } : undefined,
    lines: lines.slice(offset, nextOffset),
  };
}

function getUtf8ByteLength(text: string): number {
  return UTF8_ENCODER.encode(text).byteLength;
}

function sliceUtf8ByByteLength(text: string, limitBytes: number): string {
  let usedBytes = 0;
  let endIndex = 0;
  for (const char of text) {
    const byteLength = getUtf8ByteLength(char);
    if (usedBytes + byteLength > limitBytes) {
      break;
    }
    usedBytes += byteLength;
    endIndex += char.length;
  }
  return text.slice(0, endIndex);
}
