import { InteractiveSession, CommandRegistry } from '@robota-sdk/agent-sdk';
import type { TToolArgs } from '@robota-sdk/agent-core';
import type { TPermissionResultValue } from '@robota-sdk/agent-sdk';
import { TuiStateManager } from '../tui-state-manager.js';
import { CommandEffectQueue, type ICommandEffectQueue } from './command-effect-queue.js';
import type { IInteractiveSessionProps } from './useInteractiveSession.js';

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
