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
    input.lines.length > MAX_DIFF_LINES ? selectVisibleDiffLines(input.lines) : input.lines;
  const lineNumberWidth = Math.max(...visibleLines.map((line) => line.lineNumber), 0).toString()
    .length;
  const body = visibleLines.map((line) => formatDiffLine(line, lineNumberWidth));
  const truncated = input.lines.length > MAX_DIFF_LINES;

  return {
    file: input.file,
    markdown: ['```diff', ...body, '```'].join('\n'),
    truncated,
    remainingLineCount: truncated ? input.lines.length - visibleLines.length : 0,
  };
}

function formatDiffLine(line: IDiffLine, lineNumberWidth: number): string {
  if (line.type === 'hunk') return line.text;
  const lineNumber = line.lineNumber.toString().padStart(lineNumberWidth, ' ');
  if (line.type === 'remove') return `- ${lineNumber} | ${line.text}`;
  if (line.type === 'add') return `+ ${lineNumber} | ${line.text}`;
  return `  ${lineNumber} | ${line.text}`;
}

function selectVisibleDiffLines(lines: readonly IDiffLine[]): readonly IDiffLine[] {
  const groups = groupByHunk(lines);
  const visible: IDiffLine[] = [];

  for (const group of groups) {
    if (visible.length === 0 && group.length > TRUNCATED_SHOW) {
      return group.slice(0, TRUNCATED_SHOW);
    }
    if (visible.length + group.length > TRUNCATED_SHOW) break;
    visible.push(...group);
  }

  return visible.length > 0 ? visible : lines.slice(0, TRUNCATED_SHOW);
}

function groupByHunk(lines: readonly IDiffLine[]): IDiffLine[][] {
  const groups: IDiffLine[][] = [];
  let current: IDiffLine[] = [];

  for (const line of lines) {
    if (line.type === 'hunk' && current.length > 0) {
      groups.push(current);
      current = [line];
      continue;
    }
    current.push(line);
  }

  if (current.length > 0) {
    groups.push(current);
  }

  return groups;
}
