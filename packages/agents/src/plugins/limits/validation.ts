/**
 * Validation logic for LimitsPlugin options.
 *
 * Extracted from limits-plugin.ts to keep each file under 300 lines.
 * @internal
 */
import { PluginError } from '../../utils/errors';
import type { ILimitsPluginOptions } from './types';
import type { ILogger } from '../../utils/logger';

/** Validate LimitsPlugin options. @internal */
export function validateLimitsOptions(options: ILimitsPluginOptions, pluginName: string, logger: ILogger): void {
    if (options.strategy === 'none') {
        logger.info('LimitsPlugin configured with "none" strategy - no rate limiting will be applied');
        return;
    }

    if (!options.strategy) {
        throw new PluginError(
            'Strategy must be specified for limits plugin. Use "none" to disable rate limiting, or choose from: token-bucket, sliding-window, fixed-window',
            pluginName, { availableStrategies: ['none', 'token-bucket', 'sliding-window', 'fixed-window'] }
        );
    }

    const validStrategies = ['none', 'token-bucket', 'sliding-window', 'fixed-window'];
    if (!validStrategies.includes(options.strategy)) {
        throw new PluginError(`Invalid strategy "${options.strategy}". Must be one of: ${validStrategies.join(', ')}`, pluginName, { provided: options.strategy, validStrategies });
    }

    if (options.strategy === 'token-bucket') {
        if (options.bucketSize !== undefined && options.bucketSize <= 0) throw new PluginError('Bucket size must be positive for token-bucket strategy', pluginName, { strategy: options.strategy, bucketSize: options.bucketSize });
        if (options.refillRate !== undefined && options.refillRate < 0) throw new PluginError('Refill rate must be non-negative for token-bucket strategy', pluginName, { strategy: options.strategy, refillRate: options.refillRate });
    }

    if (['sliding-window', 'fixed-window'].includes(options.strategy)) {
        if (options.timeWindow !== undefined && options.timeWindow <= 0) throw new PluginError(`Time window must be positive for ${options.strategy} strategy`, pluginName, { strategy: options.strategy, timeWindow: options.timeWindow });
    }

    if (options.maxRequests !== undefined && options.maxRequests < 0) throw new PluginError('Max requests must be non-negative', pluginName, { strategy: options.strategy, maxRequests: options.maxRequests });
    if (options.maxTokens !== undefined && options.maxTokens < 0) throw new PluginError('Max tokens must be non-negative', pluginName, { strategy: options.strategy, maxTokens: options.maxTokens });
    if (options.maxCost !== undefined && options.maxCost < 0) throw new PluginError('Max cost must be non-negative', pluginName, { strategy: options.strategy, maxCost: options.maxCost });
    if (options.tokenCostPer1000 !== undefined && options.tokenCostPer1000 < 0) throw new PluginError('Token cost per 1000 must be non-negative', pluginName, { strategy: options.strategy, tokenCostPer1000: options.tokenCostPer1000 });
}
