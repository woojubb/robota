import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';
import {
  createDefaultBackgroundTaskRunners,
  type IBackgroundTaskRunner,
} from '@robota-sdk/agent-executor';
import type { ICommandHostAdapters, ICommandModule } from '../commands/index.js';
import type { CommandRegistry } from '../commands/index.js';
import type { IInteractiveSession, IInteractiveSessionStore } from '../interactive/index.js';
import { createProjectSessionStore } from '../interactive/session-persistence.js';
import { getUserSettingsPath, readSettings, writeSettings } from '../config/settings-io.js';
import type { TSubagentRunnerFactory } from '../subagents/index.js';

export interface IAgentRuntimeConfig {
  cwd: string;
  provider: IAIProvider;
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  sessionStore?: IInteractiveSessionStore;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
}

export interface IAgentRuntime {
  readonly cwd: string;
  readonly provider: IAIProvider;
  readonly commandModules: readonly ICommandModule[];
  readonly commandHostAdapters: ICommandHostAdapters;
  readonly backgroundTaskRunners: IBackgroundTaskRunner[];
  readonly subagentRunnerFactory: TSubagentRunnerFactory | undefined;
  readonly sessionStore: IInteractiveSessionStore | undefined;
  readonly transportRegistry: ITransportRegistryView<IInteractiveSession> | undefined;
  readonly reloadPluginCommandSource: (registry: CommandRegistry) => void;
}

export function createAgentRuntime(config: IAgentRuntimeConfig): IAgentRuntime {
  const settingsPath = getUserSettingsPath();
  const defaultCommandHostAdapters: ICommandHostAdapters = {
    settings: {
      read: () => readSettings(settingsPath),
      write: (settings) => writeSettings(settingsPath, settings),
    },
  };

  return {
    cwd: config.cwd,
    provider: config.provider,
    commandModules: config.commandModules ?? [],
    commandHostAdapters: config.commandHostAdapters ?? defaultCommandHostAdapters,
    backgroundTaskRunners: config.backgroundTaskRunners ?? createDefaultBackgroundTaskRunners(),
    subagentRunnerFactory: config.subagentRunnerFactory,
    sessionStore:
      'sessionStore' in config ? config.sessionStore : createProjectSessionStore(config.cwd),
    transportRegistry: config.transportRegistry,
    reloadPluginCommandSource: config.reloadPluginCommandSource ?? (() => {}),
  };
}
