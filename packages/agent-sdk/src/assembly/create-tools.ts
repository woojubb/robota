/**
 * Default tool set factory — creates the standard set of CLI tools.
 */

import type { IToolWithEventService } from '@robota-sdk/agent-core';
import {
  bashTool,
  readTool,
  writeTool,
  editTool,
  globTool,
  grepTool,
  webFetchTool,
  webSearchTool,
} from '@robota-sdk/agent-tools';

/** Human-readable descriptions of the built-in tools (for system prompt) */
export const DEFAULT_TOOL_DESCRIPTIONS = [
  'Bash — execute shell commands',
  'Read — read file contents with line numbers',
  'Write — write content to a file',
  'Edit — replace a string in a file',
  'Glob — find files matching a pattern',
  'Grep — search file contents with regex',
  'WebSearch — search the internet (Anthropic built-in)',
];

/**
 * Create the default set of CLI tools.
 * Returns the 8 standard tools as IToolWithEventService[].
 */
export function createDefaultTools(): IToolWithEventService[] {
  return [
    bashTool as IToolWithEventService,
    readTool as IToolWithEventService,
    writeTool as IToolWithEventService,
    editTool as IToolWithEventService,
    globTool as IToolWithEventService,
    grepTool as IToolWithEventService,
    webFetchTool as IToolWithEventService,
    webSearchTool as IToolWithEventService,
  ];
}
