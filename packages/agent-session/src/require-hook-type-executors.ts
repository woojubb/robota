import type { IHookTypeExecutor } from '@robota-sdk/agent-core';

/**
 * The executors a session runs hook handlers through. REQUIRED, with no host default.
 *
 * The shell and HTTP executors drive a Node host, so a platform-neutral session cannot reach for
 * them itself; whoever composes the session says which handler types it can run. A JavaScript
 * consumer is not type-checked, so without a runtime check an omitted list would be `undefined` and
 * every configured hook would quietly run nothing — silence is not success, so refuse instead (the
 * same reasoning as `requireExecutionRoot`).
 */
export function requireHookTypeExecutors(
  executors: unknown,
  owner: string,
): readonly IHookTypeExecutor[] {
  if (!Array.isArray(executors)) {
    throw new Error(
      `${owner} requires \`hookTypeExecutors\`: the executors that run a hook's handlers. On Node ` +
        'pass `[new CommandExecutor(), new HttpExecutor()]` from `@robota-sdk/agent-core/node`; ' +
        'pass `[]` to run no hook handlers.',
    );
  }
  return executors as readonly IHookTypeExecutor[];
}
