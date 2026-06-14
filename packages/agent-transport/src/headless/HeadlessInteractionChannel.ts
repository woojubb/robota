/**
 * HeadlessInteractionChannel — owns session lifecycle for non-interactive (print) mode.
 *
 * Mirrors TuiInteractionChannel's ownership pattern: session creation lives here,
 * not in the caller. print-mode.ts constructs this and calls run().
 */

import { execSync } from 'node:child_process';

import { InteractiveSession } from '@robota-sdk/agent-framework';

import { createHeadlessRunner, type TOutputFormat } from './headless-runner.js';

import type { IAIProvider, TPermissionMode } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskRunner,
  ICommandHostAdapters,
  ICommandModule,
  TSubagentRunnerFactory,
  TShellExecFn,
} from '@robota-sdk/agent-framework';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-transport';

export interface IHeadlessInteractionChannelOptions {
  cwd: string;
  provider: IAIProvider;
  outputFormat: TOutputFormat;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  sessionStore?: IInteractiveSessionStore;
  /** Continue/resume an existing session by id (print-mode parity with TUI). */
  resumeSessionId?: string;
  /** Fork the resumed session into a new independent session instead of appending. */
  forkSession?: boolean;
  sessionName?: string;
  bare?: boolean;
  allowedTools?: string[];
  deniedTools?: string[];
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
  commandModules?: readonly ICommandModule[];
  commandHostAdapters?: ICommandHostAdapters;
  shellExec?: TShellExecFn;
}

export class HeadlessInteractionChannel {
  private readonly opts: IHeadlessInteractionChannelOptions;
  private exitCode = 0;

  constructor(options: IHeadlessInteractionChannelOptions) {
    this.opts = options;
  }

  async run(prompt: string): Promise<void> {
    const shellExec: TShellExecFn =
      this.opts.shellExec ??
      ((command: string) =>
        execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd());

    const session = new InteractiveSession({
      cwd: this.opts.cwd,
      provider: this.opts.provider,
      permissionMode: this.opts.permissionMode ?? 'bypassPermissions',
      maxTurns: this.opts.maxTurns,
      sessionStore: this.opts.sessionStore,
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
      commandModules: this.opts.commandModules,
      commandHostAdapters: this.opts.commandHostAdapters,
      shellExec,
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
    });

    const runner = createHeadlessRunner({ session, outputFormat: this.opts.outputFormat });
    this.exitCode = await runner.run(prompt);
    await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless transport complete' });
  }

  getExitCode(): number {
    return this.exitCode;
  }
}
