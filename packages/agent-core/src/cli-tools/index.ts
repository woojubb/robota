import { bashTool } from './bash-tool.js';
import { readTool } from './read-tool.js';
import { writeTool } from './write-tool.js';
import { editTool } from './edit-tool.js';
import { globTool } from './glob-tool.js';
import { grepTool } from './grep-tool.js';
import { agentTool, setAgentToolDeps } from './agent-tool.js';
import type { IResolvedConfig } from '../cli-config/config-types.js';
import type { ILoadedContext } from '../cli-context/context-loader.js';
import type { IProjectInfo } from '../cli-context/project-detector.js';
import type { IAIProvider } from '../interfaces/provider.js';
import type { IToolWithEventService } from '../abstracts/abstract-tool.js';

export { bashTool, readTool, writeTool, editTool, globTool, grepTool, agentTool, setAgentToolDeps };
export type { IAgentToolDeps } from './agent-tool.js';

/**
 * Create all built-in CLI tools and configure the sub-agent tool dependencies.
 * Used by the CLI entry point as the `toolsFactory` callback for Session.
 * This function is intentionally NOT exported from the main agent-core barrel
 * to avoid circular dependency (cli-tools -> agent-tools -> agent-core).
 */
export function createDefaultTools(
  config: IResolvedConfig,
  context: ILoadedContext,
  projectInfo?: IProjectInfo,
  providerFactory?: (apiKey: string) => IAIProvider,
): IToolWithEventService[] {
  setAgentToolDeps({
    config,
    context,
    projectInfo: projectInfo ?? { type: 'unknown', language: 'unknown' },
    providerFactory,
  });

  return [
    bashTool,
    readTool,
    writeTool,
    editTool,
    globTool,
    grepTool,
    agentTool,
  ] as IToolWithEventService[];
}
