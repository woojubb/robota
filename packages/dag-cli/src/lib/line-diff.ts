import type { ILocalRunResult } from '../local-runner/index.js';

const RED = '\x1b[31m';
const GREEN = '\x1b[32m';
const RESET = '\x1b[0m';

export const WATCH_DIFF_MAX_CHANGED_LINES = 50;

export interface ILineDiffResult {
  readonly output: string;
  readonly truncated: boolean;
  readonly totalChanged: number;
}

/** LCS-based line diff. Returns formatted diff string with ANSI colors. */
export function computeLineDiff(
  before: string,
  after: string,
  options: { maxChangedLines?: number; showFull?: boolean } = {},
): ILineDiffResult {
  const maxChangedLines = options.maxChangedLines ?? WATCH_DIFF_MAX_CHANGED_LINES;
  const showFull = options.showFull ?? false;

  const beforeLines = before.split('\n');
  const afterLines = after.split('\n');
  const lcsSeq = computeLcs(beforeLines, afterLines);

  const diffEntries: Array<{ type: 'removed' | 'added'; line: string }> = [];
  let li = 0;
  let bi = 0;
  let ai = 0;

  while (bi < beforeLines.length || ai < afterLines.length) {
    const bLine = beforeLines[bi];
    const aLine = afterLines[ai];
    const lcsLine = lcsSeq[li];

    if (bi < beforeLines.length && (li >= lcsSeq.length || bLine !== lcsLine)) {
      diffEntries.push({ type: 'removed', line: bLine ?? '' });
      bi++;
    } else if (ai < afterLines.length && (li >= lcsSeq.length || aLine !== lcsLine)) {
      diffEntries.push({ type: 'added', line: aLine ?? '' });
      ai++;
    } else {
      bi++;
      ai++;
      li++;
    }
  }

  const totalChanged = diffEntries.length;
  const truncated = !showFull && totalChanged > maxChangedLines;
  const visibleEntries = truncated ? diffEntries.slice(0, maxChangedLines) : diffEntries;

  const lines = visibleEntries.map(({ type, line }) =>
    type === 'removed' ? `${RED}- ${line}${RESET}` : `${GREEN}+ ${line}${RESET}`,
  );

  return { output: lines.join('\n') + (lines.length > 0 ? '\n' : ''), truncated, totalChanged };
}

/** Extract concatenated string outputs from a run result for diff comparison. */
export function getMainOutput(result: ILocalRunResult): string {
  const parts: string[] = [];
  for (const taskRun of result.taskRuns) {
    if (!taskRun.outputSnapshot) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(taskRun.outputSnapshot) as unknown;
    } catch (_e) {
      // allow-fallback: outputSnapshot is advisory display data; malformed values are silently skipped
      continue;
    }
    if (typeof parsed !== 'object' || parsed === null) continue;
    for (const val of Object.values(parsed as Record<string, unknown>)) {
      if (typeof val === 'string') parts.push(val);
    }
  }
  return parts.join('\n');
}

// ---------------------------------------------------------------------------
// Internal LCS helper
// ---------------------------------------------------------------------------

function computeLcs(a: readonly string[], b: readonly string[]): readonly string[] {
  const m = a.length;
  const n = b.length;
  const dp = new Int32Array((m + 1) * (n + 1));
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i * (n + 1) + j] =
        a[i - 1] === b[j - 1]
          ? dp[(i - 1) * (n + 1) + (j - 1)] + 1
          : Math.max(dp[(i - 1) * (n + 1) + j], dp[i * (n + 1) + (j - 1)]);
    }
  }
  const result: string[] = [];
  let i = m;
  let j = n;
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) {
      result.unshift(a[i - 1]!);
      i--;
      j--;
    } else if (dp[(i - 1) * (n + 1) + j] >= dp[i * (n + 1) + (j - 1)]) {
      i--;
    } else {
      j--;
    }
  }
  return result;
}
