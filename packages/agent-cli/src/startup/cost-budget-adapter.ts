import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ICommandCostBudget, ICommandCostBudgetAdapter } from '@robota-sdk/agent-framework';

/**
 * CMD-007 (issue #2058): this product's `/cost budget` storage — `.robota/budget.json` under the
 * workspace. The command package sees only `ICommandCostBudgetAdapter`; the path literal and every
 * filesystem call live here, at the shell, where product storage policy belongs.
 *
 * Write policy, carried over verbatim from the command it left:
 *
 * 1. No `existsSync` before a write — that check-then-use window was CodeQL `js/file-system-race`:
 *    swapping the path for a symlink inside it made the write land on the target.
 * 2. `O_NOFOLLOW` on the open, so a symlink planted BEFORE the call is refused by the kernel with
 *    `ELOOP` rather than followed. Windows has no such flag; the write falls back to a plain one
 *    rather than silently claiming a protection the platform cannot give.
 */
export const COST_BUDGET_FILE = '.robota/budget.json';

function writeBudgetFile(cwd: string, contents: string): void {
  mkdirSync(join(cwd, dirname(COST_BUDGET_FILE)), { recursive: true });
  const file = join(cwd, COST_BUDGET_FILE);
  const noFollow = constants.O_NOFOLLOW;
  if (noFollow === undefined) {
    writeFileSync(file, contents);
    return;
  }
  let handle: number;
  try {
    handle = openSync(file, constants.O_WRONLY | constants.O_CREAT | constants.O_TRUNC | noFollow);
  } catch (error) {
    // allow-fallback: re-thrown as a typed failure naming the guard — `ELOOP` is the symlink refusal
    // firing, not a permissions problem, and the message must say which
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ELOOP') {
      throw new Error(
        `Refused: ${COST_BUDGET_FILE} is a symbolic link, and the budget is never written through one. ` +
          'Replace it with a regular file, or remove it.',
      );
    }
    throw error;
  }
  try {
    writeFileSync(handle, contents);
  } finally {
    closeSync(handle);
  }
}

export function createFileCostBudgetAdapter(cwd: string): ICommandCostBudgetAdapter {
  return {
    read(): ICommandCostBudget | undefined {
      let raw: string;
      try {
        raw = readFileSync(join(cwd, COST_BUDGET_FILE), 'utf-8');
      } catch {
        // allow-fallback: an absent or unreadable budget file means no budget is set
        return undefined;
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        // allow-fallback: a malformed budget document reads as no budget set (an empty `{}` is the
        // cleared form, so "unreadable" and "cleared" already share one meaning here)
        return undefined;
      }
      if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) return undefined;
      const monthly = (parsed as Record<string, unknown>)['monthly'];
      return typeof monthly === 'number' && Number.isFinite(monthly) ? { monthly } : undefined;
    },
    write(budget: ICommandCostBudget): void {
      writeBudgetFile(cwd, JSON.stringify(budget, null, 2));
    },
    // Clearing writes an empty document rather than unlinking: `read` treats `{}` and absence alike,
    // and an unconditional write has no check-then-use window.
    clear(): void {
      writeBudgetFile(cwd, '{}');
    },
  };
}
