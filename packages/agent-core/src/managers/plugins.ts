/**
 * Plugin Manager - manages plugin lifecycle and dependencies.
 *
 * Lifecycle and dependency helpers live in ./plugins-helpers.ts.
 * @internal
 */
import { AbstractManager } from '../abstracts/abstract-manager';
import { AbstractPlugin } from '../abstracts/abstract-plugin';
import { createLogger, type ILogger } from '../utils/logger';
import { PluginError } from '../utils/errors';
import {
  initializePluginHelper,
  destroyPluginHelper,
  validateDependenciesHelper,
  resolveDependencyOrderHelper,
} from './plugins-helpers';

/** Plugin lifecycle events */
export interface IPluginLifecycleEvents {
  beforeInitialize?: (plugin: AbstractPlugin) => Promise<void> | void;
  afterInitialize?: (plugin: AbstractPlugin) => Promise<void> | void;
  beforeDestroy?: (plugin: AbstractPlugin) => Promise<void> | void;
  afterDestroy?: (plugin: AbstractPlugin) => Promise<void> | void;
  onError?: (plugin: AbstractPlugin, error: Error) => Promise<void> | void;
}

/** Plugin dependency definition */
export interface IPluginDependency {
  name: string;
  required: boolean;
  minVersion?: string;
}

/** Plugin registration options */
export interface IPluginRegistrationOptions {
  dependencies?: IPluginDependency[];
  priority?: number;
  autoInitialize?: boolean;
}

/** Plugin status information */
export interface IPluginStatus {
  name: string;
  version?: string;
  enabled: boolean;
  initialized: boolean;
  dependencies: string[];
  priority: number;
}

/** Plugins manager interface */
export interface IPluginsManager {
  register(plugin: AbstractPlugin, options?: IPluginRegistrationOptions): Promise<void>;
  unregister(pluginName: string): Promise<boolean>;
  initializeAll(): Promise<void>;
  destroyAll(): Promise<void>;
  getPlugin<T extends AbstractPlugin = AbstractPlugin>(name: string): T | undefined;
  getPlugins(): AbstractPlugin[];
  getPluginNames(): string[];
  hasPlugin(name: string): boolean;
  getPluginStatus(name: string): IPluginStatus | undefined;
  getAllPluginStatuses(): IPluginStatus[];
}

/** @internal */
export class Plugins extends AbstractManager implements IPluginsManager {
  private plugins = new Map<string, AbstractPlugin>();
  private pluginOptions = new Map<string, IPluginRegistrationOptions>();
  private initializationOrder: string[] = [];
  private lifecycleEvents: IPluginLifecycleEvents;
  private logger: ILogger;

  constructor(lifecycleEvents: IPluginLifecycleEvents = {}) {
    super();
    this.lifecycleEvents = lifecycleEvents;
    this.logger = createLogger('Plugins');
  }

  protected async doInitialize(): Promise<void> {
    this.logger.debug('Plugins manager initializing');
  }
  protected async doDispose(): Promise<void> {
    this.logger.debug('Plugins manager disposing');
    await this.destroyAll();
    this.plugins.clear();
    this.pluginOptions.clear();
    this.initializationOrder = [];
  }

  override async initialize(): Promise<void> {
    if (this.initialized) return;
    this.logger.debug('Initializing Plugins manager');
    this.initialized = true;
    this.logger.debug('Plugins manager initialized');
  }

  async register(plugin: AbstractPlugin, options: IPluginRegistrationOptions = {}): Promise<void> {
    const pluginName = plugin.name;
    if (this.plugins.has(pluginName)) {
      this.logger.warn(`Plugin "${pluginName}" is already registered, overriding`, {
        pluginName,
        existingVersion: this.plugins.get(pluginName)?.version,
        newVersion: plugin.version,
      });
      await this.unregister(pluginName);
    }
    if (options.dependencies) await validateDependenciesHelper(options.dependencies, this.plugins);
    this.plugins.set(pluginName, plugin);
    this.pluginOptions.set(pluginName, {
      dependencies: options.dependencies || [],
      priority: options.priority || 0,
      autoInitialize: options.autoInitialize ?? true,
    });
    this.logger.info(`Plugin "${pluginName}" registered`, {
      version: plugin.version,
      priority: options.priority || 0,
      dependencies: options.dependencies?.length || 0,
      autoInitialize: options.autoInitialize ?? true,
    });
    if (options.autoInitialize !== false)
      await initializePluginHelper(pluginName, this.plugins, this.lifecycleEvents, this.logger);
  }

  async unregister(pluginName: string): Promise<boolean> {
    const plugin = this.plugins.get(pluginName);
    if (!plugin) {
      this.logger.warn(`Attempted to unregister non-existent plugin "${pluginName}"`);
      return false;
    }
    try {
      const status = plugin.getStatus();
      if (status.initialized)
        await destroyPluginHelper(pluginName, this.plugins, this.lifecycleEvents, this.logger);
      this.plugins.delete(pluginName);
      this.pluginOptions.delete(pluginName);
      this.initializationOrder = this.initializationOrder.filter((n) => n !== pluginName);
      this.logger.info(`Plugin "${pluginName}" unregistered successfully`);
      return true;
    } catch (error) {
      this.logger.error(`Failed to unregister plugin "${pluginName}"`, {
        error: error instanceof Error ? error.message : String(error),
      });
      throw new PluginError(
        `Failed to unregister plugin: ${error instanceof Error ? error.message : String(error)}`,
        pluginName,
      );
    }
  }

  async initializeAll(): Promise<void> {
    const pluginNames = Array.from(this.plugins.keys());
    this.initializationOrder = resolveDependencyOrderHelper(pluginNames, this.pluginOptions);
    this.logger.debug('Initializing all plugins', {
      totalPlugins: pluginNames.length,
      initializationOrder: this.initializationOrder,
    });
    for (const name of this.initializationOrder)
      await initializePluginHelper(name, this.plugins, this.lifecycleEvents, this.logger);
    this.logger.info('All plugins initialized successfully', {
      totalPlugins: this.initializationOrder.length,
    });
  }

  async destroyAll(): Promise<void> {
    const destroyOrder = [...this.initializationOrder].reverse();
    this.logger.debug('Destroying all plugins', {
      totalPlugins: destroyOrder.length,
      destroyOrder,
    });
    for (const name of destroyOrder)
      await destroyPluginHelper(name, this.plugins, this.lifecycleEvents, this.logger);
    this.initializationOrder = [];
    this.logger.info('All plugins destroyed successfully');
  }

  getPlugin<T extends AbstractPlugin = AbstractPlugin>(name: string): T | undefined {
    const p = this.plugins.get(name);
    return p ? (p as T) : undefined;
  }
  getPlugins(): AbstractPlugin[] {
    return Array.from(this.plugins.values());
  }
  getPluginNames(): string[] {
    return Array.from(this.plugins.keys());
  }
  hasPlugin(name: string): boolean {
    return this.plugins.has(name);
  }

  getPluginStatus(name: string): IPluginStatus | undefined {
    const plugin = this.plugins.get(name);
    const options = this.pluginOptions.get(name);
    if (!plugin || !options) return undefined;
    const status = plugin.getStatus();
    return {
      name: status.name,
      version: status.version,
      enabled: status.enabled,
      initialized: status.initialized,
      dependencies: options.dependencies?.map((d) => d.name) || [],
      priority: options.priority || 0,
    };
  }

  getAllPluginStatuses(): IPluginStatus[] {
    return Array.from(this.plugins.keys())
      .map((n) => this.getPluginStatus(n))
      .filter((s): s is IPluginStatus => s !== undefined);
  }
}
