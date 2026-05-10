import type { TUniversalValue } from '@robota-sdk/agent-core';

const MAX_PREVIEW_LINES = 4;
const SUCCESS_EXIT_CODE = 0;
const COMMAND_TOOL_NAMES = new Set(['Bash', 'BackgroundProcess']);

export interface ICommandOutputInput {
  toolName: string;
  firstArg?: string;
  isRunning?: boolean;
  result?: string;
  toolResultData?: string;
}

export interface ICommandOutputSummary {
  status: 'success' | 'error';
  statusLabel: string;
  previewLines: string[];
  omittedLineCount: number;
  transcriptHint?: string;
}

export function formatCommandOutputSummary(
  tool: ICommandOutputInput,
): ICommandOutputSummary | undefined {
  if (!COMMAND_TOOL_NAMES.has(tool.toolName) || !tool.toolResultData) return undefined;

  const parsed = parseToolResultData(tool.toolResultData);
  const exitCode = getNumberValue(parsed, 'exitCode');
  const successValue = getBooleanValue(parsed, 'success');
  const output = buildOutputText(tool.toolResultData, parsed);
  const lines = trimTrailingBlankLines(splitOutputLines(output));
  const previewLines = lines.slice(0, MAX_PREVIEW_LINES);
  const omittedLineCount = Math.max(0, lines.length - previewLines.length);
  const isFailed =
    tool.result === 'error' ||
    successValue === false ||
    (exitCode !== undefined && exitCode !== SUCCESS_EXIT_CODE);

  return {
    status: isFailed ? 'error' : 'success',
    statusLabel: formatStatusLabel(isFailed, exitCode),
    previewLines,
    omittedLineCount,
    transcriptHint:
      omittedLineCount > 0
        ? `... +${omittedLineCount} lines (full output in session transcript)`
        : undefined,
  };
}

function parseToolResultData(value: string): TUniversalValue {
  try {
    return JSON.parse(value) as TUniversalValue;
  } catch {
    return value;
  }
}

function buildOutputText(raw: string, parsed: TUniversalValue): string {
  if (!isUniversalObject(parsed)) return raw;

  const output = getStringValue(parsed, 'output');
  if (output !== undefined) return output;

  const stdout = getStringValue(parsed, 'stdout');
  const stderr = getStringValue(parsed, 'stderr');
  const error = getStringValue(parsed, 'error');
  const lines: string[] = [];
  if (stdout) lines.push(stdout);
  if (stderr) lines.push(prefixLines(stderr, '[stderr] '));
  if (!stdout && !stderr && error) lines.push(error);
  return lines.join('\n');
}

function formatStatusLabel(isFailed: boolean, exitCode: number | undefined): string {
  if (exitCode !== undefined && exitCode !== SUCCESS_EXIT_CODE) return `exit ${exitCode}`;
  return isFailed ? 'error' : 'ok';
}

function splitOutputLines(output: string): string[] {
  if (!output) return [];
  return output.replace(/\r\n/g, '\n').split('\n');
}

function trimTrailingBlankLines(lines: string[]): string[] {
  let end = lines.length;
  while (end > 0 && lines[end - 1]!.trim().length === 0) {
    end -= 1;
  }
  return lines.slice(0, end);
}

function prefixLines(value: string, prefix: string): string {
  return splitOutputLines(value)
    .map((line) => `${prefix}${line}`)
    .join('\n');
}

function isUniversalObject(value: TUniversalValue): value is Record<string, TUniversalValue> {
  return (
    typeof value === 'object' && value !== null && !Array.isArray(value) && !(value instanceof Date)
  );
}

function getStringValue(source: TUniversalValue, key: string): string | undefined {
  if (!isUniversalObject(source)) return undefined;
  const value = source[key];
  return typeof value === 'string' ? value : undefined;
}

function getNumberValue(source: TUniversalValue, key: string): number | undefined {
  if (!isUniversalObject(source)) return undefined;
  const value = source[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}

function getBooleanValue(source: TUniversalValue, key: string): boolean | undefined {
  if (!isUniversalObject(source)) return undefined;
  const value = source[key];
  return typeof value === 'boolean' ? value : undefined;
}
