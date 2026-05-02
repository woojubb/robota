import type { IDiffLine } from './edit-diff.js';

const MAX_DIFF_LINES = 12;
const TRUNCATED_SHOW = 10;

export interface IToolDiffSummaryInput {
  file?: string;
  lines: readonly IDiffLine[];
}

export interface IToolDiffSummary {
  file?: string;
  markdown: string;
  truncated: boolean;
  remainingLineCount: number;
}

export function buildToolDiffSummary(input: IToolDiffSummaryInput): IToolDiffSummary {
  const visibleLines =
    input.lines.length > MAX_DIFF_LINES ? input.lines.slice(0, TRUNCATED_SHOW) : input.lines;
  const lineNumberWidth = Math.max(...visibleLines.map((line) => line.lineNumber), 0).toString()
    .length;
  const body = visibleLines.map((line) => formatDiffLine(line, lineNumberWidth));
  const truncated = input.lines.length > MAX_DIFF_LINES;

  return {
    file: input.file,
    markdown: ['```diff', ...body, '```'].join('\n'),
    truncated,
    remainingLineCount: truncated ? input.lines.length - TRUNCATED_SHOW : 0,
  };
}

function formatDiffLine(line: IDiffLine, lineNumberWidth: number): string {
  const lineNumber = line.lineNumber.toString().padStart(lineNumberWidth, ' ');
  if (line.type === 'remove') return `- ${lineNumber} | ${line.text}`;
  if (line.type === 'add') return `+ ${lineNumber} | ${line.text}`;
  return `  ${lineNumber} | ${line.text}`;
}
