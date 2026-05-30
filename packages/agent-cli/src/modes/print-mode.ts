import type { IAIProvider } from '@robota-sdk/agent-core';
import type { ICommandHostAdapters, ICommandModule } from '@robota-sdk/agent-framework';
import type { createProjectSessionStore } from '@robota-sdk/agent-framework';
import { HeadlessInteractionChannel } from '@robota-sdk/agent-transport/headless';
import type { IBackgroundTaskRunner } from '@robota-sdk/agent-executor';
import type { createChildProcessSubagentRunnerFactory } from '@robota-sdk/agent-subagent-runner';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';

export async function runPrintMode(
  cwd: string,
  args: IParsedCliArgs,
  provider: IAIProvider,
  sessionStore: ReturnType<typeof createProjectSessionStore>,
  backgroundTaskRunners: IBackgroundTaskRunner[],
  subagentRunnerFactory: ReturnType<typeof createChildProcessSubagentRunnerFactory>,
  commandModules: readonly ICommandModule[],
  commandHostAdapters: ICommandHostAdapters,
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
    permissionMode: args.permissionMode ?? 'bypassPermissions',
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : sessionStore,
    sessionName: args.sessionName,
    bare: args.bare || undefined,
    allowedTools: args.allowedTools
      ? args.allowedTools
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined,
    appendSystemPrompt,
    ...(args.systemPrompt ? { systemPrompt: args.systemPrompt } : {}),
    backgroundTaskRunners,
    subagentRunnerFactory,
    commandModules,
    commandHostAdapters,
  });

  await channel.run(prompt);
  process.exit(channel.getExitCode());
}
