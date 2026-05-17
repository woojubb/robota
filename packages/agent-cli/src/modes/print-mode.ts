import { execSync } from 'node:child_process';
import { InteractiveSession, type IAgentRuntime } from '@robota-sdk/agent-framework';
import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';
import type { IParsedCliArgs } from '../utils/cli-args.js';
import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';

export async function runPrintMode(args: IParsedCliArgs, runtime: IAgentRuntime): Promise<void> {
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

  const appendSystemPrompt = buildAppendSystemPrompt(runtime.cwd, args);

  // TODO: wire --system-prompt once IInteractiveSessionStandardOptions adds systemPrompt field
  if (args.systemPrompt) {
    process.stderr.write('Warning: --system-prompt is not yet functional and will be ignored.\n');
  }

  const shellExec = (command: string) =>
    execSync(command, { timeout: 5000, encoding: 'utf-8', stdio: 'pipe' }).trimEnd();

  const session = new InteractiveSession({
    cwd: runtime.cwd,
    provider: runtime.provider,
    permissionMode: args.permissionMode ?? 'bypassPermissions',
    maxTurns: args.maxTurns,
    sessionStore: args.noSessionPersistence ? undefined : runtime.sessionStore,
    sessionName: args.sessionName,
    bare: args.bare || undefined,
    allowedTools: args.allowedTools
      ? args.allowedTools
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
    outputFormat: args.outputFormat ?? 'text',
    prompt,
  });
  session.attachTransport(transport);
  await transport.start();
  await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless transport complete' });
  process.exit(transport.getExitCode());
}
