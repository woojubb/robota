import type { IAgentDefinition, TSubagentRunnerFactory } from '@robota-sdk/agent-framework';
import type { FunctionTool } from '@robota-sdk/agent-core';

import type { IDelegationReport, IDelegationRoleInit } from './outcome-coding-protocol.js';

/**
 * Wraps the runtime's subagent runner factory for the delegation arm, inside the worker. It
 * enforces the child job limit (the job past the limit is refused, never started, and counted),
 * times each job so the idle time between jobs can be measured, and lends the children the tools
 * the parent itself does not have. Free of task data, so the worker image carries it.
 */

type TRunner = ReturnType<TSubagentRunnerFactory>;
type TJobStart = Parameters<TRunner['start']>[0];
type TJobHandle = ReturnType<TRunner['start']>;
type TDeps = Parameters<TSubagentRunnerFactory>[0];

export interface IJobLimiter {
  readonly factory: TSubagentRunnerFactory;
  /** Everything observed so far, with times in milliseconds since `begin`. */
  report(): IDelegationReport;
}

/** The agent definitions the runtime offers the model, one per child role. */
export function childAgentDefinitions(
  roles: readonly IDelegationRoleInit[],
  parent: string,
  model: string,
): IAgentDefinition[] {
  return roles
    .filter((role) => role.name !== parent)
    .map((role) => ({
      name: role.name,
      description: role.description,
      systemPrompt: role.systemPrompt,
      // A child otherwise takes the runtime's configured model, not the one the trial is pinned to.
      model,
      tools: [...role.tools],
      maxTurns: role.maxTurns,
    }));
}

export function createJobLimiter(options: {
  readonly inner: TSubagentRunnerFactory;
  readonly maxJobs: number;
  /** The agent types a job may name: the child roles. Any other type is refused in `start()`. */
  readonly childAgents: readonly string[];
  /** Tools the children may use that the parent session does not have. */
  readonly childOnlyTools: readonly FunctionTool[];
  readonly clock?: () => number;
}): IJobLimiter {
  const clock = options.clock ?? (() => performance.now());
  const origin = clock();
  const jobs: { agent: string; startMs: number; endMs: number | null }[] = [];
  let refused = 0;
  const refusedAgentTypes: string[] = [];

  const factory: TSubagentRunnerFactory = (deps) => {
    // The deps object is completed after the factory runs (the session wires its live accessors
    // into it), so the children's tool list is read through a proxy rather than copied.
    const widened = new Proxy(deps, {
      get: (target, key, receiver) =>
        key === 'tools'
          ? [...target.tools, ...options.childOnlyTools]
          : Reflect.get(target, key, receiver),
    }) as TDeps;
    const runner = options.inner(widened);
    return {
      ...(runner.preflight === undefined
        ? {}
        : { preflight: (job: TJobStart) => runner.preflight?.(job) }),
      start(job: TJobStart): TJobHandle {
        // A built-in agent type would otherwise start and only be stopped later, at attribution; it
        // is refused here, counted like a refused spawn, and does not use one of the jobs.
        if (!options.childAgents.includes(job.request.agentType)) {
          refused += 1;
          refusedAgentTypes.push(job.request.agentType);
          throw new Error(
            `Agent type "${job.request.agentType}" is not available in this trial: use one of ${options.childAgents.join(', ')}.`,
          );
        }
        if (jobs.length >= options.maxJobs) {
          refused += 1;
          throw new Error(
            `Child job limit reached: at most ${options.maxJobs} child jobs may be started in one trial.`,
          );
        }
        const entry: { agent: string; startMs: number; endMs: number | null } = {
          agent: job.request.agentType,
          startMs: clock() - origin,
          endMs: null,
        };
        jobs.push(entry);
        const handle = runner.start(job);
        // The runner ends a job's result only after every turn it accepted has run, and refuses
        // input sent after that, so the window ends with the job's last child call.
        const result = handle.result.finally(() => {
          entry.endMs = clock() - origin;
        });
        return {
          ...handle,
          result,
          cancel: (reason) => handle.cancel(reason),
          send: (prompt) => handle.send(prompt),
          ...(handle.readLog === undefined
            ? {}
            : {
                readLog: (cursor) => (handle.readLog as NonNullable<typeof handle.readLog>)(cursor),
              }),
        };
      },
    };
  };

  return {
    factory,
    report: () => ({
      jobsStarted: jobs.length,
      jobsRefused: refused,
      refusedAgentTypes: [...refusedAgentTypes],
      jobs: jobs.map((entry) => ({ ...entry })),
    }),
  };
}
