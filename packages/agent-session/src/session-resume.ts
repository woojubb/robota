import type { IResumeExecutionOptions } from '@robota-sdk/agent-core';
import type { IRunContext } from './session-run-context.js';
import { createRunObservers } from './session-run-observation.js';

export type TSessionResumeOptions = Pick<
  IResumeExecutionOptions,
  'executionId' | 'journal' | 'signal' | 'traceContext'
>;

/** Continue without replaying input, compaction or completed lifecycle hooks. */
export async function executeResume(
  ctx: IRunContext,
  options: TSessionResumeOptions & Pick<IResumeExecutionOptions, 'toolResponses'>,
): Promise<string> {
  const response = await ctx.agent.resume({
    ...options,
    ...createRunObservers(ctx, options.traceContext),
  });
  ctx.contextTracker.updateFromHistory(ctx.agent.getHistory());
  ctx.onContextUpdate?.(ctx.contextTracker.getContextState());
  if (ctx.getSessionStore()) ctx.persistSession();
  return response;
}
