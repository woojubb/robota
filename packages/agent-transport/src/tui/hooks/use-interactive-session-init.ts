import { InteractiveSession, CommandRegistry } from '@robota-sdk/agent-framework';

import { TuiStateManager } from '../tui-state-manager.js';
import { CommandEffectQueue, type ICommandEffectQueue } from './command-effect-queue.js';

import type { IAIProvider, TPermissionMode } from '@robota-sdk/agent-core';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  IInteractiveSession,
  IInteractiveSessionStore,
  TSubagentRunnerFactory,
  TShellExecFn,
  TPermissionResultValue,
} from '@robota-sdk/agent-framework';
import type { ITransportRegistryView } from '@robota-sdk/agent-interface-transport';

export interface IInteractiveSessionProps {
  cwd: string;
  provider: IAIProvider;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  resumeSessionId?: string;
  forkSession?: boolean;
  sessionName?: string;
  onAutoNamed?: (name: string) => void;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
  transportRegistry?: ITransportRegistryView<IInteractiveSession>;
  language?: string;
  reloadPluginCommandSource?: (registry: CommandRegistry) => void;
  agentName?: string;
  systemPrompt?: string;
  appendSystemPrompt?: string;
  allowedTools?: string[];
  deniedTools?: string[];
}

export interface IInitState {
  interactiveSession: InteractiveSession;
  registry: CommandRegistry;
  commandEffectQueue: ICommandEffectQueue;
  manager: TuiStateManager;
}

export function initializeSession(
  props: IInteractiveSessionProps,
  permissionHandler: (toolName: string, toolArgs: TToolArgs) => Promise<TPermissionResultValue>,
): IInitState {
  const interactiveSession = new InteractiveSession({
    cwd: props.cwd,
    provider: props.provider,
    permissionMode: props.permissionMode,
    maxTurns: props.maxTurns,
    permissionHandler,
    sessionStore: props.sessionStore,
    resumeSessionId: props.resumeSessionId,
    forkSession: props.forkSession,
    sessionName: props.sessionName,
    backgroundTaskRunners: props.backgroundTaskRunners,
    subagentRunnerFactory: props.subagentRunnerFactory,
    commandModules: props.commandModules,
    commandHostAdapters: props.commandHostAdapters,
    shellExec: props.shellExec,
    language: props.language,
    agentName: props.agentName,
    systemPrompt: props.systemPrompt,
    appendSystemPrompt: props.appendSystemPrompt,
    allowedTools: props.allowedTools,
    deniedTools: props.deniedTools,
  });

  const registry = new CommandRegistry();
  for (const module of props.commandModules ?? []) {
    registry.addModule(module);
  }
  props.reloadPluginCommandSource?.(registry);

  return {
    interactiveSession,
    registry,
    manager: new TuiStateManager(),
    commandEffectQueue: new CommandEffectQueue(),
  };
}
