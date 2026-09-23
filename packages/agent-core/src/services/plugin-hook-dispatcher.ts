import { EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS } from './execution-constants';

import type {
  IPluginContract,
  IPluginHooks,
  IPluginOptions,
  IPluginStats,
  IPluginErrorContext,
} from '../abstracts/abstract-plugin';
import type { IPluginExecutionContext } from '../abstracts/abstract-plugin-types';
import type { IPluginContext } from '../interfaces/types';
import type { ILogger } from '../utils/logger';

/** Combined plugin type used throughout the execution service */
export type TPluginWithHooks = IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks;

/** Handler for a single plugin hook invocation */
type TPluginHookHandler = (plugin: TPluginWithHooks, context: IPluginContext) => Promise<void>;

/**
 * PLG-020 (issue #2460): the execution-level context the official plugins consume. Built from the
 * dispatcher's `executionContext` (string ids) plus the conversation messages, so `LimitsPlugin`,
 * `WebhookPlugin` and friends are reached by the production dispatcher rather than only by tests.
 */
function toExecutionContext(context: IPluginContext): IPluginExecutionContext {
  const execution: IPluginExecutionContext = {};
  for (const key of ['executionId', 'sessionId', 'userId'] as const) {
    const value = context.executionContext?.[key];
    if (typeof value === 'string' && value.length > 0) execution[key] = value;
  }
  if (context.messages) execution.messages = context.messages;
  return execution;
}

/** Map from hook name to its handler function */
const HOOK_HANDLERS: Record<string, TPluginHookHandler> = {
  // PLG-020 (issue #2460): the four execution-level hooks the official plugins implement, and the
  // message hook the history plugin implements, were declared on `IPluginHooks` and dispatched by
  // nothing. They are dispatched here, at the same sites as their run-level siblings.
  beforeExecution: async (plugin, context) => {
    if (plugin.beforeExecution) await plugin.beforeExecution(toExecutionContext(context));
  },
  afterExecution: async (plugin, context) => {
    if (plugin.afterExecution && context.executionResult) {
      await plugin.afterExecution(toExecutionContext(context), context.executionResult);
    }
  },
  afterConversation: async (plugin, context) => {
    if (plugin.afterConversation && context.executionResult) {
      await plugin.afterConversation(toExecutionContext(context), context.executionResult);
    }
  },
  afterToolExecution: async (plugin, context) => {
    if (plugin.afterToolExecution && context.executionResult?.toolCalls?.length) {
      await plugin.afterToolExecution(toExecutionContext(context), context.executionResult);
    }
  },
  onMessageAdded: async (plugin, context) => {
    if (plugin.onMessageAdded && context.message) await plugin.onMessageAdded(context.message);
  },
  beforeRun: async (plugin, context) => {
    if (plugin.beforeRun && context.input) {
      await plugin.beforeRun(context.input, context.metadata);
    }
  },
  afterRun: async (plugin, context) => {
    if (plugin.afterRun && context.input && context.response) {
      await plugin.afterRun(context.input, context.response, context.metadata);
    }
  },
  beforeProviderCall: async (plugin, context) => {
    if (plugin.beforeProviderCall && context.messages) {
      await plugin.beforeProviderCall(context.messages);
    }
  },
  afterProviderCall: async (plugin, context) => {
    if (plugin.afterProviderCall && context.messages && context.responseMessage) {
      await plugin.afterProviderCall(context.messages, context.responseMessage);
    }
  },
  onError: async (plugin, context) => {
    if (plugin.onError && context.error) {
      const errorContext: IPluginErrorContext = {
        action: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.ERROR}`,
        metadata: {},
      };

      const executionIdValue = context.executionContext?.['executionId'];
      if (typeof executionIdValue === 'string' && executionIdValue.length > 0) {
        errorContext.executionId = executionIdValue;
      }
      const sessionIdValue = context.executionContext?.['sessionId'];
      if (typeof sessionIdValue === 'string' && sessionIdValue.length > 0) {
        errorContext.sessionId = sessionIdValue;
      }
      const userIdValue = context.executionContext?.['userId'];
      if (typeof userIdValue === 'string' && userIdValue.length > 0) {
        errorContext.userId = userIdValue;
      }

      await plugin.onError(context.error, errorContext);
    }
  },
};

/**
 * Dispatch a hook call to all plugins that implement it.
 * Uses a handler map instead of a switch for lower cyclomatic complexity.
 */
export async function callPluginHook(
  plugins: ReadonlyArray<TPluginWithHooks>,
  hookName: string,
  context: IPluginContext,
  logger: ILogger,
): Promise<void> {
  const handler = HOOK_HANDLERS[hookName];
  if (!handler) {
    return;
  }

  for (const plugin of plugins) {
    try {
      await handler(plugin, context);
    } catch (error) {
      logger.warn('Plugin hook failed', {
        pluginName: plugin.name,
        hookName,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
