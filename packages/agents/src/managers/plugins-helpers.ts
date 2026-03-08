/**
 * Lifecycle and dependency helpers for Plugins manager.
 *
 * Extracted from plugins.ts to keep each file under 300 lines.
 * @internal
 */
import type { AbstractPlugin } from '../abstracts/abstract-plugin';
import type { IPluginLifecycleEvents, IPluginDependency, IPluginRegistrationOptions } from './plugins';
import { PluginError, ConfigurationError } from '../utils/errors';
import type { ILogger } from '../utils/logger';

function compareSemver(a: string, b: string): number {
    const pa = a.split('.').map(Number); const pb = b.split('.').map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i++) { const na = pa[i] ?? 0; const nb = pb[i] ?? 0; if (na !== nb) return na - nb; }
    return 0;
}

/** @internal */
export async function initializePluginHelper(
    pluginName: string, plugins: Map<string, AbstractPlugin>, lifecycleEvents: IPluginLifecycleEvents, logger: ILogger
): Promise<void> {
    const plugin = plugins.get(pluginName);
    if (!plugin) throw new PluginError(`Plugin "${pluginName}" not found`, pluginName);
    const status = plugin.getStatus();
    if (status.initialized) { logger.debug(`Plugin "${pluginName}" already initialized`); return; }
    try {
        if (lifecycleEvents.beforeInitialize) await lifecycleEvents.beforeInitialize(plugin);
        const startTime = Date.now();
        await plugin.initialize();
        logger.info(`Plugin "${pluginName}" initialized successfully`, { duration: Date.now() - startTime, version: plugin.version });
        if (lifecycleEvents.afterInitialize) await lifecycleEvents.afterInitialize(plugin);
    } catch (error) {
        logger.error(`Failed to initialize plugin "${pluginName}"`, { error: error instanceof Error ? error.message : String(error) });
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (lifecycleEvents.onError) await lifecycleEvents.onError(plugin, normalized);
        throw new PluginError(`Failed to initialize plugin: ${normalized.message}`, pluginName);
    }
}

/** @internal */
export async function destroyPluginHelper(
    pluginName: string, plugins: Map<string, AbstractPlugin>, lifecycleEvents: IPluginLifecycleEvents, logger: ILogger
): Promise<void> {
    const plugin = plugins.get(pluginName);
    if (!plugin) return;
    const status = plugin.getStatus();
    if (!status.initialized) { logger.debug(`Plugin "${pluginName}" not initialized, skipping destroy`); return; }
    try {
        if (lifecycleEvents.beforeDestroy) await lifecycleEvents.beforeDestroy(plugin);
        await plugin.dispose();
        logger.info(`Plugin "${pluginName}" destroyed successfully`);
        if (lifecycleEvents.afterDestroy) await lifecycleEvents.afterDestroy(plugin);
    } catch (error) {
        logger.error(`Failed to destroy plugin "${pluginName}"`, { error: error instanceof Error ? error.message : String(error) });
        const normalized = error instanceof Error ? error : new Error(String(error));
        if (lifecycleEvents.onError) await lifecycleEvents.onError(plugin, normalized);
        throw new PluginError(`Failed to destroy plugin: ${normalized.message}`, pluginName);
    }
}

/** @internal */
export async function validateDependenciesHelper(
    dependencies: IPluginDependency[], plugins: Map<string, AbstractPlugin>
): Promise<void> {
    for (const dep of dependencies) {
        if (dep.required && !plugins.has(dep.name)) throw new ConfigurationError(`Required dependency "${dep.name}" is not registered`);
        if (dep.minVersion) {
            const depPlugin = plugins.get(dep.name);
            if (depPlugin && depPlugin.version) {
                if (compareSemver(depPlugin.version, dep.minVersion) < 0) throw new ConfigurationError(`Dependency "${dep.name}" version ${depPlugin.version} is less than required ${dep.minVersion}`);
            }
        }
    }
}

/** @internal */
export function resolveDependencyOrderHelper(
    pluginNames: string[], pluginOptions: Map<string, IPluginRegistrationOptions>
): string[] {
    const resolved: string[] = []; const visiting = new Set<string>(); const visited = new Set<string>();
    const visit = (name: string) => {
        if (visited.has(name)) return;
        if (visiting.has(name)) throw new ConfigurationError(`Circular dependency detected involving plugin "${name}"`);
        visiting.add(name);
        const opts = pluginOptions.get(name);
        if (opts?.dependencies) { for (const dep of opts.dependencies) { if (pluginNames.includes(dep.name)) visit(dep.name); } }
        visiting.delete(name); visited.add(name); resolved.push(name);
    };
    const sorted = pluginNames.sort((a, b) => { const pa = pluginOptions.get(a)?.priority || 0; const pb = pluginOptions.get(b)?.priority || 0; return pb - pa; });
    for (const name of sorted) visit(name);
    return resolved;
}
