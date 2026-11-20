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
  // Hooks may retain the dispatch input. The admitted body must not share that reference while
  // the journal is waiting for acknowledgement.
  const ownedParameters = structuredClone(parameters);
  const ownedContext = { ...bodyContext, parameters: ownedParameters };
  if (tool.executeWithAdmission)
    return tool.executeWithAdmission(ownedParameters, ownedContext, beforeToolEffect);
  await beforeToolEffect(ownedParameters);
  ownedContext.signal?.throwIfAborted();
  return tool.execute(ownedParameters, ownedContext);
}
