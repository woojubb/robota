import { loadConfig } from '../cli-config/config-loader.js';
import { loadContext } from '../cli-context/context-loader.js';
import { detectProject } from '../cli-context/project-detector.js';
import { Session } from './session.js';
import type { IToolWithEventService } from '../abstracts/abstract-tool.js';
import type { IResolvedConfig } from '../cli-config/config-types.js';
import type { ILoadedContext } from '../cli-context/context-loader.js';
import type { IProjectInfo } from '../cli-context/project-detector.js';
import type { TPermissionMode } from '../cli-permissions/types.js';
import type { IAIProvider } from '../interfaces/provider.js';
import type { TToolArgs } from '../cli-permissions/permission-gate.js';

export interface IQueryOptions {
  cwd?: string;
  permissionMode?: TPermissionMode;
  maxTurns?: number;
  provider?: IAIProvider;
  /** Factory to create the default AI provider when no provider is given */
  providerFactory?: (apiKey: string) => IAIProvider;
  /** Factory that creates CLI tools (injected to break circular dependency) */
  toolsFactory?: (
    config: IResolvedConfig,
    context: ILoadedContext,
    projectInfo?: IProjectInfo,
  ) => IToolWithEventService[];
  permissionHandler?: (toolName: string, toolArgs: TToolArgs) => Promise<boolean>;
  onTextDelta?: (delta: string) => void;
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

  const session = new Session({
    config,
    context,
    terminal: noopTerminal,
    projectInfo,
    permissionMode: options?.permissionMode ?? 'bypassPermissions',
    maxTurns: options?.maxTurns,
    provider: options?.provider,
    providerFactory: options?.providerFactory,
    toolsFactory: options?.toolsFactory,
    permissionHandler: options?.permissionHandler,
    onTextDelta: options?.onTextDelta,
  });

  return session.run(prompt);
}
