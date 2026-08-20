import { AbstractAgent } from '../abstracts/abstract-agent';

import type {
  TModuleStats,
  TRegisterModuleOptions,
  TExecuteModuleContext,
  TExecuteModuleResult,
} from './robota-types';
import type { IModule } from '../abstracts/abstract-module';
import type {
  IPluginContract,
  IPluginHooks,
  IPluginOptions,
  IPluginStats,
} from '../abstracts/abstract-plugin';
import type { IAgentConfig, IRunOptions, TUniversalMessage } from '../interfaces/agent';

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
  /**
   * Narrowed from `AbstractAgent`'s optional `config`: a Robota agent always has one, assigned in the
   * constructor. Declared HERE so `name` below can read it without a fallback that would lie.
   */
  declare protected config: IAgentConfig;

  /**
   * The agent's identity label, read THROUGH `config` rather than copied at construction.
   *
   * ARCH-040 (issue #1820): a preset carries `agentName`, and it reached the agent only when the
   * agent was built — so starting with a preset set the name while switching to the SAME preset
   * mid-session left the old one. One preset with two answers, decided by when it was chosen.
   *
   * Reading through `config` makes `updateConfiguration({ name })` the rename, so there is one way
   * to change it and `getConfig()`, `getStats()` and `getName()` cannot disagree about what this
   * agent is called. It lives on the BASE because `config` does; the subclass keeps no copy to
   * forget to update.
   */
  get name(): string {
    return this.config.name;
  }

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
