/**
 * Plugin management delegate for the Robota agent.
 *
 * Extracted from robota.ts to keep the main class under 300 lines.
 * All public method signatures are preserved via delegation.
 */
import type { IPluginContract, IPluginHooks, IPluginOptions, IPluginStats } from '../abstracts/abstract-plugin';
import type { ExecutionService } from '../services/execution-service';
import type { ILogger } from '../utils/logger';
import { ConfigurationError } from '../utils/errors';

/**
 * Manages plugin lifecycle on behalf of a Robota instance.
 * @internal
 */
export class RobotaPluginManager {
    constructor(
        private readonly logger: ILogger,
        private readonly isReady: () => boolean,
        private readonly getExecutionService: () => ExecutionService | undefined
    ) {}

    /**
     * Add a plugin to the agent at runtime.
     */
    addPlugin(plugin: IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks): void {
        const executionService = this.getExecutionService();
        if (!this.isReady() || !executionService) {
            throw new ConfigurationError(
                'Cannot add plugin before agent is fully initialized. Await an operation like run() first, or pass plugins via the constructor config.',
                { pluginName: plugin.name }
            );
        }
        executionService.registerPlugin(plugin);
        this.logger.debug('Plugin added', { pluginName: plugin.name });
    }

    /**
     * Remove a plugin from the agent by name.
     */
    removePlugin(pluginName: string): boolean {
        const executionService = this.getExecutionService();
        if (!executionService) {
            return false;
        }
        const removed = executionService.removePlugin(pluginName);
        if (removed) {
            this.logger.debug('Plugin removed', { pluginName });
        }
        return removed;
    }

    /**
     * Get a specific plugin by name.
     */
    getPlugin(pluginName: string): (IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks) | undefined {
        const executionService = this.getExecutionService();
        if (!executionService) {
            return undefined;
        }
        return executionService.getPlugin(pluginName);
    }

    /**
     * Get all registered plugins.
     */
    getPlugins(): Array<IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks> {
        const executionService = this.getExecutionService();
        if (!executionService) {
            return [];
        }
        return executionService.getPlugins();
    }

    /**
     * Get all registered plugin names.
     */
    getPluginNames(): string[] {
        const executionService = this.getExecutionService();
        if (!this.isReady() || !executionService) {
            return [];
        }
        return executionService.getPlugins().map(plugin => plugin.name);
    }
}
