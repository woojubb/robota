import { createHeadlessTransport } from '@robota-sdk/agent-transport/headless';

import { buildAppendSystemPrompt } from '../startup/append-system-prompt.js';
import { AGENT_CLI_NAME } from '../constants.js';
import { createShellExec } from './shell-exec.js';

import type { ISessionRunOptions } from '../startup/args-to-options.js';
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

async function resolvePrompt(opts: ISessionRunOptions): Promise<string> {
  const positional = opts.positional.join(' ').trim();

  let stdinContent = '';
  if (!process.stdin.isTTY) {
    const chunks: Buffer[] = [];
    for await (const chunk of process.stdin) {
      chunks.push(chunk as Buffer);
    }
    stdinContent = Buffer.concat(chunks).toString('utf-8').trim();
  }

  let prompt: string;
  if (positional && stdinContent) {
    prompt = `${positional}\n\n<stdin>\n${stdinContent}\n</stdin>`;
  } else {
    prompt = positional || stdinContent;
  }

  if (!prompt) {
    process.stderr.write('Print mode (-p) requires a prompt argument.\n');
    process.exit(1);
  }

  return prompt;
}

const DRY_RUN_SYSTEM_PROMPT =
  'You are in dry-run (plan) mode. Analyze the request and describe step by step what you would do, without executing any write or edit operations. Format your response as a numbered action plan.';

export async function runPrintMode(
  opts: ISessionRunOptions,
  runtime: IAgentRuntime,
): Promise<void> {
  const prompt = await resolvePrompt(opts);

  if (opts.dryRun) {
    process.stdout.write('DRY RUN — plan mode enabled. No files will be modified.\n\n');
  }

  const appendSystemPromptParts: string[] = [];
  if (opts.dryRun) appendSystemPromptParts.push(DRY_RUN_SYSTEM_PROMPT);
  const baseAppend = buildAppendSystemPrompt(runtime.cwd, opts);
  if (baseAppend) appendSystemPromptParts.push(baseAppend);
  const appendSystemPrompt =
    appendSystemPromptParts.length > 0 ? appendSystemPromptParts.join('\n\n') : undefined;
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
    deniedTools: opts.deniedTools
      ? opts.deniedTools
          .split(',')
          .map((t) => t.trim())
          .filter((t) => t.length > 0)
      : undefined,
    model: opts.model,
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
  try {
    await transport.start();
  } catch (err) {
    // allow-fallback: transport failure is terminal — exits with structured code, not a silent fallback
    const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
    const isConfigError =
      msg.includes('api key') || msg.includes('no provider') || msg.includes('provider');
    process.stderr.write(`${err instanceof Error ? err.message : String(err)}\n`);
    process.exit(isConfigError ? 3 : 1);
  }
  await session.shutdown({ reason: 'prompt_input_exit', message: 'Headless transport complete' });
  process.exit(transport.getExitCode());
}
