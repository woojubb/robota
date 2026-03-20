/**
 * query() — single entry point for running an AI agent conversation.
 * Automatically loads config, context, and project info.
 */

import type { IAIProvider } from '@robota-sdk/agent-core';
import type { TPermissionMode, TToolArgs } from '@robota-sdk/agent-core';
import { loadConfig } from './config/config-loader.js';
import { loadContext } from './context/context-loader.js';
import { detectProject } from './context/project-detector.js';
import { createSession } from './assembly/create-session.js';
import { promptForApproval } from './permissions/permission-prompt.js';

export interface IQueryOptions {
  cwd?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  provider?: IAIProvider;
  permissionHandler?: (toolName: string, toolArgs: TToolArgs) => Promise<boolean>;
  onTextDelta?: (delta: string) => void;
  /** Callback when context is compacted */
  onCompact?: (summary: string) => void;
}

/**
 * query() — single entry point for running an AI agent conversation.
 * Equivalent to Claude Agent SDK's query() function.
 * Automatically loads config, context, and project info.
 */
export async function query(prompt: string, options?: IQueryOptions): Promise<string> {
  const cwd = options?.cwd ?? process.cwd();

  const [config, context, projectInfo] = await Promise.all([
    loadConfig(cwd),
    loadContext(cwd),
    detectProject(cwd),
  ]);

  // No-op terminal for programmatic use
  const noopTerminal = {
    write: () => {},
    writeLine: () => {},
    writeMarkdown: () => {},
    writeError: () => {},
    prompt: () => Promise.resolve(''),
    select: () => Promise.resolve(0),
    spinner: () => ({ stop: () => {}, update: () => {} }),
  };

  const session = createSession({
    config,
    context,
    terminal: noopTerminal,
    projectInfo,
    permissionMode: options?.permissionMode ?? 'bypassPermissions',
    maxTurns: options?.maxTurns,
    provider: options?.provider,
    permissionHandler: options?.permissionHandler,
    onTextDelta: options?.onTextDelta,
    onCompact: options?.onCompact,
    compactInstructions: context.compactInstructions,
    promptForApproval: promptForApproval,
  });

  return session.run(prompt);
}
