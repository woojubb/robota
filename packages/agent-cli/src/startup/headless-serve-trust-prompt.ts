import type { ICliRuntimeContext } from '../product/runtime-context.js';
/**
 * Issue #3282 §3: `the product --serve --open` opens a browser for whoever ran it — unlike a daemon-launched
 * or scripted `--serve`, a person is at this terminal. In an untrusted folder, with a TTY to ask on,
 * this asks the same three-way question `pnpm gui:dev`'s sidecar wrapper (`sidecar-trust.mjs`) asks,
 * instead of refusing outright the way every other headless start does (see
 * `formatHeadlessWorkspaceTrustError`). A scripted or non-TTY `--serve --open` has no one to answer it
 * and keeps that refusal.
 */
import { createInterface } from 'node:readline/promises';

import { canAskToTrust, grantWorkspaceTrust, trustQuestionFor } from './interactive-trust-prompt.js';

import type { TWorkspaceProjectAccess } from '@robota-sdk/agent-framework';

export interface IServeOpenTrustPromptOptions {
  readonly productRuntime: ICliRuntimeContext;
  readonly write?: (text: string) => void;
  readonly ask?: (question: string) => Promise<string>;
  readonly grant?: (cwd: string) => Promise<TWorkspaceProjectAccess>;
}

export type TServeOpenTrustAnswer =
  | { readonly decision: 'trust' | 'restricted'; readonly access: TWorkspaceProjectAccess }
  | { readonly decision: 'quit' };

async function askOnTerminal(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    return await rl.question(question);
  } finally {
    rl.close();
  }
}

/** Whether this run can offer the question: an untrusted folder, and a TTY on both streams to ask on. */
export function canAskServeOpenTrustQuestion(access: TWorkspaceProjectAccess): boolean {
  return canAskToTrust(access) && process.stdin.isTTY === true && process.stdout.isTTY === true;
}

/**
 * Asks, trusts, or starts Restricted — never both refuses AND starts. A state a grant could not change
 * anyway (outside Git, or a store that cannot be read) is not askable: this starts Restricted without a
 * question, exactly as the TUI's own interactive ask ({@link askToTrustWorkspace}) does for the same
 * states, since there is nothing here for a person to decide.
 */
export async function askServeOpenTrustQuestion(
  access: TWorkspaceProjectAccess,
  cwd: string,
  options: IServeOpenTrustPromptOptions,
): Promise<TServeOpenTrustAnswer> {
  const question = trustQuestionFor(access, cwd, options.productRuntime);
  if (question === undefined) return { decision: 'restricted', access };
  const write = options.write ?? ((text: string) => void process.stdout.write(text));
  write(
    [
      `This folder is not trusted: ${question.folder}`,
      `Trusting it lets ${options.productRuntime.config.identity.displayName} load the project's own settings, hooks, plugins, skills, agent ` +
        `definitions, provider overrides and MCP servers. Without it, ${options.productRuntime.config.identity.displayName} starts Restricted.`,
      ...question.loads,
      '',
    ].join('\n'),
  );
  const answer = (
    await (options.ask ?? askOnTerminal)(
      'Trust this folder? [y] trust and start / [r] start Restricted / [N] quit: ',
    )
  )
    .trim()
    .toLowerCase();
  if (answer === 'y' || answer === 'yes') {
    try {
      return { decision: 'trust', access: await (options.grant ?? ((path) => grantWorkspaceTrust(path, options.productRuntime)))(cwd) };
    } catch (error) {
      write(
        `Could not record trust (${error instanceof Error ? error.message : String(error)}). ` +
          'Starting Restricted.\n',
      );
      return { decision: 'restricted', access };
    }
  }
  if (answer === 'r' || answer === 'restricted') {
    write('Starting Restricted.\n');
    return { decision: 'restricted', access };
  }
  write(`${options.productRuntime.config.identity.cliName} --serve --open: not started. Trust it later with: ${options.productRuntime.config.identity.cliName} trust --yes\n`);
  return { decision: 'quit' };
}
