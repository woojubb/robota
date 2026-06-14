import type { IAIProvider, TPermissionMode } from '@robota-sdk/agent-core';
import type { ICommandHostAdapters, ICommandModule } from '@robota-sdk/agent-framework';
import type { createProjectSessionStore } from '@robota-sdk/agent-framework';
import { HeadlessInteractionChannel } from '@robota-sdk/agent-transport/headless';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import { parseToolList } from '../utils/cli-args.js';
import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';

export interface IPrintModeSessionResolution {
  /** Session id resolved by the CLI from -c/-r (undefined starts a new session). */
  resumeSessionId?: string;
  /** Fork the resumed session into a new independent session (--fork-session). */
  forkSession?: boolean;
}

/** Preset-resolved identity/persona the thin-shell CLI forwards into the headless session. */
export interface IPrintModePresetOptions {
  /** Resolved agent name (preset value, else agent-preset DEFAULT_AGENT_NAME). */
  agentName?: string;
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
): Promise<void> {
  let prompt = args.positional.join(' ').trim();

  if (!prompt && !process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    prompt = Buffer.concat(chunks).toString('utf-8').trim();
  }

  if (!prompt) {
    process.stderr.write('Print mode (-p) requires a prompt argument.\n');
    process.exit(1);
  }

  const appendSystemPrompt = buildAppendSystemPrompt(cwd, args);

  const channel = new HeadlessInteractionChannel({
    cwd,
    provider,
    outputFormat: args.outputFormat ?? 'text',
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
  });

  await channel.run(prompt);
  process.exit(channel.getExitCode());
}
