/**
 * Compose one personal-agent session from the SDK: a provider, the default file and web tools
 * confined to the agent's own workspace, the personal capabilities, and a session store under the
 * agent's state directory.
 *
 * What the agent does comes from the capabilities handed in; this module only decides how a local
 * host lends them a place to run. The host shell is not offered: a personal agent acts through its
 * own tools, and a command line would be a way around every boundary those tools keep. A test
 * holds that no tool the model is offered runs commands.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { createNodeFrameworkHost } from '@robota-sdk/agent-framework/node';
import { createDefaultTools } from '@robota-sdk/agent-tools/defaults';

import { createPersonalSessionStore } from './session-stores.js';

import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';
import type { IAgentRuntime } from '@robota-sdk/agent-framework';

/**
 * Tools a personal agent withholds from the model entirely: every way to run a host command
 * (`Bash`, `Shell`, `BackgroundProcess`), and sending files to other agent sessions, which a personal
 * agent does not do.
 */
export const PERSONAL_WITHHELD_TOOLS = ['Bash', 'Shell', 'BackgroundProcess', 'peer_send_file'] as const;

export interface IPersonalAgentOptions {
  readonly stateDir: string;
  readonly provider: IAIProvider;
  /** The model the provider profile names, shown to the person and sent to the provider. */
  readonly model?: string;
  /** Capabilities the personal pack contributes. */
  readonly tools?: readonly IToolWithEventService[];
  /** Text appended to the system prompt, such as the pack's own instructions. */
  readonly instructions?: string;
  readonly permissionMode?: TPermissionMode;
}

export interface IPersonalAgent {
  readonly runtime: IAgentRuntime;
  readonly session: ReturnType<IAgentRuntime['createSession']>;
  /** The directory the agent's file tools are confined to. */
  readonly workspace: string;
}

export function createPersonalAgent(options: IPersonalAgentOptions): IPersonalAgent {
  const workspace = join(options.stateDir, 'workspace');
  mkdirSync(workspace, { recursive: true, mode: 0o700 });
  const runtime = createAgentRuntime({
    host: createNodeFrameworkHost({ createDefaultTools }),
    cwd: workspace,
    provider: options.provider,
    sessionStore: createPersonalSessionStore(options.stateDir),
  });
  const session = runtime.createSession({
    permissionMode: options.permissionMode ?? 'acceptEdits',
    deniedTools: [...PERSONAL_WITHHELD_TOOLS],
    ...(options.model !== undefined && { model: options.model }),
    ...(options.tools !== undefined && { additionalTools: [...options.tools] }),
    ...(options.instructions !== undefined && { appendSystemPrompt: options.instructions }),
  });
  return { runtime, session, workspace };
}
