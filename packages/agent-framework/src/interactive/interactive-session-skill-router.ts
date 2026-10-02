/**
 * SessionSkillRouter — manages command execution and skill routing
 * for an InteractiveSession. Handles SystemCommandExecutor, SkillCommandSource,
 * and all command/skill invocation logic.
 */

import { AsyncLocalStorage } from 'node:async_hooks';

import { toCommandListEntry, toSkillListEntry } from './interactive-session-command-projections.js';
import {
  executeSkill,
  findUnknownModuleNames,
  selectCommandModules,
  SkillCommandSource,
  SystemCommandExecutor,
} from '../commands/index.js';
import { mergeSkillCommands } from '../commands/skill-source.js';
import { createSkillActivationEvent } from '../commands/skill-activation-events.js';

import type { TSubmitFn } from './interactive-session-execution-contracts.js';
import type { ICommandHostContext } from '../command-api/index.js';
import type {
  ICommand,
  ICommandHostAdapters,
  ICommandListEntry,
  ICommandModule,
  ICommandResult,
  ICommandSkillListEntry,
  ISkillExecutionResult,
  IForkExecutionOptions,
  ICommandSkillActivationRequest,
  IUnknownCommandModuleName,
  TCommandInvocationSource,
  TCommandSurfaceLocality,
  ISystemCommand,
  IRemoteCommandPolicy,
} from '../commands/index.js';
import type { ISkillActivationEvent } from '../commands/skill-activation-events.js';
import type { IContributionSource } from '../contributions/index.js';
import type { ISkillRootDescriptor } from '../commands/skill-source.js';
import type { TShellExecFn } from '../utils/skill-prompt.js';
import type { TDriverId } from '@robota-sdk/agent-interface-session';
import type {
  ISkillContentActivation,
  ISkillResource,
} from '@robota-sdk/agent-interface-command';

interface ISkillResourceWindow {
  readonly bindings: Map<string, ISkillContentActivation>;
  readonly activations: Set<ISkillContentActivation>;
  readonly signal?: AbortSignal;
  closed: boolean;
}

function normalizeNameToken(name: string): string {
  return name.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function getQualifiedSkillName(rawInput?: string): string | undefined {
  if (!rawInput?.startsWith('/')) return undefined;
  const firstToken = rawInput.slice(1).trim().split(/\s+/)[0];
  return firstToken && firstToken.length > 0 ? firstToken : undefined;
}

export class SessionSkillRouter {
  private readonly forkResourceWindow = new AsyncLocalStorage<ISkillResourceWindow>();
  private skillWindow?: {
    readonly turnId: string | symbol;
    readonly stop: AbortController;
    readonly signal: AbortSignal;
    readonly activations: Set<ISkillContentActivation>;
    readonly bindings: Map<string, ISkillContentActivation>;
    closed: boolean;
  };

  beginTurnSkillActivation(turnId: string | symbol, signal?: AbortSignal): void {
    if (this.skillWindow) throw new Error('A skill activation turn is already active.');
    const stop = new AbortController();
    const effective = signal ? AbortSignal.any([signal, stop.signal]) : stop.signal;
    this.skillWindow = {
      turnId,
      stop,
      signal: effective,
      activations: new Set(),
      bindings: new Map(),
      closed: false,
    };
  }

  endTurnSkillActivation(turnId: string | symbol): readonly Error[] {
    const window = this.skillWindow;
    if (!window || window.turnId !== turnId) return [];
    window.closed = true;
    this.skillWindow = undefined;
    window.stop.abort();
    const errors: Error[] = [];
    for (const activation of window.activations) {
      try {
        activation.close();
      } catch (error) {
        errors.push(error instanceof Error ? error : new Error(String(error)));
      }
    }
    window.activations.clear();
    window.bindings.clear();
    return errors;
  }

  abortSkillActivations(): readonly Error[] {
    return this.skillWindow ? this.endTurnSkillActivation(this.skillWindow.turnId) : [];
  }

  async validateTurnSkillActivations(turnId: string): Promise<void> {
    const window = this.skillWindow;
    if (!window || window.turnId !== turnId) throw new Error('Skill activation turn has ended.');
    for (const activation of window.activations) {
      await activation.validate();
      window.signal.throwIfAborted();
      if (this.skillWindow !== window) throw new Error('Skill activation turn has ended.');
    }
  }
  readonly commandExecutor: SystemCommandExecutor;
  /** Command modules received at construction — retained for live re-selection (PRESET-015). */
  private readonly allCommandModules: readonly ICommandModule[];
  private readonly skillCommandSource: SkillCommandSource;
  private readonly commandHostAdapters?: ICommandHostAdapters;
  /**
   * The in-flight command's source and, for CMD-004, its origin driver id (REMOTE-014 E5
   * server-assigned). Scoped to that command's own async chain, not shared fields: two commands in
   * flight at once each see their own, and neither can overwrite or strand the other's.
   */
  private readonly commandScope = new AsyncLocalStorage<{
    readonly source: TCommandInvocationSource;
    readonly originDriverId: TDriverId | undefined;
    readonly locality: TCommandSurfaceLocality | undefined;
  }>();
  constructor(
    commandModules: readonly ICommandModule[],
    contributionSources: readonly IContributionSource[],
    skillRoots: readonly ISkillRootDescriptor[],
    commandHostAdapters: ICommandHostAdapters | undefined,
    private readonly getSession: () => ICommandHostContext,
    private readonly getSessionId: () => string,
    private readonly onSubmit: TSubmitFn,
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
    /** Optional remote-command policy (REMOTE-006). Undefined → allow (local == remote); provide one only to opt into a restriction. */
    private readonly remoteCommandPolicy?: IRemoteCommandPolicy,
    /** Skills from the bundle plugins the session loaded. */
    private pluginSkills: readonly ICommand[] = [],
    /** Defer host-supplied instructions until their submitted turn owns execution. */
    private readonly onSubmitPreparedSkill?: (
      preparePrompt: () => Promise<string>,
      displayInput: string | undefined,
      rawInput: string | undefined,
      originDriverId: TDriverId | undefined,
    ) => Promise<void>,
  ) {
    this.allCommandModules = commandModules;
    this.commandExecutor = new SystemCommandExecutor(
      commandModules.flatMap((module) => module.systemCommands ?? []),
    );
    this.skillCommandSource = new SkillCommandSource(contributionSources, skillRoots);
    this.commandHostAdapters = commandHostAdapters;
  }
  /**
   * PRESET-015 — re-filter the session's command modules and rebuild the executor live. INFRA-032 also
   * returns unmatched `enabled`/`disabled` names so `/preset` can report them instead of dropping them.
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

  async shutdownModules(): Promise<unknown[]> {
    const activationErrors = this.abortSkillActivations();
    const host = this.getSession();
    const results = await Promise.allSettled(
      this.allCommandModules.map((module) => Promise.resolve().then(() => module.shutdown?.(host))),
    );
    return [
      ...activationErrors,
      ...results.flatMap((result) => (result.status === 'rejected' ? [result.reason] : [])),
    ];
  }

  getCommandInvocationSource(): TCommandInvocationSource {
    return this.commandScope.getStore()?.source ?? 'user';
  }

  canRunDuringTurn(name: string, args: string, source: TCommandInvocationSource): boolean {
    if (source !== 'user' && source !== 'remote') return false;
    const command = this.commandExecutor.getCommand(normalizeNameToken(name));
    return command?.lifecycle === 'inline' && command.canRunDuringTurn?.(args.trim()) === true;
  }

  /** #3282 §4 part b-2: allow-by-default, matching every other transport-origin default here. */
  getCommandSurfaceLocality(): TCommandSurfaceLocality {
    return this.commandScope.getStore()?.locality ?? 'local';
  }

  getCommandSurfaceLocalityEvidence(): TCommandSurfaceLocality | undefined {
    return this.commandScope.getStore()?.locality;
  }

  getCommandOriginDriverId(): TDriverId | undefined {
    return this.commandScope.getStore()?.originDriverId;
  }

  getCommandHostAdapters(): ICommandHostAdapters {
    return this.commandHostAdapters ?? {};
  }

  listCommands(): ICommandListEntry[] {
    return this.commandExecutor.listCommands().map(toCommandListEntry);
  }

  replacePluginSkills(skills: readonly ICommand[]): void {
    this.pluginSkills = skills;
  }

  listSkills(): ICommandSkillListEntry[] {
    return this.allSkills().map(toSkillListEntry);
  }

  async readSkillResource(name: string, uri: string): Promise<ISkillResource> {
    const fork = this.forkResourceWindow.getStore();
    const window = fork ?? this.skillWindow;
    const check = () => {
      if (!window || window.closed || (!fork && this.skillWindow !== window))
        throw new Error('No active skill resource window.');
      window.signal?.throwIfAborted();
    };
    check();
    const activation = window?.bindings.get(normalizeNameToken(name).toLowerCase());
    if (!activation?.resources)
      throw new Error(`No active supporting resources for skill: ${name}`);
    if (!activation.resources.manifest.some((resource) => resource.uri === uri))
      throw new Error('Resource is outside the active skill manifest.');
    const resource = await activation.resources.read(uri, window?.signal);
    check();
    return resource;
  }

  /** The session's own skills, then the plugin skills whose names they do not already use. */
  private allSkills(): ICommand[] {
    return mergeSkillCommands(
      mergeSkillCommands(this.skillCommandSource.getCommands(), this.pluginSkills),
      this.commandHostAdapters?.skillCommands?.getCommands() ?? [],
    );
  }

  listModelInvocableCommands(): Array<{ name: string; description: string }> {
    return this.commandExecutor.listModelInvocableCommands().map((cmd) => ({
      name: cmd.name,
      description: cmd.description,
    }));
  }

  findSkillCommand(name: string): ICommand | undefined {
    const normalizedName = normalizeNameToken(name);
    return this.allSkills().find(
      (skill) => skill.name.toLowerCase() === normalizedName.toLowerCase(),
    );
  }

  async executeCommand(
    name: string,
    args: string,
    source: TCommandInvocationSource = 'user',
    originDriverId?: TDriverId,
    locality?: TCommandSurfaceLocality,
  ): Promise<ICommandResult | null> {
    const normalizedName = normalizeNameToken(name);
    const command = this.commandExecutor.getCommand(normalizedName);
    const commandArgs = args.trim();
    if (!command) {
      const skill = this.findSkillCommand(normalizedName);
      const skillsCommand = this.commandExecutor.getCommand(
        this.commandExecutor.getSemanticRoles().skillActivation ?? '',
      );
      if (!skill || !skillsCommand) return null;
      return this.executeCommandWithSource(
        source,
        skillsCommand,
        commandArgs.length > 0 ? `${skill.name} ${commandArgs}` : skill.name,
        originDriverId,
        locality,
      );
    }
    return this.executeCommandWithSource(source, command, commandArgs, originDriverId, locality);
  }

  async executeCommandWithSource(
    source: TCommandInvocationSource,
    command: ISystemCommand,
    args: string,
    originDriverId?: TDriverId,
    locality?: TCommandSurfaceLocality,
  ): Promise<ICommandResult> {
    return this.commandScope.run({ source, originDriverId, locality }, async () => {
      // REMOTE-006: local == remote — a transport-origin command runs exactly as a locally-typed one (pairing is
      // the trust boundary; the universal permission system governs anything dangerous). This is **allow-by-
      // default**: with no injected policy it always allows; an OPTIONAL `remoteCommandPolicy` may restrict for a
      // consumer that opts in. (The guard is kept only as that opt-in seam.)
      if (source === 'remote' && this.remoteCommandPolicy) {
        const readOnly = !this.commandExecutor.resolveRequiresPermission(command);
        if (!this.remoteCommandPolicy.isAllowed(command.name, readOnly)) {
          return {
            success: false,
            message: `command '${command.name}' is not permitted by the configured remote-command policy`,
          };
        }
      }
      if (command.lifecycle === 'blocking') {
        return this.onBlockingCommand(() => this.executeForegroundCommand(command, args));
      }
      return await this.commandExecutor.executeCommand(command, this.getSession(), args);
    });
  }

  async executeModelCommand(name: string, args: string): Promise<ICommandResult | null> {
    return this.commandScope.run(
      { source: 'model', originDriverId: undefined, locality: undefined },
      () => this.commandExecutor.executeModelInvocable(name, this.getSession(), args),
    );
  }

  async executeSkillCommandByName(
    name: string,
    args: string,
    request: ICommandSkillActivationRequest,
  ): Promise<ICommandResult | null> {
    // Read before the first await: the turn this skill submits belongs to the command that ran it.
    const originDriverId = this.getCommandOriginDriverId();
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
      originDriverId,
    );
    // CMD-004 Stage E: `data.sessionExecution` — the requester-local "session turn started" hint.
    return {
      success: true,
      message: '',
      data: { skill: skill.name, sessionExecution: true },
    };
  }

  async executeUserResolvedSkillCommand(
    skill: ICommand,
    args: string,
    displayInput: string | undefined,
    rawInput: string | undefined,
    invocation: ISkillActivationEvent['invocation'],
    /** Who ran the command; its submitted turn is theirs. Absent means the owner. */
    originDriverId?: TDriverId,
  ): Promise<ISkillExecutionResult> {
    if (skill.userInvocable === false) {
      throw new Error(`Skill is not user-invocable: ${skill.name}`);
    }
    const qualifiedName = getQualifiedSkillName(rawInput);

    if (skill.context === 'fork') {
      return this.onForkSkill(skill, args, displayInput, qualifiedName, invocation);
    }

    if (skill.skillContentLoader) {
      if (!this.onSubmitPreparedSkill)
        throw new Error('Lazy user skills require turn preparation.');
      await this.onSubmitPreparedSkill(
        async () => {
          const result = await this.executeSkillWithActivation(
            skill,
            args,
            invocation,
            qualifiedName,
          );
          if (result.mode !== 'inject' || !result.prompt)
            throw new Error('Lazy user skill did not produce instructions for its turn.');
          return result.prompt;
        },
        displayInput,
        rawInput,
        originDriverId,
      );
      return { mode: 'inject' };
    }

    const result = await this.executeSkillWithActivation(skill, args, invocation, qualifiedName);
    if (result.mode === 'inject') {
      // The turn belongs to whoever issued the command: a remote co-driver's skill is its turn, attributed
      // exactly as its direct prompts are, never the owner's.
      if (result.prompt) {
        await this.onSubmit(
          result.prompt,
          displayInput,
          rawInput,
          originDriverId !== undefined ? { driverId: originDriverId } : undefined,
        );
      }
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
    const window = this.skillWindow;
    const fork = this.forkResourceWindow.getStore();
    const owner = fork ?? window;
    if (fork?.closed) throw new Error('Skill activation fork has ended.');
    this.emitSkillActivation(skill, invocation, 'started', qualifiedName);
    try {
      const result = await executeSkill(
        skill,
        args,
        {
          ...(owner?.signal ? { signal: owner.signal } : {}),
          retainActivation: (activation) => {
            if (!owner || owner.closed || (!fork && this.skillWindow !== window))
              throw new Error('Lazy skill injection requires its owning turn.');
            owner.signal?.throwIfAborted();
            owner.activations.add(activation);
            owner.bindings.set(skill.name.toLowerCase(), activation);
          },
          describeResources: (activation) => {
            if (!activation.resources?.manifest.length) return '';
            const command = this.commandExecutor.getSemanticRoles().skillResourceRead;
            if (!command || !this.commandExecutor.isModelInvocable(command))
              return 'Supporting-file access is unavailable on this command surface.';
            return `Supporting resources remain verified data within this execution; reading a nested SKILL.md does not activate it. Invoke the projected command with id ${JSON.stringify(command)} and args as a JSON array [${JSON.stringify(skill.name)}, "<resource-uri>"]. Available resources: ${JSON.stringify(activation.resources.manifest)}.`;
          },
          runInFork: async (content, options, activation) => {
            const scope: ISkillResourceWindow = {
              bindings: new Map(activation ? [[skill.name.toLowerCase(), activation]] : []),
              activations: new Set(),
              ...(options.signal ? { signal: options.signal } : {}),
              closed: false,
            };
            let result = '';
            const errors: unknown[] = [];
            try {
              result = await this.forkResourceWindow.run(scope, () =>
                this.runSkillInFork(content, options),
              );
            } catch (error) {
              errors.push(error);
            }
            scope.closed = true;
            scope.bindings.clear();
            for (const admitted of scope.activations) {
              try {
                admitted.close();
              } catch (error) {
                errors.push(error);
              }
            }
            scope.activations.clear();
            if (errors.length === 1) throw errors[0];
            if (errors.length)
              throw new AggregateError(errors, 'Fork skill execution or cleanup failed.');
            return result;
          },
          ...(this.shellExec ? { shellExec: this.shellExec } : {}),
        },
        {
          sessionId: this.getSessionId(),
          ...(skill.skillDirectory !== undefined ? { skillDir: skill.skillDirectory } : {}),
          ...(skill.pluginDir !== undefined ? { pluginRoot: skill.pluginDir } : {}),
        },
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
