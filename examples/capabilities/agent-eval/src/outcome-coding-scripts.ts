import { taskFiles, type ICodingTask } from './outcome-coding-tasks.js';
import type { IScriptedStep } from './outcome-coding-relay.js';

/** What a scripted model does in a trial. Each behavior has a known expected verdict. */
export type TScriptedBehavior =
  'solve' | 'claim-only' | 'read-only' | 'edit-protected' | 'stray-file';

export interface IScriptedTrialPlan {
  readonly behavior: TScriptedBehavior;
  /** The scoring failures a correct pipeline must report; empty means the trial must pass. */
  readonly expectedFailures: readonly string[];
  readonly steps: readonly IScriptedStep[];
}

const STRAY = 'notes.txt';

/**
 * A scripted model for one task. `projectDir` is where the worker sees the task tree, because the
 * file tools take absolute paths. Returns undefined when the behavior does not apply to the task
 * (for example `edit-protected` on a task with no protected file).
 */
export function planScriptedTrial(
  task: ICodingTask,
  behavior: TScriptedBehavior,
  projectDir: string,
): IScriptedTrialPlan | undefined {
  const at = (path: string): string => `${projectDir}/${path}`;
  const solved = taskFiles(task, 'solved');
  const initial = Object.keys(task.files);
  const read = (path: string): IScriptedStep => ({
    toolCalls: [{ name: 'Read', args: { filePath: at(path) } }],
  });
  const write = (path: string, content: string): IScriptedStep => ({
    toolCalls: [{ name: 'Write', args: { filePath: at(path), content } }],
  });
  const solveSteps = (): IScriptedStep[] =>
    Object.keys(task.solved).flatMap((path) => [
      ...(path in task.files ? [read(path)] : []),
      write(path, solved[path] ?? ''),
    ]);
  const done: IScriptedStep = { text: 'Done' };
  const first = initial[0];
  if (first === undefined) return undefined;

  switch (behavior) {
    case 'solve':
      return { behavior, expectedFailures: [], steps: [read(first), ...solveSteps(), done] };
    case 'claim-only':
      return {
        behavior,
        expectedFailures: ['no-tools-used', 'verifier-failed'],
        steps: [done],
      };
    case 'read-only':
      return { behavior, expectedFailures: ['verifier-failed'], steps: [read(first), done] };
    case 'edit-protected': {
      const protectedPath = task.protectedFiles[0];
      if (protectedPath === undefined) return undefined;
      return {
        behavior,
        expectedFailures: ['protected-files-changed'],
        steps: [
          read(protectedPath),
          write(protectedPath, `${task.files[protectedPath] ?? ''}// edited\n`),
          ...solveSteps(),
          done,
        ],
      };
    }
    case 'stray-file':
      return {
        behavior,
        expectedFailures: ['unexpected-files'],
        steps: [read(first), ...solveSteps(), write(STRAY, 'scratch\n'), done],
      };
  }
}
