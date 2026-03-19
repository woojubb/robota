/**
 * AgentTool — spawn a sub-agent with isolated context.
 *
 * Creates a new Session instance with a fresh conversation, runs the
 * given prompt, and returns the sub-agent's response. The sub-agent
 * shares the same config and context but has its own conversation history.
 */

import { z } from 'zod';
import { createZodFunctionTool } from '@robota-sdk/agent-tools';
import type { TToolParameters } from '../interfaces/tool.js';
import type { TToolResult } from '../cli-permissions/types.js';
import type { IAIProvider } from '../interfaces/provider.js';
import type { IResolvedConfig } from '../cli-config/config-types.js';
import type { ILoadedContext } from '../cli-context/context-loader.js';
import type { IProjectInfo } from '../cli-context/project-detector.js';
import { Session } from '../cli-session/session.js';
import { asZodSchema } from './schema-cast.js';

const AgentSchema = z.object({
  prompt: z.string().describe('Task description for the sub-agent'),
  description: z
    .string()
    .optional()
    .describe('Short description of what the sub-agent will do (3-5 words)'),
});

type TAgentArgs = z.infer<typeof AgentSchema>;

/** Dependencies injected at registration time */
export interface IAgentToolDeps {
  config: IResolvedConfig;
  context: ILoadedContext;
  projectInfo?: IProjectInfo;
  /** Factory to create the default AI provider */
  providerFactory?: (apiKey: string) => IAIProvider;
}

let agentToolDeps: IAgentToolDeps | undefined;

/** Set dependencies for the agent tool. Must be called before tool is used. */
export function setAgentToolDeps(deps: IAgentToolDeps): void {
  agentToolDeps = deps;
}

async function runAgent(args: TAgentArgs): Promise<string> {
  if (!agentToolDeps) {
    const result: TToolResult = {
      success: false,
      output: '',
      error: 'Agent tool not initialized — missing dependencies',
    };
    return JSON.stringify(result);
  }

  const subSession = new Session({
    config: agentToolDeps.config,
    context: agentToolDeps.context,
    projectInfo: agentToolDeps.projectInfo,
    // No terminal needed — sub-agents don't prompt for permissions
    terminal: {
      write: () => {},
      writeLine: () => {},
      writeMarkdown: () => {},
      writeError: () => {},
      prompt: () => Promise.resolve(''),
      select: () => Promise.resolve(0),
      spinner: () => ({ stop: () => {}, update: () => {} }),
    },
    // Sub-agents bypass permissions — they inherit parent's trust
    permissionMode: 'bypassPermissions',
    providerFactory: agentToolDeps.providerFactory,
  });

  try {
    const response = await subSession.run(args.prompt);
    const result: TToolResult = {
      success: true,
      output: response,
    };
    return JSON.stringify(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const result: TToolResult = {
      success: false,
      output: '',
      error: `Sub-agent error: ${message}`,
    };
    return JSON.stringify(result);
  }
}

export const agentTool = createZodFunctionTool(
  'Agent',
  'Spawn a sub-agent with isolated context to handle a task. The sub-agent has its own conversation history and can use all tools.',
  asZodSchema(AgentSchema),
  async (params: TToolParameters) => {
    return runAgent(params as TAgentArgs);
  },
);
