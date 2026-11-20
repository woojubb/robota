import { callPluginHook } from './plugin-hook-dispatcher';
import type { TPluginWithHooks } from './plugin-hook-dispatcher';
import type { IToolExecutionBatchContext } from './tool-execution-batch-types';
import type { ILogger } from '../utils/logger';

/** The same execution-plugin lifecycle for model and direct tool attempts. */
export function toolExecutionLifecycle(options: {
  plugins: ReadonlyArray<TPluginWithHooks>;
  logger: ILogger;
  executionId?: string;
  sessionId?: string;
  userId?: string;
  alreadyDispatched?: (index: number) => boolean;
  onExecutionStart?: () => void;
}): NonNullable<IToolExecutionBatchContext['lifecycle']> {
  const { plugins, logger, executionId, sessionId, userId, alreadyDispatched, onExecutionStart } =
    options;
  return {
    beforeDispatch: async (index, toolData) => {
      if (alreadyDispatched?.(index)) return;
      const context = { toolData, executionContext: { executionId, sessionId, userId } };
      await callPluginHook(plugins, 'beforeToolCall', context, logger);
      if (toolData.signal?.aborted) return;
      onExecutionStart?.();
      await callPluginHook(plugins, 'beforeToolExecution', context, logger);
    },
    onResult: async (_index, toolData, toolResult) => {
      await callPluginHook(
        plugins,
        'afterToolCall',
        { toolData, toolResult, executionContext: { executionId, sessionId, userId } },
        logger,
      );
    },
  };
}
