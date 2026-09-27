import type { IToolWithEventService } from '../abstracts/abstract-tool-types';
import type { IToolExecutionContext, IToolResult, TToolParameters } from '../interfaces/tool';

/** The registration boundary covers standard and custom tools, including replacement tools. */
export async function executeWithToolAdmission(
  tool: IToolWithEventService,
  parameters: TToolParameters,
  context: IToolExecutionContext,
): Promise<IToolResult> {
  const { beforeToolEffect, ...bodyContext } = context;
  if (!beforeToolEffect) return tool.execute(parameters, context);
  if (tool.executeWithAdmission)
    return tool.executeWithAdmission(parameters, bodyContext, beforeToolEffect);
  await beforeToolEffect(parameters);
  bodyContext.signal?.throwIfAborted();
  return tool.execute(parameters, bodyContext);
}
