import type { ISandboxClient } from '@robota-sdk/agent-tools';
import type { IAIProvider, IToolWithEventService } from '@robota-sdk/agent-core';
import { homedir } from 'node:os';
import type { IPresetSurfaceOptions } from '../startup/preset-surface-options.js';
import type {
  IAgentDefinition,
  ICreateSessionOptions,
  ICommandHostAdapters,
  ICommandModule,
  IOrgPolicy,
  IProviderErrorGuidance,
  ILivePromptTracePort,
  IProjectSettingsPath,
  INodeHostSettingsSource,
  IContributionSource,
  ISkillRootDescriptor,
  TWorkspaceProjectAccess,
} from '@robota-sdk/agent-framework';
import type { createProjectSessionStore } from '@robota-sdk/agent-framework';
import { HeadlessInteractionChannel } from '@robota-sdk/agent-framework';
import { presetSessionFields } from '../startup/preset-session-fields.js';
import { ROBOTA_PERMISSION_BASELINE } from '../product/robota-permission-baseline.js';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import type { IMemorySessionOptions } from '../startup/memory-enablement.js';
import {
  areSessionLoopsDisabled,
  createLoopDefaultPromptResolver,
} from '../startup/loop-options.js';
import { runShellCommand } from '../startup/shell-exec.js';

/**
 * ARCH-006: the tool surface the kernel overlay resolved. `additionalTools` carries the capability packs'
 * tools; `defaultTools` REPLACES `agent-framework`'s `createDefaultTools()` tier (`robota` passes an empty
 * array, so its packs are the sole source of tools).
 */
export interface IPrintModeToolOptions {
  additionalTools?: IToolWithEventService[];
  defaultTools?: readonly IToolWithEventService[];
  sandboxClient?: ISandboxClient;
}

export interface IPrintModeSessionResolution {
  /** Session id resolved by the CLI from -c/-r (undefined starts a new session). */
  resumeSessionId?: string;
  /** Fork the resumed session into a new independent session (--fork-session). */
  forkSession?: boolean;
}

/** Preset-resolved identity/persona the thin-shell CLI forwards into the headless session. */
/**
 * ARCH-041: ONE declaration. This used to be a hand-written copy of `IPresetSurfaceOptions`, and the
 * two had already drifted — `model` was declared here and on neither of the other two surfaces,
 * which is the shape ARCH-013 was filed about surviving the extraction meant to end it.
 *
 * `Partial` because a caller may supply none of it; the shared type states which fields exist, this
 * states only that they are all optional here.
 */
export type IPrintModePresetOptions = Partial<IPresetSurfaceOptions>;

export async function runPrintMode(
  cwd: string,
  args: IParsedCliArgs,
  provider: IAIProvider,
  sessionStore: ReturnType<typeof createProjectSessionStore>,
  backgroundTaskRunners: IBackgroundTaskRunner[],
  subagentRunnerFactory: ReturnType<typeof createChildProcessSubagentRunnerFactory>,
  /** ARCH-005: composition-root-contributed subagent definitions (merged pack subagents). */
  agentDefinitions: readonly IAgentDefinition[],
  /** ARCH-006: the kernel-resolved tool surface (pack tools + the replaced framework default tier). */
  toolOptions: IPrintModeToolOptions,
  commandModules: readonly ICommandModule[],
  commandHostAdapters: ICommandHostAdapters,
  sessionResolution: IPrintModeSessionResolution = {},
  presetOptions: IPrintModePresetOptions = {},
  memorySessionOptions: IMemorySessionOptions = {},
  projectAccess?: TWorkspaceProjectAccess,
  beforeExit?: () => Promise<void>,
  orgPolicy?: IOrgPolicy,
  providerErrorGuidance?: IProviderErrorGuidance,
  agentDefinitionRoots?: readonly string[],
  pluginDirectories?: { readonly user?: string; readonly project?: string },
  projectSettingsPaths?: readonly IProjectSettingsPath[],
  userSettingsSources?: readonly INodeHostSettingsSource[],
  contributionSources?: readonly IContributionSource[],
  skillRoots?: readonly ISkillRootDescriptor[],
  taskContext?: { readonly enabled?: boolean; readonly dir?: string },
  promptFileReferenceTag?: string,
  modelCommandToolPrefix?: string,
  subagentHookEnvironmentNames?: ICreateSessionOptions['subagentHookEnvironmentNames'],
  observerFailureWarningCode?: ICreateSessionOptions['observerFailureWarningCode'],
  commandHookShell?: string,
  livePromptTrace?: ILivePromptTracePort,
): Promise<void> {
  const goalObjective = args.goal?.trim();
  let prompt = args.positional.join(' ').trim();

  if (!goalObjective && !prompt && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    prompt = Buffer.concat(chunks).toString('utf-8').trim();
  }

  if (!goalObjective && !prompt) {
    process.stderr.write('Print mode (-p) requires a prompt argument (or --goal <objective>).\n');
    await beforeExit?.();
    process.exit(1);
  }

  // CMD-004 Phase 2 (Stage B): print-mode process adapter. Print mode ALWAYS exits when the run
  // completes (the exit-code contract below), so a host-executed exit action is satisfied by the
  // mode itself — nothing extra to do. A restart cannot be performed headlessly; it is surfaced
  // explicitly (never a silent skip).
  commandHostAdapters.process = {
    requestExit: () => {
      /* satisfied by the end-of-run process.exit(channel.getExitCode()) contract */
    },
    requestRestart: (_reason, message) => {
      process.stderr.write(
        `Restart requested (${message}) — print mode cannot restart itself; run the command again.\n`,
      );
    },
  };

  const channel = new HeadlessInteractionChannel({
    cwd,
    ...(livePromptTrace ? { livePromptTrace } : {}),
    provider,
    shellExec: runShellCommand,
    ...(providerErrorGuidance !== undefined ? { providerErrorGuidance } : {}),
    ...(promptFileReferenceTag !== undefined ? { promptFileReferenceTag } : {}),
    ...(modelCommandToolPrefix !== undefined ? { modelCommandToolPrefix } : {}),
    ...(subagentHookEnvironmentNames !== undefined ? { subagentHookEnvironmentNames } : {}),
    ...(observerFailureWarningCode !== undefined ? { observerFailureWarningCode } : {}),
    ...(commandHookShell !== undefined ? { commandHookShell } : {}),
    ...(orgPolicy !== undefined ? { orgPolicy } : {}),
    ...(projectAccess !== undefined ? { projectAccess } : {}),
    ...(projectSettingsPaths !== undefined ? { projectSettingsPaths } : {}),
    ...(userSettingsSources !== undefined ? { userSettingsSources } : {}),
    ...(contributionSources !== undefined ? { contributionSources } : {}),
    ...(skillRoots !== undefined ? { skillRoots } : {}),
    ...(taskContext !== undefined ? { taskContext } : {}),
    outputFormat: args.outputFormat ?? 'text',
    // CLI-076: forward the resolved model so `--model` takes effect (an invalid model then surfaces the
    // provider's error and a non-zero exit, instead of a silent substitution succeeding with exit 0).
    ...(presetOptions.model !== undefined ? { model: presetOptions.model } : {}),
    ...(presetOptions.outputStyle !== undefined ? { outputStyle: presetOptions.outputStyle } : {}),
    // Issue #3081: `default`, not bypass. Print mode has no approver, so anything that would ask is
    // denied; `--permission-mode` (or a preset) states a wider mode where one is wanted.
    permissionMode: args.permissionMode ?? presetOptions.permissionMode ?? 'default',
    baselinePermissionAllow: ROBOTA_PERMISSION_BASELINE,
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : sessionStore,
    disableSessionLoops: areSessionLoopsDisabled(process.env),
    resolveDefaultLoopPrompt: createLoopDefaultPromptResolver({
      projectAccess,
      userHome: homedir(),
    }),
    resumeSessionId: sessionResolution.resumeSessionId,
    forkSession: sessionResolution.forkSession,
    sessionName: args.sessionName,
    bare: args.bare || args.safeMode || undefined,
    // `--safe-mode`: no hook from any settings layer either (issue #3082).
    ...(args.safeMode ? { skipConfiguredHooks: true } : {}),
    ...presetSessionFields(presetOptions),
    ...(presetOptions.persona !== undefined ? { persona: presetOptions.persona } : {}),
    ...(presetOptions.agentName !== undefined ? { agentName: presetOptions.agentName } : {}),
    ...(presetOptions.activePresetId !== undefined
      ? { activePresetId: presetOptions.activePresetId }
      : {}),
    ...(presetOptions.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: presetOptions.enableParallelSubagents }
      : {}),
    ...(presetOptions.effort !== undefined ? { effort: presetOptions.effort } : {}),
    ...(presetOptions.effortResolution !== undefined && !args.bare
      ? { effortResolution: presetOptions.effortResolution }
      : {}),
    ...(presetOptions.temperature !== undefined ? { temperature: presetOptions.temperature } : {}),
    ...(presetOptions.maxOutputTokens !== undefined
      ? { maxOutputTokens: presetOptions.maxOutputTokens }
      : {}),
    ...(presetOptions.responseFormat !== undefined
      ? { responseFormat: presetOptions.responseFormat }
      : {}),
    ...(presetOptions.language !== undefined ? { language: presetOptions.language } : {}),
    // ARCH-040: onto the SEED key, never onto `systemPrompt` — that one replaces the composed prompt.
    ...(presetOptions.systemPrompt !== undefined
      ? { presetSystemPrompt: presetOptions.systemPrompt }
      : {}),
    ...(presetOptions.selfVerification !== undefined
      ? { selfVerification: presetOptions.selfVerification }
      : {}),
    ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
    backgroundTaskRunners,
    subagentRunnerFactory,
    ...(agentDefinitions.length > 0 ? { agentDefinitions } : {}),
    ...(agentDefinitionRoots !== undefined ? { agentDefinitionRoots } : {}),
    ...(pluginDirectories !== undefined ? { pluginDirectories } : {}),
    ...(toolOptions.additionalTools !== undefined
      ? { additionalTools: toolOptions.additionalTools }
      : {}),
    ...(toolOptions.defaultTools !== undefined ? { defaultTools: toolOptions.defaultTools } : {}),
    ...(toolOptions.sandboxClient !== undefined
      ? { sandboxClient: toolOptions.sandboxClient }
      : {}),
    commandModules,
    commandHostAdapters,
    // SELFHOST-008 P6: surface-resolved memory fields (empty ⇒ memory OFF, today's behavior).
    ...memorySessionOptions,
  });

  // RUNTIME-36: a throw from run/runGoal must NOT bypass the exit-code contract — surface a non-zero exit
  // instead of leaving the process to an unhandled rejection. `process.exit(getExitCode())` stays OUTSIDE the
  // try so a NORMAL exit (including code 0) is not caught by the error branch.
  try {
    if (goalObjective) {
      await channel.runGoal(
        goalObjective,
        args.goalMaxIterations ? { maxIterations: args.goalMaxIterations } : {},
      );
    } else {
      await channel.run(prompt);
    }
  } catch (error) {
    process.stderr.write((error instanceof Error ? error.message : String(error)) + '\n');
    await beforeExit?.();
    process.exit(1);
  }
  await beforeExit?.();
  process.exit(channel.getExitCode());
}
