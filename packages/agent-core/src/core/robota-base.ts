import type { IAgentConfig, IRunOptions, TUniversalMessage } from '../interfaces/agent';
import type {
  IPluginContract,
  IPluginHooks,
  IPluginOptions,
  IPluginStats,
} from '../abstracts/abstract-plugin';
import type { IModule } from '../abstracts/abstract-module';
import { AbstractAgent } from '../abstracts/abstract-agent';
import type {
  TModuleStats,
  TRegisterModuleOptions,
  TExecuteModuleContext,
  TExecuteModuleResult,
} from './robota-types';

export type TPlugin = IPluginContract<IPluginOptions, IPluginStats> & IPluginHooks;

interface IModuleManagerProxy {
  registerModule(module: IModule, options?: TRegisterModuleOptions): Promise<void>;
  unregisterModule(moduleName: string): Promise<boolean>;
  getModule(moduleName: string): IModule | undefined;
  getModulesByType(moduleType: string): IModule[];
  getModules(): IModule[];
  getModuleNames(): string[];
  hasModule(moduleName: string): boolean;
  executeModule(moduleName: string, context: TExecuteModuleContext): Promise<TExecuteModuleResult>;
  getModuleStats(moduleName: string): TModuleStats;
}

interface IPluginManagerProxy {
  addPlugin(plugin: TPlugin): void;
  removePlugin(pluginName: string): boolean;
  getPlugin(pluginName: string): TPlugin | undefined;
  getPlugins(): TPlugin[];
  getPluginNames(): string[];
}

export abstract class RobotaBase extends AbstractAgent<
  IAgentConfig,
  IRunOptions,
  TUniversalMessage
> {
  protected moduleManager!: IModuleManagerProxy;
  protected pluginManager!: IPluginManagerProxy;

  addPlugin(plugin: TPlugin): void {
    this.pluginManager.addPlugin(plugin);
  }
  removePlugin(pluginName: string): boolean {
    return this.pluginManager.removePlugin(pluginName);
  }
  getPlugin(pluginName: string): TPlugin | undefined {
    return this.pluginManager.getPlugin(pluginName);
  }
  getPlugins(): TPlugin[] {
    return this.pluginManager.getPlugins();
  }
  getPluginNames(): string[] {
    return this.pluginManager.getPluginNames();
  }

  async registerModule(module: IModule, options?: TRegisterModuleOptions): Promise<void> {
    return this.moduleManager.registerModule(module, options);
  }
  async unregisterModule(moduleName: string): Promise<boolean> {
    return this.moduleManager.unregisterModule(moduleName);
  }
  getModule(moduleName: string): IModule | undefined {
    return this.moduleManager.getModule(moduleName);
  }
  getModulesByType(moduleType: string): IModule[] {
    return this.moduleManager.getModulesByType(moduleType);
  }
  getModules(): IModule[] {
    return this.moduleManager.getModules();
  }
  getModuleNames(): string[] {
    return this.moduleManager.getModuleNames();
  }
  hasModule(moduleName: string): boolean {
    return this.moduleManager.hasModule(moduleName);
  }
  async executeModule(
    moduleName: string,
    context: TExecuteModuleContext,
  ): Promise<TExecuteModuleResult> {
    return this.moduleManager.executeModule(moduleName, context);
  }
  getModuleStats(moduleName: string): TModuleStats {
    return this.moduleManager.getModuleStats(moduleName);
  }
}
