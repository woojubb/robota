/**
 * The child-process subagent runner states how its children keep their logs (#3679, secure
 * conversation): there is no plain default, because a host that forgot would leave every child
 * writing a plaintext transcript beside sealed stores.
 *
 * The `@ts-expect-error` below is checked by `pnpm typecheck`: the line fails to compile when the
 * decision is left out, and a line that starts compiling makes the directive itself an error. The
 * `expect` beside it holds a caller that ignores the types to the same rule at run time.
 */
import { describe, expect, it } from 'vitest';

import { ChildProcessSubagentRunner, createChildProcessSubagentRunnerFactory } from '../index.js';

import type { ISubagentWorktreeAdapter } from '@robota-sdk/agent-executor';

const WORKER_ENTRY = { execPath: process.execPath, args: [], execArgv: [] as readonly string[] };
const WORKTREE_ADAPTER: ISubagentWorktreeAdapter = {
  prepare: () => {
    throw new Error('not used');
  },
  isClean: () => true,
  remove: () => {},
};
const WITHOUT_SEALING = {
  workerEntry: WORKER_ENTRY,
  worktreeAdapter: WORKTREE_ADAPTER,
  providerDefinitions: [],
} as const;

describe('the child-process subagent runner', () => {
  it('is given the sealing its children keep their logs with', () => {
    // @ts-expect-error logSealing is required
    expect(() => new ChildProcessSubagentRunner({} as never, WITHOUT_SEALING)).toThrow(TypeError);
    // @ts-expect-error logSealing is required
    expect(() => createChildProcessSubagentRunnerFactory(WITHOUT_SEALING)({} as never)).toThrow(
      TypeError,
    );

    expect(
      () =>
        new ChildProcessSubagentRunner({} as never, { ...WITHOUT_SEALING, logSealing: 'plain' }),
    ).not.toThrow();
  });
});
