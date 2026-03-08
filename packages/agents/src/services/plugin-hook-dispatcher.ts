import type { IPluginContext } from '../interfaces/types';
import type {
    IPluginContract,
    IPluginHooks,
    IPluginOptions,
    IPluginStats,
    IPluginErrorContext,
} from '../abstracts/abstract-plugin';
import type { ILogger } from '../utils/logger';
import { EXECUTION_EVENT_PREFIX, EXECUTION_EVENTS } from './execution-constants';

/** Combined plugin type used throughout the execution service */
export type TPluginWithHooks = IPluginContract<IPluginOptions, IPluginStats> &
    IPluginHooks;

/** Handler for a single plugin hook invocation */
type TPluginHookHandler = (
    plugin: TPluginWithHooks,
    context: IPluginContext
) => Promise<void>;

/** Map from hook name to its handler function */
const HOOK_HANDLERS: Record<string, TPluginHookHandler> = {
    beforeRun: async (plugin, context) => {
        if (plugin.beforeRun && context.input) {
            await plugin.beforeRun(context.input, context.metadata);
        }
    },
    afterRun: async (plugin, context) => {
        if (plugin.afterRun && context.input && context.response) {
            await plugin.afterRun(
                context.input,
                context.response,
                context.metadata
            );
        }
    },
    beforeProviderCall: async (plugin, context) => {
        if (plugin.beforeProviderCall && context.messages) {
            await plugin.beforeProviderCall(context.messages);
        }
    },
    afterProviderCall: async (plugin, context) => {
        if (plugin.afterProviderCall && context.messages && context.responseMessage) {
            await plugin.afterProviderCall(
                context.messages,
                context.responseMessage
            );
        }
    },
    onError: async (plugin, context) => {
        if (plugin.onError && context.error) {
            const errorContext: IPluginErrorContext = {
                action: `${EXECUTION_EVENT_PREFIX}.${EXECUTION_EVENTS.ERROR}`,
                metadata: {},
            };

            const executionIdValue =
                context.executionContext?.['executionId'];
            if (
                typeof executionIdValue === 'string' &&
                executionIdValue.length > 0
            ) {
                errorContext.executionId = executionIdValue;
            }
            const sessionIdValue =
                context.executionContext?.['sessionId'];
            if (
                typeof sessionIdValue === 'string' &&
                sessionIdValue.length > 0
            ) {
                errorContext.sessionId = sessionIdValue;
            }
            const userIdValue = context.executionContext?.['userId'];
            if (
                typeof userIdValue === 'string' &&
                userIdValue.length > 0
            ) {
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
    logger: ILogger
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
                error:
                    error instanceof Error
                        ? error.message
                        : String(error),
            });
        }
    }
}
