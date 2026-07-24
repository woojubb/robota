import type { IAIProvider, TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommandHostAdapters, ICommandModule } from '@robota-sdk/agent-framework';
import type { createProjectSessionStore } from '@robota-sdk/agent-framework';
import { HeadlessInteractionChannel } from '@robota-sdk/agent-transport/headless';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import { parseToolList } from '../utils/cli-args.js';
import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';
import type { IMemorySessionOptions } from '../startup/memory-enablement.js';

export interface IPrintModeSessionResolution {
  /** Session id resolved by the CLI from -c/-r (undefined starts a new session). */
  resumeSessionId?: string;
  /** Fork the resumed session into a new independent session (--fork-session). */
  forkSession?: boolean;
}

/** Preset-resolved identity/persona the thin-shell CLI forwards into the headless session. */
export interface IPrintModePresetOptions {
  /**
   * CLI-076: the resolved model id (the same value the CLI header displays — `resolvedPreset.model ??
   * providerSettings.model`). Forwarded to the headless session so an explicit `--model` override reaches
   * the provider chat call rather than being silently replaced by the session's default model.
   */
  model?: string;
  /** Resolved agent name (preset value, else agent-preset DEFAULT_AGENT_NAME). */
  agentName?: string;
  /** Active preset id selected at startup (PRESET-011 runtime state). Defaults to 'default'. */
  activePresetId?: string;
  /** Resolved preset persona block composed as a `source: 'persona'` system-prompt section. */
  persona?: string;
  /** Resolved preset permission mode (overridden by an explicit CLI --permission-mode flag). */
  permissionMode?: TPermissionMode;
  /** Preset execution capability: activate agent runtime + subagent/background dispatch. */
  enableParallelSubagents?: boolean;
  /** Preset execution capability: run a post-task self-verification step. */
  selfVerification?: boolean;
}

export async function runPrintMode(
  cwd: string,
  args: IParsedCliArgs,
  provider: IAIProvider,
  sessionStore: ReturnType<typeof createProjectSessionStore>,
  backgroundTaskRunners: IBackgroundTaskRunner[],
  subagentRunnerFactory: ReturnType<typeof createChildProcessSubagentRunnerFactory>,
  commandModules: readonly ICommandModule[],
  commandHostAdapters: ICommandHostAdapters,
  sessionResolution: IPrintModeSessionResolution = {},
  presetOptions: IPrintModePresetOptions = {},
  memorySessionOptions: IMemorySessionOptions = {},
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
    process.exit(1);
  }

  const appendSystemPrompt = buildAppendSystemPrompt(cwd, args);

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
    provider,
    outputFormat: args.outputFormat ?? 'text',
    // CLI-076: forward the resolved model so `--model` takes effect (an invalid model then surfaces the
    // provider's error and a non-zero exit, instead of a silent substitution succeeding with exit 0).
    ...(presetOptions.model !== undefined ? { model: presetOptions.model } : {}),
    permissionMode: args.permissionMode ?? presetOptions.permissionMode ?? 'bypassPermissions',
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : sessionStore,
    resumeSessionId: sessionResolution.resumeSessionId,
    forkSession: sessionResolution.forkSession,
    sessionName: args.sessionName,
    bare: args.bare || undefined,
    allowedTools: parseToolList(args.allowedTools),
    deniedTools: parseToolList(args.deniedTools),
    appendSystemPrompt,
    ...(presetOptions.persona !== undefined ? { persona: presetOptions.persona } : {}),
    ...(presetOptions.agentName !== undefined ? { agentName: presetOptions.agentName } : {}),
    ...(presetOptions.activePresetId !== undefined
      ? { activePresetId: presetOptions.activePresetId }
      : {}),
    ...(presetOptions.enableParallelSubagents !== undefined
      ? { enableParallelSubagents: presetOptions.enableParallelSubagents }
      : {}),
    ...(presetOptions.selfVerification !== undefined
      ? { selfVerification: presetOptions.selfVerification }
      : {}),
    ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
    backgroundTaskRunners,
    subagentRunnerFactory,
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
    process.exit(1);
  }
  process.exit(channel.getExitCode());
}
