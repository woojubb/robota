/**
 * Assembly of the hook-type executor registry for a session.
 *
 * Extracted from `create-session.ts` so the registry has one owner. The ordering rule below is the
 * reason it is worth a file of its own: it is a correctness property, not a formatting choice, and
 * it was previously implied by the order of statements inside a much longer function.
 */

import { GuardrailExecutor } from '@robota-sdk/agent-core';
import { CommandExecutor, HttpExecutor } from '@robota-sdk/agent-core/node';

import { AgentExecutor } from '../hooks/agent-executor.js';
import { PromptExecutor } from '../hooks/prompt-executor.js';

import type { ICreateSessionOptions } from './create-session-types.js';
import type { IHookTypeExecutor } from '@robota-sdk/agent-core';

/**
 * Build the executor registry, built-ins first.
 *
 * `runHooks` resolves executors as `executors ?? createDefaultExecutors()` — an UNDEFINED-ONLY
 * fallback. An empty array falls back to the built-ins; a non-empty array REPLACES them. So before
 * this seeding, supplying any one of `providerFactory` / `sessionFactory` / `guardrails` /
 * `additionalHookExecutors` made the array non-empty and silently deregistered `command` and
 * `http` — two executors the caller never named. Under a fail-open PreToolUse that was a silent
 * skip; once PreToolUse fails closed on an unregistered executor (SEC-016), the same config denies
 * EVERY tool call.
 *
 * Order is load-bearing: `runHooks` builds its lookup with `Map.set` in array order, so a later
 * entry of the same type wins. Built-ins are seeded FIRST precisely so a caller-supplied executor
 * can still override one. Seeding last would make the built-ins unoverridable, trading a fail-open
 * for a different loss of caller control.
 *
 * The contract defect itself — an option that can only be supplied in full while reading as one
 * that can be supplied in part — is filed as issue #2238 and is not fixed here.
 */
export function buildHookTypeExecutors(options: ICreateSessionOptions): IHookTypeExecutor[] {
  const executors: IHookTypeExecutor[] = [new CommandExecutor(), new HttpExecutor()];

  if (options.providerFactory) {
    executors.push(
      new PromptExecutor({
        providerFactory: options.providerFactory,
        defaultModel: options.config.provider.model,
      }),
    );
  }
  if (options.sessionFactory) {
    executors.push(new AgentExecutor({ sessionFactory: options.sessionFactory }));
  }
  if (options.guardrails && Object.keys(options.guardrails).length > 0) {
    // SELFHOST-005: register the guardrail executor so a { type: 'guardrail' } hook definition runs
    // the consumer's guardrail set in parallel and fails the turn fast via the existing blocked path.
    executors.push(new GuardrailExecutor(options.guardrails));
  }
  if (options.additionalHookExecutors) {
    executors.push(...options.additionalHookExecutors);
  }

  return executors;
}
