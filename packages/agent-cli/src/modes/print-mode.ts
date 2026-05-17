import { execSync } from 'node:child_process';

import { InteractiveSession, type IAgentRuntime } from '@robota-sdk/agent-framework';
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';

import type { ISessionRunOptions } from '../startup/args-to-options.js';

const SHELL_EXEC_TIMEOUT_MS = 5_000;

async function resolvePrompt(opts: ISessionRunOptions): Promise<string> {
  let prompt = opts.positional.join(' ').trim();

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

  return prompt;
}

export async function runPrintMode(
  opts: ISessionRunOptions,
  runtime: IAgentRuntime,
): Promise<void> {
  const prompt = await resolvePrompt(opts);
  const appendSystemPrompt = buildAppendSystemPrompt(runtime.cwd, opts);

  // TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
  if (opts.systemPrompt) {
    process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
  }

  const shellExec = (command: string): string =>
    execSync(command, {
      timeout: SHELL_EXEC_TIMEOUT_MS,
      encoding: 'utf-8',
      stdio: 'pipe',
    }).trimEnd();

  const session = new InteractiveSession({
    cwd: runtime.cwd,
    provider: runtime.provider,
    permissionMode: opts.permissionMode ?? 'bypassPermissions',
    maxTurns: opts.maxTurns,
    sessionStore: opts.noSessionPersistence ? undefined : runtime.sessionStore,
    sessionName: opts.sessionName,
    bare: opts.bare || undefined,
    allowedTools: opts.allowedTools
      ? opts.allowedTools
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined,
    appendSystemPrompt,
    backgroundTaskRunners: runtime.backgroundTaskRunners,
    subagentRunnerFactory: runtime.subagentRunnerFactory,
    commandModules: runtime.commandModules,
    commandHostAdapters: runtime.commandHostAdapters,
    shellExec,
    agentName: 'robota-cli',
  });

  const transport = createHeadlessTransport({
    outputFormat: opts.outputFormat ?? 'text',
    prompt,
  });
  session.attachTransport(transport);
  await transport.start();
  await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless transport complete' });
  process.exit(transport.getExitCode());
}
