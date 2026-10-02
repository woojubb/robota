import type { ICliRuntimeContext } from '../product/runtime-context.js';
import { closeSync, constants, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

import type { ICommandCostBudget, ICommandCostBudgetAdapter } from '@robota-sdk/agent-framework';

/**
 * CMD-007 (issue #2058): this product's `/cost budget` storage — `the configured project directory/budget.json` under the
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
export function costBudgetFile(runtime: ICliRuntimeContext): string { return join(runtime.layout.projectDirectory, 'budget.json'); }

function writeBudgetFile(cwd: string, fileName: string, contents: string): void {
  mkdirSync(join(cwd, dirname(fileName)), { recursive: true });
  const file = join(cwd, fileName);
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
        `Refused: ${fileName} is a symbolic link, and the budget is never written through one. ` +
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

export function createFileCostBudgetAdapter(cwd: string, runtime: ICliRuntimeContext): ICommandCostBudgetAdapter {
  const fileName = costBudgetFile(runtime);
  return {
    read(): ICommandCostBudget | undefined {
      let raw: string;
      try {
        raw = readFileSync(join(cwd, fileName), 'utf-8');
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
      writeBudgetFile(cwd, fileName, JSON.stringify(budget, null, 2));
    },
    // Clearing writes an empty document rather than unlinking: `read` treats `{}` and absence alike,
    // and an unconditional write has no check-then-use window.
    clear(): void {
      writeBudgetFile(cwd, fileName, '{}');
    },
  };
}
