/**
 * Compose the personal agent's sessions from the SDK: a provider, the default file and web tools
 * confined to the agent's own workspace, the personal capabilities, and a session store under the
 * agent's state directory. Every chat and every goal run is built from the same tools and limits.
 *
 * What the agent does comes from the capabilities handed in; this module only decides how a local
 * host lends them a place to run. The host shell is not offered: a personal agent acts through its
 * own tools, and a command line would be a way around every boundary those tools keep. A test
 * holds that no tool the model is offered runs commands.
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { createSessionCommandModule } from '@robota-sdk/agent-product/command';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { createNodeFrameworkHost } from '@robota-sdk/agent-framework/node';
import { createDefaultTools } from '@robota-sdk/agent-tools/defaults';
import { CASE_TOOL_NAMES, CONNECTOR_TOOL_NAMES } from '@robota-sdk/agent-product/personal';

import { createPersonalGoalSessionStore, createPersonalSessionStore } from './session-stores.js';

import type { IAIProvider, IToolWithEventService, TPermissionMode } from '@robota-sdk/agent-core';
import type { IAgentRuntime, SessionRecipe } from '@robota-sdk/agent-framework';

/**
 * Tools a personal agent withholds from the model entirely: every way to run a host command
 * (`Bash`, `Shell`, `BackgroundProcess`), and sending files to other agent sessions, which a personal
 * agent does not do.
 */
export const PERSONAL_WITHHELD_TOOLS = [
  'Bash',
  'Shell',
  'BackgroundProcess',
  'peer_send_file',
] as const;

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
  /** The recipe of a chat with the person; every chat a client opens is built from it. */
  chatRecipe(): SessionRecipe;
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
  /**
   * Offer only these tools: every other tool the agent has is withheld. The agent's tools are the
   * host's defaults and the pack's, listed when the agent is built; what a host or the framework adds
   * beyond those is caught by the test that names what each such session is offered.
   */
  readonly onlyTools?: readonly string[];
  /** Replace the existing connector action for this session with a case-scoped implementation. */
  readonly caseAction?: IToolWithEventService;
  /** Replace case mutations with implementations scoped to this answer. */
  readonly caseTools?: readonly IToolWithEventService[];
  /** Where its transcript is kept: among the person's chats, or with the goal runs' audit (the default). */
  readonly keepWith?: 'chats' | 'goals';
}

export function createPersonalAgent(options: IPersonalAgentOptions): IPersonalAgent {
  const host = createNodeFrameworkHost({ createDefaultTools });
  const folder = join(options.stateDir, 'workspace');
  mkdirSync(folder, { recursive: true, mode: 0o700 });
  // A saved chat records this folder as the host spells a real path, and the chat list shows the chats
  // whose recorded folder is the one it is given. Spelled as the state directory spells it, a path
  // that crosses a symlink (macOS keeps its temporary folders and `/tmp` behind one) lists no chats.
  const workspace = host.canonicalizePath?.(folder) ?? folder;
  const runtime = createAgentRuntime({
    host,
    cwd: workspace,
    provider: options.provider,
    sessionStore: createPersonalSessionStore(options.stateDir),
    // Naming a chat is the one session command a personal agent offers: the others change its
    // working folder or open other sessions, which its boundaries and menus own.
    commandModules: [createSessionCommandModule({ only: ['rename'] })],
  });
  const base = {
    ...(options.model !== undefined && { model: options.model }),
    ...(options.tools !== undefined && { additionalTools: [...options.tools] }),
  };
  const chatRecipe = (): SessionRecipe =>
    runtime.sessionRecipe({
      ...base,
      permissionMode: options.permissionMode ?? 'acceptEdits',
      deniedTools: [...PERSONAL_WITHHELD_TOOLS],
      ...(options.instructions !== undefined && { appendSystemPrompt: options.instructions }),
    });
  const goalSessionStore = createPersonalGoalSessionStore(options.stateDir);
  /** Every tool the agent has, by name: the host's own and the pack's. */
  const toolNames = [
    ...createDefaultTools({ cwd: workspace }).map((tool) => tool.getName()),
    ...(options.tools ?? []).map((tool) => tool.getName()),
  ];
  const openSession = (extra: IExtraSessionOptions): TPersonalSession => {
    let additionalTools = options.tools;
    if (extra.caseAction !== undefined) {
      const name = CONNECTOR_TOOL_NAMES.act;
      if (
        extra.caseAction.getName() !== name ||
        extra.onlyTools?.includes(name) !== true ||
        extra.deniedTools?.includes(name) === true ||
        (options.tools ?? []).filter((tool) => tool.getName() === name).length !== 1
      )
        throw new Error('A case action must replace the existing connector action');
      additionalTools = [
        ...(options.tools ?? []).filter((tool) => tool.getName() !== name),
        extra.caseAction,
      ];
    }
    if (extra.caseTools !== undefined) {
      const names = Object.values(CASE_TOOL_NAMES);
      const replacements = extra.caseTools.map((tool) => tool.getName());
      if (
        replacements.length !== names.length ||
        new Set(replacements).size !== names.length ||
        names.some(
          (name) =>
            !replacements.includes(name) ||
            extra.onlyTools?.includes(name) !== true ||
            extra.deniedTools?.includes(name) === true ||
            (additionalTools ?? []).filter((tool) => tool.getName() === name).length !== 1,
        )
      )
        throw new Error('Case tools must replace the existing case tools');
      additionalTools = [
        ...(additionalTools ?? []).filter(
          (tool) => !names.includes(tool.getName() as (typeof names)[number]),
        ),
        ...extra.caseTools,
      ];
    }
    return runtime.createSession({
      ...base,
      ...(additionalTools !== undefined && { additionalTools: [...additionalTools] }),
      sessionStore: extra.keepWith === 'chats' ? runtime.sessionStore : goalSessionStore,
      sessionName: extra.sessionName,
      permissionMode: extra.permissionMode,
      deniedTools: [
        ...PERSONAL_WITHHELD_TOOLS,
        ...(extra.deniedTools ?? []),
        ...(extra.onlyTools === undefined
          ? []
          : toolNames.filter((name) => !extra.onlyTools!.includes(name))),
      ],
      appendSystemPrompt: [options.instructions, extra.instructions]
        .filter((text) => text !== undefined)
        .join('\n\n'),
    });
  };
  return { runtime, chatRecipe, workspace, openSession };
}
