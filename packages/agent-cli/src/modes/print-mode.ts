import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';
import { AGENT_CLI_NAME } from '../constants.js';
import { createShellExec } from './shell-exec.js';

import type { ISessionRunOptions } from '../startup/args-to-options.js';
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

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
  const shellExec = createShellExec();

  const session = runtime.createSession({
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
    systemPrompt: opts.systemPrompt,
    shellExec,
    agentName: AGENT_CLI_NAME,
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
