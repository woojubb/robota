import {
  createDefaultBackgroundTaskRunners,
  type IBackgroundTaskRunner,
} from '@robota-sdk/agent-executor';

import { getUserSettingsPath, readSettings, writeSettings } from '../config/settings-io.js';
import { InteractiveSession } from '../interactive/interactive-session.js';
import { createProjectSessionStore } from '../interactive/session-persistence.js';

import type { IOrgPolicy } from '../command-api/org-policy/org-policy-types.js';
import type { ICommandHostAdapters, ICommandModule } from '../commands/index.js';
import type { CommandRegistry } from '../commands/index.js';
import type { IInteractiveSession, IInteractiveSessionStore } from '../interactive/index.js';
import type { TSubagentRunnerFactory } from '../subagents/index.js';
import type { TShellExecFn } from '../utils/skill-prompt.js';
import type { IAIProvider, TPermissionMode } from '@robota-sdk/agent-core';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

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
  orgPolicy?: IOrgPolicy;
}

/** Session-specific options for IAgentRuntime.createSession(). Runtime fields (cwd, provider, etc.) are inherited automatically. */
export interface IHeadlessSessionOptions {
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  sessionName?: string;
  bare?: boolean;
  allowedTools?: string[];
  /** Denied tool names — added to permissions.deny. denied > allowed. */
  deniedTools?: string[];
  /** Override the model from config. When set, takes precedence over config.provider.model. */
  model?: string;
  appendSystemPrompt?: string;
  /** Replace the entire system prompt. Takes precedence over the default builder. */
  systemPrompt?: string;
  shellExec?: TShellExecFn;
  agentName?: string;
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
  createSession(opts: IHeadlessSessionOptions): InteractiveSession;
}

export function createAgentRuntime(config: IAgentRuntimeConfig): IAgentRuntime {
  const settingsPath = getUserSettingsPath();
  const defaultCommandHostAdapters: ICommandHostAdapters = {
    settings: {
      read: () => readSettings(settingsPath),
      write: (settings) => writeSettings(settingsPath, settings),
    },
  };

  const backgroundTaskRunners =
    config.backgroundTaskRunners ?? createDefaultBackgroundTaskRunners();
  const commandModules = config.commandModules ?? [];
  const commandHostAdapters = config.commandHostAdapters ?? defaultCommandHostAdapters;
  const sessionStore =
    'sessionStore' in config ? config.sessionStore : createProjectSessionStore(config.cwd);

  return {
    cwd: config.cwd,
    provider: config.provider,
    commandModules,
    commandHostAdapters,
    backgroundTaskRunners,
    subagentRunnerFactory: config.subagentRunnerFactory,
    sessionStore,
    transportRegistry: config.transportRegistry,
    reloadPluginCommandSource: config.reloadPluginCommandSource ?? (() => {}),
    createSession(opts: IHeadlessSessionOptions): InteractiveSession {
      return new InteractiveSession({
        cwd: config.cwd,
        provider: config.provider,
        backgroundTaskRunners,
        subagentRunnerFactory: config.subagentRunnerFactory,
        commandModules,
        commandHostAdapters,
        permissionMode: opts.permissionMode,
        maxTurns: opts.maxTurns,
        sessionStore: opts.sessionStore,
        sessionName: opts.sessionName,
        bare: opts.bare,
        allowedTools: opts.allowedTools,
        deniedTools: opts.deniedTools,
        model: opts.model,
        appendSystemPrompt: opts.appendSystemPrompt,
        systemPrompt: opts.systemPrompt,
        shellExec: opts.shellExec,
        agentName: opts.agentName,
        orgPolicy: config.orgPolicy,
      });
    },
  };
}
