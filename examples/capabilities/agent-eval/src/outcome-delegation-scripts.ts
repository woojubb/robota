import type { IScriptedStep } from './outcome-coding-relay.js';
import { taskFiles, type ICodingTask } from './outcome-coding-tasks.js';
import { DELEGATION_TOOL } from './outcome-delegation-roles.js';

/**
 * Scripted models for the delegation arm. Child jobs are waited for one at a time, so the requests
 * of all roles arrive in one fixed order and a flat script serves the parent, the implementer and
 * the reviewer in turn. Each behavior has a known expected verdict.
 */
export type TDelegationBehavior =
  | 'pass'
  | 'broken-approved'
  | 'no-delegation'
  | 'fourth-spawn'
  | 'parent-writes'
  | 'reviewer-writes'
  | 'call-cap';

export interface IDelegationScriptPlan {
  readonly behavior: TDelegationBehavior;
  /** The scoring failures a correct pipeline must report; empty means the trial must pass. */
  readonly expectedFailures: readonly string[];
  readonly steps: readonly IScriptedStep[];
  /** Child jobs the worker must report started and refused. */
  readonly childJobsStarted: number;
  readonly childJobsRefused: number;
  /** A smaller per-trial cap this behavior needs, and whether it must be reached. */
  readonly maxCalls?: number;
  readonly capReached: boolean;
}

/** One waited child job, as the model writes it. */
function spawn(agent: 'implementer' | 'reviewer', prompt: string): IScriptedStep {
  return {
    toolCalls: [
      {
        name: DELEGATION_TOOL,
        args: { args: `parallel --wait ${agent}=${agent}:"${prompt}"` },
      },
    ],
  };
}

export function planDelegationTrial(
  task: ICodingTask,
  behavior: TDelegationBehavior,
  projectDir: string,
): IDelegationScriptPlan | undefined {
  const at = (path: string): string => `${projectDir}/${path}`;
  const solved = taskFiles(task, 'solved');
  const first = Object.keys(task.files)[0];
  if (first === undefined) return undefined;
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
  const implement = [
    spawn('implementer', 'Make the requested change.'),
    read(first),
    ...solveSteps(),
    done,
  ];
  const review = (verdict: string): IScriptedStep[] => [
    spawn('reviewer', 'Judge the change.'),
    read(first),
    { text: verdict },
  ];
  const base = { behavior, childJobsRefused: 0, capReached: false } as const;

  switch (behavior) {
    case 'pass':
      return {
        ...base,
        expectedFailures: [],
        childJobsStarted: 2,
        steps: [...implement, ...review('APPROVED. The change is complete.'), done],
      };
    case 'broken-approved':
      return {
        ...base,
        expectedFailures: ['verifier-failed'],
        childJobsStarted: 2,
        steps: [
          spawn('implementer', 'Make the requested change.'),
          read(first),
          { text: 'Done' },
          ...review('APPROVED. Looks good.'),
          done,
        ],
      };
    case 'no-delegation':
      return {
        ...base,
        expectedFailures: ['no-tools-used', 'not-delegated', 'verifier-failed'],
        childJobsStarted: 0,
        steps: [done],
      };
    case 'fourth-spawn':
      return {
        ...base,
        expectedFailures: [],
        childJobsStarted: 3,
        childJobsRefused: 1,
        steps: [
          ...implement,
          ...review('CHANGES NEEDED. One more look.'),
          spawn('implementer', 'Revise the change.'),
          read(first),
          { text: 'Revised' },
          spawn('reviewer', 'Judge the change again.'),
          done,
        ],
      };
    case 'parent-writes':
      return {
        ...base,
        // The relay refuses the next request, whose history holds the parent's write call, so the
        // run ends there; the write itself was never executed.
        expectedFailures: ['no-tools-used', 'not-completed', 'not-delegated', 'verifier-failed'],
        childJobsStarted: 0,
        steps: [...solveSteps().filter((step) => step.toolCalls?.[0]?.name === 'Write'), done],
      };
    case 'reviewer-writes':
      return {
        ...base,
        expectedFailures: ['verifier-failed'],
        childJobsStarted: 2,
        steps: [
          spawn('implementer', 'Make the requested change.'),
          read(first),
          { text: 'Done' },
          spawn('reviewer', 'Judge the change.'),
          ...solveSteps().filter((step) => step.toolCalls?.[0]?.name === 'Write'),
          { text: 'APPROVED' },
          done,
        ],
      };
    case 'call-cap':
      return {
        ...base,
        maxCalls: 3,
        capReached: true,
        // The refused request ends the run with an error, which the worker reports with no tool calls.
        expectedFailures: [
          'no-tools-used',
          'not-completed',
          'not-delegated',
          'call-cap',
          'verifier-failed',
        ],
        childJobsStarted: 0,
        steps: Array.from({ length: 6 }, () => read(first)),
      };
  }
}
