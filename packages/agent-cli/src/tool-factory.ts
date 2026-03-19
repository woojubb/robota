/**
 * Tool factory — creates CLI tool instances for Session.
 *
 * Imports from the `@robota-sdk/agent-core/cli-tools` subpath export
 * to break the circular dependency that would occur if Session imported
 * the tools directly from within agent-core's barrel.
 */

import { createDefaultTools } from '@robota-sdk/agent-core/cli-tools';
import type {
  IResolvedConfig,
  ILoadedContext,
  IProjectInfo,
  IAIProvider,
  IToolWithEventService,
} from '@robota-sdk/agent-core';

/**
 * Build a toolsFactory callback suitable for passing to Session options.
 * Captures the providerFactory in closure so sub-agents can also create providers.
 */
export function buildToolsFactory(
  providerFactory?: (apiKey: string) => IAIProvider,
): (
  config: IResolvedConfig,
  context: ILoadedContext,
  projectInfo?: IProjectInfo,
) => IToolWithEventService[] {
  return (config: IResolvedConfig, context: ILoadedContext, projectInfo?: IProjectInfo) => {
    return createDefaultTools(
      config,
      context,
      projectInfo,
      providerFactory,
    ) as IToolWithEventService[];
  };
}
