/**
 * A configured hook type the session cannot execute is refused at assembly (issue #2245).
 *
 * The settings schema accepts `prompt`, `agent` and `guardrail` hook definitions, but their
 * executors exist only when the embedder supplies `providerFactory`, `sessionFactory` or
 * `guardrails` to `createSession` — options no settings file can express. Such a config validated,
 * and since PreToolUse fails closed on an unregistered executor (SEC-016), it then denied every tool
 * call in the session and in every child-process subagent. Loud, but late, and after the product had
 * told the user the config was valid.
 *
 * The schema is not the place to refuse: SELFHOST-005 made `guardrail` parse precisely so a settings
 * file can declare it for an embedder that registers guardrails. Only the composition root knows both
 * what the config declares and which executors it actually built, so the disagreement is settled
 * here, at startup, before any turn runs — with the type and the option it needs in the message.
 */

import type { IHookDefinitionSource } from '../config/config-merge.js';
import type { IHookTypeExecutor, THooksConfig } from '@robota-sdk/agent-core';

/** Why each embedder-constructed type cannot run without its `createSession` option. */
const EMBEDDER_ONLY_TYPES: Readonly<Record<string, string>> = {
  command: 'built-in command executor is disabled for this session',
  http: 'built-in HTTP executor is disabled for this session',
  prompt: 'requires the `providerFactory` createSession option',
  agent: 'requires the `sessionFactory` createSession option',
  guardrail: 'requires registered `guardrails` (createSession option)',
};

/** Every hook type the config declares that no executor in `executors` handles, with its reason. */
export function unrunnableHookTypes(
  hooks: THooksConfig | undefined,
  executors: readonly IHookTypeExecutor[],
): ReadonlyArray<{ type: string; reason: string }> {
  if (hooks === undefined) return [];
  const runnable = new Set(executors.map((executor) => executor.type));
  const seen = new Map<string, string>();
  for (const groups of Object.values(hooks)) {
    for (const group of groups ?? []) {
      for (const definition of group.hooks) {
        if (runnable.has(definition.type) || seen.has(definition.type)) continue;
        seen.set(
          definition.type,
          EMBEDDER_ONLY_TYPES[definition.type] ?? 'no executor is registered for it',
        );
      }
    }
  }
  return [...seen].map(([type, reason]) => ({ type, reason }));
}

/**
 * Throw when the config declares a hook type this session has no executor for. The message names
 * every such type and why, once, rather than one per attempted tool call.
 */
export function assertConfiguredHookTypesExecutable(
  hooks: THooksConfig | undefined,
  executors: readonly IHookTypeExecutor[],
  hookSources: readonly IHookDefinitionSource[] = [],
): void {
  const unrunnable = unrunnableHookTypes(hooks, executors);
  if (unrunnable.length === 0) return;
  const listed = unrunnable
    .map(({ type, reason }) => {
      const sources = [
        ...new Set(hookSources.filter((entry) => entry.type === type).map((entry) => entry.source)),
      ];
      const sourceDetail = sources.length === 0 ? '' : `; source: ${sources.join(', ')}`;
      return `"${type}" (${reason}${sourceDetail})`;
    })
    .join(', ');
  throw new Error(
    `Hook configuration declares hook type(s) this session cannot execute: ${listed}. ` +
      'Remove these hooks from the configuration or register an appropriate executor.',
  );
}
