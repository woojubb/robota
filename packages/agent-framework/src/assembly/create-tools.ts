/**
 * Default tool set factory — creates the standard set of CLI tools.
 */

import {
  createAskUserQuestionTool,
  createShellTool,
  createBashTool,
  createReadTool,
  createWriteTool,
  createEditTool,
  createGlobTool,
  createGrepTool,
  webFetchTool,
  webSearchTool,
} from '@robota-sdk/agent-tools';

import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type { ISandboxClient } from '@robota-sdk/agent-tools';

/** Human-readable descriptions of the built-in tools (for system prompt) */
export const DEFAULT_TOOL_DESCRIPTIONS = [
  'Shell — execute host shell commands (OS-aware: bash/PowerShell)',
  'Bash — alias of Shell (model-familiar name)',
  'Read — read file contents with line numbers',
  'Write — write content to a file',
  'Edit — replace a string in a file',
  'Glob — find files matching a pattern',
  'Grep — search file contents with regex',
  'WebFetch — fetch URL content as text',
  'WebSearch — search the internet through the configured local tool',
  'AskUserQuestion — ask the user structured questions (options/multi-select/free text) mid-task',
];

/**
 * Create the default set of CLI tools.
 * Returns the standard tools as IToolWithEventService[].
 */
export interface ICreateDefaultToolsOptions {
  sandboxClient?: ISandboxClient;
  cwd?: string;
}

export function createDefaultTools(
  options: ICreateDefaultToolsOptions = {},
): IToolWithEventService[] {
  return [
    createShellTool(options) as IToolWithEventService,
    createBashTool(options) as IToolWithEventService,
    createReadTool(options) as IToolWithEventService,
    createWriteTool(options) as IToolWithEventService,
    createEditTool(options) as IToolWithEventService,
    createGlobTool(options) as IToolWithEventService,
    createGrepTool(options) as IToolWithEventService,
    webFetchTool as IToolWithEventService,
    webSearchTool as IToolWithEventService,
    createAskUserQuestionTool() as IToolWithEventService,
  ];
}
