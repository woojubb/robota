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

export type TPersonalSession = ReturnType<IAgentRuntime['createSession']>;

export interface IPersonalAgent {
  readonly runtime: IAgentRuntime;
  readonly session: TPersonalSession;
  /** The directory the agent's file tools are confined to. */
  readonly workspace: string;
  /**
   * Open another session with the same tools and limits, such as one a goal runs in. It may withhold
   * more tools and add instructions, never offer more.
   */
  openSession(extra: IExtraSessionOptions): TPersonalSession;
}

export interface IExtraSessionOptions {
  readonly sessionName: string;
  readonly instructions: string;
  readonly permissionMode: TPermissionMode;
  readonly deniedTools?: readonly string[];
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
  const base = {
    ...(options.model !== undefined && { model: options.model }),
    ...(options.tools !== undefined && { additionalTools: [...options.tools] }),
  };
  const session = runtime.createSession({
    ...base,
    permissionMode: options.permissionMode ?? 'acceptEdits',
    deniedTools: [...PERSONAL_WITHHELD_TOOLS],
    ...(options.instructions !== undefined && { appendSystemPrompt: options.instructions }),
  });
  const openSession = (extra: IExtraSessionOptions): TPersonalSession =>
    runtime.createSession({
      ...base,
      sessionName: extra.sessionName,
      permissionMode: extra.permissionMode,
      deniedTools: [...PERSONAL_WITHHELD_TOOLS, ...(extra.deniedTools ?? [])],
      appendSystemPrompt: [options.instructions, extra.instructions].filter((text) => text !== undefined).join('\n\n'),
    });
  return { runtime, session, workspace, openSession };
}
