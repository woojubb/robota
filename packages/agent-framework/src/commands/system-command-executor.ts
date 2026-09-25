import {
  modelArgumentHint,
  modelDescriptionOf,
  refuseModelSubcommand,
} from './model-subcommand-gate.js';
import { createSystemCommands } from './system-command.js';
import { DuplicateSystemCommandSemanticRoleError } from '../command-api/contracts.js';

import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type {
  ICommandHostContext,
  ICommandResult,
  ISystemCommand,
  ISystemCommandSemanticRoles,
} from '../command-api/index.js';

interface ICommandState {
  commands: Map<string, ISystemCommand>;
  semanticRoles: ISystemCommandSemanticRoles;
}

function buildCommandState(commands: readonly ISystemCommand[]): ICommandState {
  const commandMap = new Map<string, ISystemCommand>();
  for (const command of commands) commandMap.set(command.name, command);
  const semanticRoles: Record<string, string> = {};
  for (const command of commandMap.values()) {
    if (!command.semanticRole) continue;
    const existing = semanticRoles[command.semanticRole];
    if (existing !== undefined && existing !== command.name) {
      throw new DuplicateSystemCommandSemanticRoleError(
        command.semanticRole,
        existing,
        command.name,
      );
    }
    semanticRoles[command.semanticRole] = command.name;
  }
  return { commands: commandMap, semanticRoles };
}

/** Registry for system commands. */
export class SystemCommandExecutor {
  private commands: Map<string, ISystemCommand>;
  private semanticRoles: ISystemCommandSemanticRoles;

  constructor(commands?: ISystemCommand[]) {
    const state = buildCommandState(commands ?? createSystemCommands());
    this.commands = state.commands;
    this.semanticRoles = state.semanticRoles;
  }

  /** Register an additional command. */
  register(command: ISystemCommand): void {
    const state = buildCommandState([...this.commands.values(), command]);
    this.commands = state.commands;
    this.semanticRoles = state.semanticRoles;
  }

  /** Replace the entire command set (used by live preset command-module re-selection — PRESET-015). */
  replaceCommands(commands: readonly ISystemCommand[]): void {
    const state = buildCommandState(commands);
    this.commands = state.commands;
    this.semanticRoles = state.semanticRoles;
  }

  getSemanticRoles(): ISystemCommandSemanticRoles {
    return { ...this.semanticRoles };
  }

  /** Execute a command by name. Returns null if command not found. */
  async execute(
    name: string,
    session: ICommandHostContext,
    args: string,
  ): Promise<ICommandResult | null> {
    const cmd = this.getCommand(name);
    if (!cmd) return null;
    return await this.executeCommand(cmd, session, args);
  }

  getCommand(name: string): ISystemCommand | undefined {
    return this.commands.get(name);
  }

  /** Resolve whether a command requires permission confirmation. */
  resolveRequiresPermission(command: ISystemCommand): boolean {
    if (command.requiresPermission !== undefined) return command.requiresPermission;
    return command.safety !== 'read-only';
  }

  async executeCommand(
    command: ISystemCommand,
    session: ICommandHostContext,
    args: string,
  ): Promise<ICommandResult> {
    return await command.execute(session, args);
  }

  /** List all registered commands. */
  listCommands(): ISystemCommand[] {
    return [...this.commands.values()];
  }

  /**
   * The model-facing view: only commands declared model-invocable, each described by its
   * model-facing text and offering only the subcommands the model may run.
   */
  listModelInvocableCommands(): ICapabilityDescriptor[] {
    return this.listCommands()
      .filter((command) => command.modelInvocable === true)
      .map((command) => {
        const argumentHint = modelArgumentHint(command);
        return {
          name: command.name,
          kind: 'builtin-command',
          description: modelDescriptionOf(command),
          userInvocable: command.userInvocable !== false,
          modelInvocable: true,
          ...(argumentHint ? { argumentHint } : {}),
          ...(command.safety ? { safety: command.safety } : {}),
          requiresPermission:
            command.modelRequiresPermission ?? this.resolveRequiresPermission(command),
        };
      });
  }

  isModelInvocable(name: string): boolean {
    return this.commands.get(name)?.modelInvocable === true;
  }

  /** Runs a command for the model: refused unless model-invocable, and held to its subcommand gate. */
  async executeModelInvocable(
    name: string,
    session: ICommandHostContext,
    args: string,
  ): Promise<ICommandResult | null> {
    const command = this.commands.get(name);
    if (command?.modelInvocable !== true) return null;
    const refusal = refuseModelSubcommand(command, args);
    if (refusal !== undefined) return refusal;
    return this.executeCommand(command, session, args);
  }

  /** Check if a command exists. */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }
}
