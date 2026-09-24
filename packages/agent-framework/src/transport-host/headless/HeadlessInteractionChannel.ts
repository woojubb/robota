/**
 * HeadlessInteractionChannel — owns session lifecycle for non-interactive (print) mode.
 *
 * Mirrors TuiInteractionChannel's ownership pattern: session creation lives here,
 * not in the caller. print-mode.ts constructs this and calls run().
 */

import { createHeadlessRunner, type TOutputFormat } from './headless-runner.js';
import { buildRuntimeSession } from '../../runtime/runtime-host.js';

import type { IAgentDefinition } from '../../agents/agent-definition-types.js';
import type { ICreateSessionOptions } from '../../assembly/create-session-types.js';
import type { IProjectSettingsPath } from '../../config/settings-source.js';
import type { IResolvedConfig } from '../../config/config-types.js';
import type { IContributionSource } from '../../contributions/index.js';
import type { ISkillRootDescriptor } from '../../commands/skill-source.js';
import type { ICommandModule } from '../../command-api/command-module.js';
import type { ICommandHostAdapters } from '../../command-api/host-adapters.js';
import type { IOrgPolicy } from '../../command-api/org-policy/org-policy-types.js';
import type { IOutputStylePrompt } from '../../context/output-style-prompt.js';
import type { IModelEffortResolution } from '../../effort/effort-resolution.js';
import type { InteractiveSession } from '../../interactive/interactive-session.js';
import type { IAutomaticMemoryConfig } from '../../memory/automatic-memory-types.js';
import type { IMemoryStore, IPerTurnRecallConfig } from '../../memory/types.js';
import type { TSubagentRunnerFactory } from '../../subagents/in-process-subagent-runner.js';
import type { IProviderErrorGuidance } from '../../utils/error-humanizer.js';
import type { TShellExecFn } from '../../utils/skill-prompt.js';
import type { TWorkspaceProjectAccess } from '../../workspace-trust/types.js';
import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

export interface IHeadlessInteractionChannelOptions {
  cwd: string;
  provider: IAIProvider;
  providerErrorGuidance?: IProviderErrorGuidance;
  /** Resolved organization policy enforced by the interactive session. */
  orgPolicy?: IOrgPolicy;
  projectAccess?: TWorkspaceProjectAccess;
  projectSettingsPaths?: readonly IProjectSettingsPath[];
  baselinePermissionAllow?: readonly string[];
  /** Host-selected task-context root; absent means the framework scans no task directory. */
  taskContext?: IResolvedConfig['taskContext'];
  contributionSources?: readonly IContributionSource[];
  skillRoots?: readonly ISkillRootDescriptor[];
  outputFormat: TOutputFormat;
  /**
   * CLI-076: the resolved model id (the same value the CLI header displays). Forwarded verbatim to the
   * session so an explicit `--model` override actually reaches the provider chat call. Absent ⇒ the
   * session resolves the model from config (no silent substitution of the requested model).
   */
  model?: string;
  /** CLI-1988: resolved provider-neutral response style. */
  outputStyle?: IOutputStylePrompt;
  /** ARCH-013: resolved preset effort, threaded to the session's `effort` seam. */
  effort?: ICreateSessionOptions['effort'];
  /** Provider generation options resolved by the print/goal preset. */
  temperature?: number;
  maxOutputTokens?: number;
  /** Response language and preset prompt seed, distinct from a replacing system prompt. */
  language?: string;
  presetSystemPrompt?: string;
  /** Structured response policy, including JSON schema requests. */
  responseFormat?: ICreateSessionOptions['responseFormat'];
  /** FLOW-008: startup source/effective metadata projected into headless results. */
  effortResolution?: IModelEffortResolution;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  disableSessionLoops?: boolean;
  resolveDefaultLoopPrompt?: () => string;
  /** Continue/resume an existing session by id (print-mode parity with TUI). */
  resumeSessionId?: string;
  /** Fork the resumed session into a new independent session instead of appending. */
  forkSession?: boolean;
  sessionName?: string;
  bare?: boolean;
  allowedTools?: readonly string[];
  deniedTools?: readonly string[];
  appendSystemPrompt?: string;
  systemPrompt?: string;
  /** Name reported to the underlying agent config (resolved by the CLI, e.g. preset agentName). */
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Preset persona block composed as a `source: 'persona'` system-prompt section (priority 5). */
  persona?: string;
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean;
  backgroundTaskRunners?: IBackgroundTaskRunner[];
  subagentRunnerFactory?: TSubagentRunnerFactory;
  /**
   * ARCH-005: subagent definitions contributed by the composition root (the capability packs
   * `assembleProduct` merged). Forwarded to the session's `agentDefinitions` seam; absent ⇒ unchanged.
   */
  agentDefinitions?: readonly IAgentDefinition[];
  /** Ordered host-owned relative directories for discovered agent definitions. */
  agentDefinitionRoots?: readonly string[];
  pluginDirectories?: { readonly user?: string; readonly project?: string };
  /**
   * ARCH-006: tools contributed by the composition root (the capability packs `assembleProduct` merged)
   * and, when the profile hands the packs the whole tool surface, the suppressed framework default tier
   * (`defaultTools: []`). Forwarded to the session's tool-composition seam; absent ⇒ unchanged.
   */
  additionalTools?: IToolWithEventService[];
  defaultTools?: readonly IToolWithEventService[];
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  /** Host-owned shell adapter used only when a skill explicitly requests shell interpolation. */
  shellExec: TShellExecFn;
  /**
   * SELFHOST-008 P6: optional durable-memory store injected by the surface (agent-cli). Forwarded into
   * `buildRuntimeSession`; absent ⇒ memory OFF (today's behavior). Enablement/policy is surface-owned.
   */
  memoryStore?: IMemoryStore;
  /** SELFHOST-008 P6: optional automatic post-turn capture policy (absent ⇒ capture OFF). */
  automaticMemory?: IAutomaticMemoryConfig;
  /** SELFHOST-008 P6: optional per-turn recall policy (absent ⇒ recall OFF, startup-only injection). */
  recallMemory?: IPerTurnRecallConfig;
}

export class HeadlessInteractionChannel {
  private readonly opts: IHeadlessInteractionChannelOptions;
  private exitCode = 0;

  constructor(options: IHeadlessInteractionChannelOptions) {
    if (typeof options.shellExec !== 'function') {
      throw new Error('Headless shell execution must be provided by the host.');
    }
    this.opts = options;
  }

  async run(prompt: string): Promise<void> {
    const session = this.createSession();
    const runner = createHeadlessRunner({
      session,
      outputFormat: this.opts.outputFormat,
      providerErrorGuidance: this.opts.providerErrorGuidance,
      effortResolution: this.opts.effortResolution,
    });
    this.exitCode = await runner.run(prompt);
    await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless transport complete' });
  }

  /**
   * GOAL-001: run an autonomous goal to completion (or a stop condition) in headless mode.
   * Mirrors {@link run} but drives the framework goal loop instead of a single prompt.
   */
  async runGoal(objective: string, options: { maxIterations?: number } = {}): Promise<void> {
    const session = this.createSession();
    const runner = createHeadlessRunner({
      session,
      outputFormat: this.opts.outputFormat,
      providerErrorGuidance: this.opts.providerErrorGuidance,
      effortResolution: this.opts.effortResolution,
    });
    this.exitCode = await runner.runGoal(objective, options);
    await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless goal complete' });
  }

  private createSession(): InteractiveSession {
    // RUNTIME-001: build through the shared construction seam (agent-framework), not a private
    // `new InteractiveSession` — one session-construction SSOT across the TUI, print, and --serve.
    return buildRuntimeSession({
      cwd: this.opts.cwd,
      provider: this.opts.provider,
      ...(this.opts.providerErrorGuidance !== undefined
        ? { providerErrorGuidance: this.opts.providerErrorGuidance }
        : {}),
      ...(this.opts.orgPolicy !== undefined ? { orgPolicy: this.opts.orgPolicy } : {}),
      ...(this.opts.projectAccess !== undefined ? { projectAccess: this.opts.projectAccess } : {}),
      ...(this.opts.projectSettingsPaths !== undefined
        ? { projectSettingsPaths: this.opts.projectSettingsPaths }
        : {}),
      ...(this.opts.taskContext !== undefined ? { taskContext: this.opts.taskContext } : {}),
      ...(this.opts.contributionSources !== undefined
        ? { contributionSources: this.opts.contributionSources }
        : {}),
      ...(this.opts.skillRoots !== undefined ? { skillRoots: this.opts.skillRoots } : {}),
      permissionMode: this.opts.permissionMode ?? 'bypassPermissions',
      baselinePermissionAllow: this.opts.baselinePermissionAllow,
      // CMD-004 / REMOTE-007 D4a: headless subscribes to none of the session's `ask_request` surface,
      // so getUserInteraction() is gated to undefined (the framework's event-emitting ask default is
      // always present, but the command port's PRESENCE follows the live listener count). Each command
      // then applies its explicit no-human path (e.g. /mode reports current, /exit and /clear proceed —
      // never a silent guess).
      maxTurns: this.opts.maxTurns,
      // CLI-076: forward the resolved model so an explicit `--model` override takes effect instead of being
      // silently dropped (which fell through to the session's config/default model).
      ...(this.opts.model !== undefined ? { model: this.opts.model } : {}),
      ...(this.opts.effort !== undefined ? { effort: this.opts.effort } : {}),
      ...(this.opts.outputStyle !== undefined ? { outputStyle: this.opts.outputStyle } : {}),
      ...(this.opts.temperature !== undefined ? { temperature: this.opts.temperature } : {}),
      ...(this.opts.maxOutputTokens !== undefined
        ? { maxOutputTokens: this.opts.maxOutputTokens }
        : {}),
      ...(this.opts.language !== undefined ? { language: this.opts.language } : {}),
      ...(this.opts.presetSystemPrompt !== undefined
        ? { presetSystemPrompt: this.opts.presetSystemPrompt }
        : {}),
      ...(this.opts.responseFormat !== undefined
        ? { responseFormat: this.opts.responseFormat }
        : {}),
      sessionStore: this.opts.sessionStore,
      disableSessionLoops: this.opts.disableSessionLoops,
      resolveDefaultLoopPrompt: this.opts.resolveDefaultLoopPrompt,
      resumeSessionId: this.opts.resumeSessionId,
      forkSession: this.opts.forkSession,
      sessionName: this.opts.sessionName,
      bare: this.opts.bare || undefined,
      allowedTools: this.opts.allowedTools,
      deniedTools: this.opts.deniedTools,
      appendSystemPrompt: this.opts.appendSystemPrompt,
      ...(this.opts.persona !== undefined ? { persona: this.opts.persona } : {}),
      ...(this.opts.systemPrompt ? { systemPrompt: this.opts.systemPrompt } : {}),
      backgroundTaskRunners: this.opts.backgroundTaskRunners,
      subagentRunnerFactory: this.opts.subagentRunnerFactory,
      ...(this.opts.agentDefinitions !== undefined
        ? { agentDefinitions: this.opts.agentDefinitions }
        : {}),
      ...(this.opts.agentDefinitionRoots !== undefined
        ? { agentDefinitionRoots: this.opts.agentDefinitionRoots }
        : {}),
      ...(this.opts.pluginDirectories !== undefined
        ? { pluginDirectories: this.opts.pluginDirectories }
        : {}),
      ...(this.opts.additionalTools !== undefined
        ? { additionalTools: this.opts.additionalTools }
        : {}),
      ...(this.opts.defaultTools !== undefined ? { defaultTools: this.opts.defaultTools } : {}),
      commandModules: this.opts.commandModules,
      commandHostAdapters: this.opts.commandHostAdapters,
      shellExec: this.opts.shellExec,
      agentName: this.opts.agentName,
      ...(this.opts.activePresetId !== undefined
        ? { activePresetId: this.opts.activePresetId }
        : {}),
      ...(this.opts.enableParallelSubagents !== undefined
        ? { enableParallelSubagents: this.opts.enableParallelSubagents }
        : {}),
      ...(this.opts.selfVerification !== undefined
        ? { selfVerification: this.opts.selfVerification }
        : {}),
      // SELFHOST-008 P6: forward the surface-resolved memory fields only when present (absent ⇒ OFF).
      ...(this.opts.memoryStore ? { memoryStore: this.opts.memoryStore } : {}),
      ...(this.opts.automaticMemory ? { automaticMemory: this.opts.automaticMemory } : {}),
      ...(this.opts.recallMemory ? { recallMemory: this.opts.recallMemory } : {}),
    });
  }

  getExitCode(): number {
    return this.exitCode;
  }
}
