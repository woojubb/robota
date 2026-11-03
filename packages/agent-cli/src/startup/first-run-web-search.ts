/**
 * The first interactive start asks, once, whether to add a web search MCP server.
 *
 * Model-native search needs nothing from the user; every other model gets search only from an MCP
 * server the user picks. The question runs before the session's MCP definitions are resolved, so a
 * chosen server connects in that same session. Only a person at a terminal is asked: print mode,
 * `--serve`, `mcp serve`, ACP and a non-TTY start never reach it.
 */

import { promptInput } from '../cli-input.js';
import {
  WEB_SEARCH_MCP_CATALOG,
  addUserMcpServer,
  describeAddedMcpServer,
} from './mcp-add-server.js';

import type { ITerminalOutput } from '@robota-sdk/agent-core';
import type { IAddUserMcpServerDeps, IWebSearchMcpChoice } from './mcp-add-server.js';

export interface IWebSearchOfferInput extends IAddUserMcpServerDeps {
  /** No `onboarded` marker yet: this is the user's first start. */
  readonly firstRun: boolean;
  /** A person is at a terminal that will show a new interactive session. */
  readonly interactive: boolean;
  readonly terminal: ITerminalOutput;
  readonly read?: typeof promptInput;
}

function questionLabel(): string {
  const skip = WEB_SEARCH_MCP_CATALOG.length + 1;
  const width = Math.max(...WEB_SEARCH_MCP_CATALOG.map((choice) => choice.label.length));
  return [
    '\n  Add web search?',
    '  Models without built-in web search can search the web through an MCP server.',
    '  Your search queries are sent to the service you choose; no API key is needed.',
    ...WEB_SEARCH_MCP_CATALOG.map(
      (choice, index) => `    ${index + 1}. ${choice.label.padEnd(width)}  ${choice.url}`,
    ),
    `    ${skip}. Skip`,
    `  Choose [1-${skip}] (Enter to skip): `,
  ].join('\n');
}

/** A typed number or catalog word picks a service; anything else, including nothing, skips. */
function chosenService(answer: string): IWebSearchMcpChoice | undefined {
  const word = answer.trim().toLowerCase();
  const byNumber = /^[0-9]+$/u.test(word) ? WEB_SEARCH_MCP_CATALOG[Number(word) - 1] : undefined;
  return byNumber ?? WEB_SEARCH_MCP_CATALOG.find((choice) => choice.id === word);
}

/** Ask once on a first interactive start; write and approve the choice before MCP resolves. */
export async function offerWebSearchMcpServer(input: IWebSearchOfferInput): Promise<void> {
  if (!input.firstRun || !input.interactive) return;
  const cliName = input.productRuntime.config.identity.cliName;
  const ids = WEB_SEARCH_MCP_CATALOG.map((choice) => choice.id).join('|');
  let answer: string;
  try {
    answer = await (input.read ?? promptInput)(questionLabel());
  } catch (error) {
    // allow-fallback: an unreadable answer is a skip; startup continues without a search server
    input.terminal.writeError(
      `Web search choice was not read (${error instanceof Error ? error.message : 'unknown error'}). Add one later with: ${cliName} mcp add <${ids}>`,
    );
    return;
  }
  const choice = chosenService(answer);
  if (choice === undefined) {
    input.terminal.writeLine(`Skipped. Add one later with: ${cliName} mcp add <${ids}>`);
    return;
  }
  try {
    const result = addUserMcpServer({ name: choice.id, url: choice.url }, input);
    if (result.outcome === 'refused') {
      input.terminal.writeError(`Web search server "${choice.id}" was not added: ${result.reason}`);
      return;
    }
    input.terminal.writeLine(describeAddedMcpServer(result, cliName, true).trimEnd());
  } catch (error) {
    // allow-fallback: a failed write or approval is reported and startup continues without it
    input.terminal.writeError(
      `Web search server "${choice.id}" was not added: ${error instanceof Error ? error.message : 'unknown error'}`,
    );
  }
}
