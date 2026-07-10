/**
 * SessionSkillRouter — manages command execution and skill routing
 * for an InteractiveSession. Handles SystemCommandExecutor, SkillCommandSource,
 * and all command/skill invocation logic.
 */

import {
  executeSkill,
  findUnknownModuleNames,
  selectCommandModules,
  SkillCommandSource,
  SystemCommandExecutor,
} from '../commands/index.js';
import { createSkillActivationEvent } from '../commands/skill-activation-events.js';

import type { ICommandHostContext } from '../command-api/index.js';
import type {
  ICommand,
  ICommandHostAdapters,
  ICommandModule,
  ICommandResult,
  ICommandSkillListEntry,
  ISkillExecutionResult,
  IForkExecutionOptions,
  ICommandSkillActivationRequest,
  IUnknownCommandModuleName,
  TCommandInvocationSource,
  ISystemCommand,
  IRemoteCommandPolicy,
} from '../commands/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { TShellExecFn } from '../utils/skill-prompt.js';

function normalizeSkillName(name: string): string {
  return name.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function normalizeCommandName(name: string): string {
  return name.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function formatSkillCommandArgs(skillName: string, args: string): string {
  const trimmedArgs = args.trim();
  return trimmedArgs.length > 0 ? `${skillName} ${trimmedArgs}` : skillName;
}

function getQualifiedSkillName(rawInput?: string): string | undefined {
  if (!rawInput?.startsWith('/')) return undefined;
  const firstToken = rawInput.slice(1).trim().split(/\s+/)[0];
  return firstToken && firstToken.length > 0 ? firstToken : undefined;
}

export class SessionSkillRouter {
  readonly commandExecutor: SystemCommandExecutor;
  /** Command modules received at construction — retained for live re-selection (PRESET-015). */
  private readonly allCommandModules: readonly ICommandModule[];
  private readonly skillCommandSource: SkillCommandSource;
  private readonly commandHostAdapters?: ICommandHostAdapters;
  private commandInvocationSource: TCommandInvocationSource = 'user';

  constructor(
    commandModules: readonly ICommandModule[],
    cwd: string,
    commandHostAdapters: ICommandHostAdapters | undefined,
    private readonly getSession: () => ICommandHostContext,
    private readonly getSessionId: () => string,
    private readonly onSubmit: (
      prompt: string,
      displayInput?: string,
      rawInput?: string,
    ) => Promise<void>,
    private readonly onApplyResult: (result: string) => Promise<void>,
    private readonly recordSkillActivation: (
      event: ISkillActivationEvent,
      appendHistory: boolean,
    ) => void,
    private readonly runSkillInFork: (
      content: string,
      options: IForkExecutionOptions,
    ) => Promise<string>,
    /** Called when a fork-context skill needs full lifecycle management (executing flag etc.) */
    private readonly onForkSkill: (
      skill: ICommand,
      args: string,
      displayInput: string | undefined,
      qualifiedName: string | undefined,
      invocation: ISkillActivationEvent['invocation'],
    ) => Promise<ISkillExecutionResult>,
    /** Called for blocking commands — wraps execution with thinking/executing lifecycle */
    private readonly onBlockingCommand: (
      execute: () => Promise<ICommandResult>,
    ) => Promise<ICommandResult>,
    private readonly shellExec?: TShellExecFn,
    /** Deny-by-default policy for remote-origin (`source==='remote'`) commands (REMOTE-003). Undefined → only read-only remote commands are allowed. */
    private readonly remoteCommandPolicy?: IRemoteCommandPolicy,
  ) {
    this.allCommandModules = commandModules;
    this.commandExecutor = new SystemCommandExecutor(
      commandModules.flatMap((module) => module.systemCommands ?? []),
    );
    this.skillCommandSource = new SkillCommandSource(cwd);
    this.commandHostAdapters = commandHostAdapters;
  }

  /**
   * PRESET-015 — re-filter the session's command modules and rebuild the executor live. INFRA-032:
   * also returns any `enabled`/`disabled` names that matched no live command module, so the
   * `/preset` command can surface them as a non-fatal notice instead of dropping them silently.
   */
  reapplyCommandModuleSelection(
    enabled: readonly string[] | undefined,
    disabled: readonly string[] | undefined,
  ): readonly IUnknownCommandModuleName[] {
    const selected = selectCommandModules(this.allCommandModules, enabled, disabled);
    this.commandExecutor.replaceCommands(selected.flatMap((module) => module.systemCommands ?? []));
    return findUnknownModuleNames(
      this.allCommandModules.map((module) => module.name),
      enabled,
      disabled,
    );
  }

  getCommandInvocationSource(): TCommandInvocationSource {
    return this.commandInvocationSource;
  }

  getCommandHostAdapters(): ICommandHostAdapters {
    return this.commandHostAdapters ?? {};
  }

  listCommands(): Array<{
    name: string;
    displayName?: string;
    description: string;
    example?: string;
  }> {
    return this.commandExecutor.listCommands().map((cmd) => ({
      name: cmd.name,
      ...(cmd.displayName !== undefined ? { displayName: cmd.displayName } : {}),
      description: cmd.description,
      ...(cmd.example !== undefined ? { example: cmd.example } : {}),
    }));
  }

  listSkills(): ICommandSkillListEntry[] {
    return this.skillCommandSource.getCommands().map((skill) => ({
      name: skill.name,
      description: skill.description,
      source: skill.source,
      modelInvocable: skill.disableModelInvocation !== true,
      userInvocable: skill.userInvocable !== false,
      ...(skill.argumentHint !== undefined ? { argumentHint: skill.argumentHint } : {}),
      ...(skill.context !== undefined ? { context: skill.context } : {}),
      ...(skill.agent !== undefined ? { agent: skill.agent } : {}),
    }));
  }

  listModelInvocableCommands(): Array<{ name: string; description: string }> {
    return this.commandExecutor.listModelInvocableCommands().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  findSkillCommand(name: string): ICommand | undefined {
    const normalizedName = normalizeSkillName(name);
    return this.skillCommandSource
      .getCommands()
      .find((skill) => skill.name.toLowerCase() === normalizedName.toLowerCase());
  }

  async executeCommand(
    name: string,
    args: string,
    source: TCommandInvocationSource = 'user',
  ): Promise<ICommandResult | null> {
    const normalizedName = normalizeCommandName(name);
    const command = this.commandExecutor.getCommand(normalizedName);
    const commandArgs = args.trim();
    if (!command) {
      const skill = this.findSkillCommand(normalizedName);
      const skillsCommand = this.commandExecutor.getCommand('skills');
      if (!skill || !skillsCommand) return null;
      return this.executeCommandWithSource(
        source,
        skillsCommand,
        formatSkillCommandArgs(skill.name, commandArgs),
      );
    }
    return this.executeCommandWithSource(source, command, commandArgs);
  }

  async executeCommandWithSource(
    source: TCommandInvocationSource,
    command: ISystemCommand,
    args: string,
  ): Promise<ICommandResult> {
    const previousSource = this.commandInvocationSource;
    this.commandInvocationSource = source;
    try {
      // REMOTE-003: gate untrusted remote-origin commands (deny-by-default). This guard sits BEFORE the
      // blocking/non-blocking branch, so it covers both dispatch paths; it never touches the `'model'` path
      // (which runs via `executeModelCommand`, not here). A denied command returns an explicit error result and
      // never reaches `command.execute` — no silent no-op.
      if (source === 'remote') {
        const readOnly = !this.commandExecutor.resolveRequiresPermission(command);
        const allowed = this.remoteCommandPolicy
          ? this.remoteCommandPolicy.isAllowed(command.name, readOnly)
          : readOnly;
        if (!allowed) {
          return {
            success: false,
            message: `command '${command.name}' is not permitted from a remote session`,
          };
        }
      }
      if (command.lifecycle === 'blocking') {
        return this.onBlockingCommand(() => this.executeForegroundCommand(command, args));
      }
      return await this.commandExecutor.executeCommand(command, this.getSession(), args);
    } finally {
      this.commandInvocationSource = previousSource;
    }
  }

  async executeModelCommand(name: string, args: string): Promise<ICommandResult | null> {
    const previousSource = this.commandInvocationSource;
    this.commandInvocationSource = 'model';
    try {
      return await this.commandExecutor.executeModelInvocable(name, this.getSession(), args);
    } finally {
      this.commandInvocationSource = previousSource;
    }
  }

  async executeSkillCommandByName(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null> {
    const skill = this.findSkillCommand(name);
    if (!skill) return null;

    if (request.invocationSource === 'model') {
      if (skill.disableModelInvocation === true) {
        return { success: false, message: `Skill is not model-invocable: ${skill.name}` };
      }
      const result = await this.executeSkillWithActivation(skill, args, 'model-tool');
      return {
        success: true,
        message: `Skill activated: ${skill.name}`,
        data: {
          skill: skill.name,
          mode: result.mode,
          ...(result.prompt !== undefined ? { prompt: result.prompt } : {}),
          ...(result.result !== undefined ? { result: result.result } : {}),
        },
      };
    }

    await this.executeUserResolvedSkillCommand(
      skill,
      args,
      request.displayInput,
      request.rawInput,
      'user-slash',
    );
    return {
      success: true,
      message: '',
      data: { skill: skill.name, sessionExecution: true },
      effects: [{ type: 'session-execution-started' }],
    };
  }

  async executeUserResolvedSkillCommand(
    skill: ICommand,
    args: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    invocation: ISkillActivationEvent['invocation'],
  ): Promise<ISkillExecutionResult> {
    if (skill.userInvocable === false) {
      throw new Error(`Skill is not user-invocable: ${skill.name}`);
    }
    const qualifiedName = getQualifiedSkillName(rawInput);

    if (skill.context === 'fork') {
      return this.onForkSkill(skill, args, displayInput, qualifiedName, invocation);
    }

    const result = await this.executeSkillWithActivation(skill, args, invocation, qualifiedName);
    if (result.mode === 'inject') {
      if (result.prompt) await this.onSubmit(result.prompt, displayInput, rawInput);
      return result;
    }
    await this.onApplyResult(result.result ?? '(empty response)');
    return result;
  }

  async executeSkillWithActivation(
    skill: ICommand,
    args: string,
    invocation: ISkillActivationEvent['invocation'],
    qualifiedName?: string,
  ): Promise<ISkillExecutionResult> {
    this.emitSkillActivation(skill, invocation, 'started', qualifiedName);
    try {
      const result = await executeSkill(
        skill,
        args,
        {
          runInFork: (content, options) => this.runSkillInFork(content, options),
          ...(this.shellExec ? { shellExec: this.shellExec } : {}),
        },
        { sessionId: this.getSessionId() },
      );
      this.emitSkillActivation(skill, invocation, 'completed', qualifiedName, {
        appendHistory: false,
      });
      return result;
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      this.emitSkillActivation(skill, invocation, 'failed', qualifiedName, {
        error: error.message,
      });
      throw error;
    }
  }

  private emitSkillActivation(
    skill: ICommand,
    invocation: ISkillActivationEvent['invocation'],
    status: ISkillActivationEvent['status'],
    qualifiedName?: string,
    options: { appendHistory?: boolean; error?: string } = {},
  ): void {
    const event = createSkillActivationEvent({
      skill,
      invocation,
      status,
      ...(qualifiedName !== undefined ? { qualifiedName } : {}),
      ...(options.error !== undefined ? { error: options.error } : {}),
    });
    this.recordSkillActivation(event, options.appendHistory ?? status !== 'completed');
  }

  private async executeForegroundCommand(
    command: ISystemCommand,
    args: string,
  ): Promise<ICommandResult> {
    try {
      return await this.commandExecutor.executeCommand(command, this.getSession(), args);
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      return { success: false, message: `Error: ${errMsg}` };
    }
  }
}
