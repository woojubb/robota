import assert from 'node:assert/strict';
import { test } from 'node:test';

import type { TSubagentRunnerFactory } from '@robota-sdk/agent-framework';

import { childAgentDefinitions, createJobLimiter } from './outcome-delegation-limits.js';
import { delegationRoles, PARENT_ROLE } from './outcome-delegation-roles.js';

type TDeps = Parameters<TSubagentRunnerFactory>[0];
type TStart = Parameters<ReturnType<TSubagentRunnerFactory>['start']>[0];

function job(agentType: string): TStart {
  return { taskId: `task-${agentType}`, request: { agentType } } as unknown as TStart;
}

/** A runner whose jobs finish when told to, and that records the tool list it was built with. */
function fakeInner() {
  const started: string[] = [];
  const finishers: (() => void)[] = [];
  let toolsSeen: unknown;
  const factory: TSubagentRunnerFactory = (deps) => {
    toolsSeen = () => deps.tools;
    return {
      start: (start) => {
        started.push(start.request.agentType);
        let finish: () => void = () => undefined;
        const result = new Promise<unknown>((resolve) => {
          finish = () => resolve({ ok: true });
        });
        finishers.push(finish);
        return {
          taskId: start.taskId,
          result,
          cancel: async () => undefined,
          send: async () => undefined,
        } as unknown as ReturnType<ReturnType<TSubagentRunnerFactory>['start']>;
      },
    };
  };
  return { factory, started, finishers, tools: () => (toolsSeen as () => unknown[])() };
}

test('child agent definitions are the non-parent roles with their own tool lists', () => {
  const definitions = childAgentDefinitions(
    delegationRoles('/work/project'),
    PARENT_ROLE,
    'pinned',
  );
  assert.deepEqual(
    definitions.map((definition) => definition.name),
    ['implementer', 'reviewer'],
  );
  assert.ok(definitions.every((definition) => definition.model === 'pinned'));
  assert.deepEqual(definitions[1]?.tools, ['Read', 'Glob', 'Grep']);
  assert.ok(definitions.every((definition) => definition.systemPrompt.includes('[eval-role:')));
});

test('the job past the limit is refused, never started, and counted', () => {
  const inner = fakeInner();
  const limiter = createJobLimiter({ inner: inner.factory, maxJobs: 3, childOnlyTools: [] });
  const runner = limiter.factory({ tools: [] } as unknown as TDeps);
  for (const agent of ['implementer', 'reviewer', 'implementer']) runner.start(job(agent));
  assert.throws(() => runner.start(job('reviewer')), /Child job limit reached/);
  assert.throws(() => runner.start(job('reviewer')), /Child job limit reached/);
  assert.deepEqual(inner.started, ['implementer', 'reviewer', 'implementer']);
  const report = limiter.report();
  assert.equal(report.jobsStarted, 3);
  assert.equal(report.jobsRefused, 2);
});

test('jobs are timed from start to end so the gaps between them can be measured', async () => {
  const inner = fakeInner();
  let now = 1_000;
  const limiter = createJobLimiter({
    inner: inner.factory,
    maxJobs: 3,
    childOnlyTools: [],
    clock: () => now,
  });
  const runner = limiter.factory({ tools: [] } as unknown as TDeps);
  now = 1_100;
  const first = runner.start(job('implementer'));
  now = 1_400;
  inner.finishers[0]?.();
  await first.result;
  now = 1_450;
  runner.start(job('reviewer'));
  assert.deepEqual(limiter.report().jobs, [
    { agent: 'implementer', startMs: 100, endMs: 400 },
    { agent: 'reviewer', startMs: 450, endMs: null },
  ]);
});

test('the children are lent tools the parent does not have, read live from the deps', () => {
  const inner = fakeInner();
  const lent = { getName: () => 'Write' } as never;
  const limiter = createJobLimiter({ inner: inner.factory, maxJobs: 3, childOnlyTools: [lent] });
  const deps = { tools: [{ getName: () => 'Read' }] } as unknown as TDeps;
  limiter.factory(deps);
  // The session completes the deps object after the factory ran; the proxy sees the later value.
  (deps as { tools: unknown[] }).tools = [{ getName: () => 'Read' }, { getName: () => 'Glob' }];
  const names = inner.tools().map((tool) => (tool as { getName(): string }).getName());
  assert.deepEqual(names, ['Read', 'Glob', 'Write']);
});
