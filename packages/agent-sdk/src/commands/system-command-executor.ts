import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { InteractiveSession } from '../interactive/interactive-session.js';
import type { ICommandResult, ISystemCommand } from './system-command.js';
import { createSystemCommands } from './system-command.js';

/** Registry for system commands. */
export class SystemCommandExecutor {
  private readonly commands: Map<string, ISystemCommand>;

  constructor(commands?: ISystemCommand[]) {
    this.commands = new Map();
    for (const cmd of commands ?? createSystemCommands()) {
      this.commands.set(cmd.name, cmd);
    }
  }

  /** Register an additional command. */
  register(command: ISystemCommand): void {
    this.commands.set(command.name, command);
  }

  /** Execute a command by name. Returns null if command not found. */
  async execute(
    name: string,
    session: InteractiveSession,
    args: string,
  ): Promise<ICommandResult | null> {
    const cmd = this.getCommand(name);
    if (!cmd) return null;
    return await this.executeCommand(cmd, session, args);
  }

  getCommand(name: string): ISystemCommand | undefined {
    return this.commands.get(name);
  }

  async executeCommand(
    command: ISystemCommand,
    session: InteractiveSession,
    args: string,
  ): Promise<ICommandResult> {
    return await command.execute(session, args);
  }

  /** List all registered commands. */
  listCommands(): ISystemCommand[] {
    return [...this.commands.values()];
  }

  listModelInvocableCommands(): ICapabilityDescriptor[] {
    return this.listCommands()
      .filter((command) => command.modelInvocable === true)
      .map((command) => ({
        name: `/${command.name}`,
        kind: 'builtin-command',
        description: command.description,
        userInvocable: command.userInvocable !== false,
        modelInvocable: true,
        ...(command.argumentHint ? { argumentHint: command.argumentHint } : {}),
        ...(command.safety ? { safety: command.safety } : {}),
      }));
  }

  isModelInvocable(name: string): boolean {
    return this.commands.get(name)?.modelInvocable === true;
  }

  async executeModelInvocable(
    name: string,
    session: InteractiveSession,
    args: string,
  ): Promise<ICommandResult | null> {
    if (!this.isModelInvocable(name)) return null;
    return this.execute(name, session, args);
  }

  /** Check if a command exists. */
  hasCommand(name: string): boolean {
    return this.commands.has(name);
  }
}
