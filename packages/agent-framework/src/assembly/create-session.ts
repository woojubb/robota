/**
 * Session factory — assembles a fully-configured Session from config, context,
 * tools, and provider.
 */

import { join } from 'node:path';

import { Session } from '@robota-sdk/agent-session';

import {
  buildAgentRuntime,
  buildBackgroundProcessTool,
  buildSessionSystemPrompt,
  wireSessionDeps,
} from './create-session-runtime.js';
import { createDefaultTools, DEFAULT_TOOL_DESCRIPTIONS } from './create-tools.js';
import { wrapEditCheckpointTools } from '../checkpoints/edit-checkpoint-tools.js';
import { SkillCommandSource } from '../commands/skill-source.js';
import { readSettings, writeSettings } from '../config/settings-io.js';
import { AgentExecutor } from '../hooks/agent-executor.js';
import { PromptExecutor } from '../hooks/prompt-executor.js';
import { wrapReversibleExecutionTools } from '../reversible-execution/index.js';
import {
  createModelCommandToolProjection,
  createProjectedCommandExecutionTools,
} from '../tools/model-command-tool-projection.js';

import type {
  ICreateSessionOptions,
  ICreateSessionResult,
  TSessionConstructorWithAutoCompact,
} from './create-session-types.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { TSessionFactory } from '../hooks/agent-executor.js';
import type { TProviderFactory } from '../hooks/prompt-executor.js';
import type { IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';

export type { ICreateSessionOptions, ICreateSessionResult } from './create-session-types.js';

const ID_RADIX = 36;
const ID_RANDOM_LENGTH = 9;
const DEFAULT_PROVIDER_IDLE_TIMEOUT_MS = 120_000;

function getModelInvocableCommandDescriptors(
  descriptors: readonly ICapabilityDescriptor[] | undefined,
): ICapabilityDescriptor[] {
  return (descriptors ?? []).filter(
    (descriptor) => descriptor.modelInvocable && descriptor.kind === 'builtin-command',
  );
}

function normalizeCommandDescriptorName(name: string): string {
  return name.trim().replace(/^\/+/, '').split(/\s+/)[0] ?? '';
}

function hasModelInvocableCommandDescriptor(
  descriptors: readonly ICapabilityDescriptor[],
  name: string,
): boolean {
  return descriptors.some((descriptor) => normalizeCommandDescriptorName(descriptor.name) === name);
}

/**
 * Create a fully-configured Session instance.
 *
 * Assembles provider, tools, and system prompt, then passes them
 * to Session as pre-constructed dependencies.
 */
export function createSession(options: ICreateSessionOptions): ICreateSessionResult {
  if (!options.provider) {
    throw new Error(
      'provider is required. SDK is provider-neutral — consumer must create and pass a provider instance.',
    );
  }
  const provider = options.provider;
  const cwd = options.cwd ?? process.cwd();
  const sessionId = options.sessionId ?? createSessionId();
  const skillCommandSource = new SkillCommandSource(cwd);
  const modelInvocableCommandDescriptors = getModelInvocableCommandDescriptors(
    options.commandDescriptors,
  );
  const modelCommandToolsEnabled =
    modelInvocableCommandDescriptors.length > 0 &&
    options.modelCommandExecutor !== undefined &&
    options.isModelCommandInvocable !== undefined;
  const modelCommandToolProjection = modelCommandToolsEnabled
    ? createModelCommandToolProjection(modelInvocableCommandDescriptors)
    : undefined;
  const modelVisibleSkills = hasModelInvocableCommandDescriptor(
    modelInvocableCommandDescriptors,
    'skills',
  )
    ? skillCommandSource.getModelInvocableSkills()
    : [];

  const baseDefaultTools = createDefaultTools({ sandboxClient: options.sandboxClient, cwd });
  const shouldWrapHostEditCheckpoints =
    options.editCheckpointRecorder !== undefined && options.sandboxClient === undefined;
  const defaultTools =
    shouldWrapHostEditCheckpoints && options.editCheckpointRecorder
      ? wrapEditCheckpointTools(baseDefaultTools, options.editCheckpointRecorder)
      : baseDefaultTools;
  const assembledTools = [...defaultTools, ...(options.additionalTools ?? [])];
  const reversibleExecution = options.reversibleExecution
    ? {
        ...options.reversibleExecution,
        isolation:
          options.reversibleExecution.isolation ??
          (options.sandboxClient ? ('provider-sandbox' as const) : undefined),
      }
    : undefined;
  const tools: IToolWithEventService[] = reversibleExecution
    ? wrapReversibleExecutionTools(assembledTools, {
        ...reversibleExecution,
        checkpointAvailable: shouldWrapHostEditCheckpoints,
      })
    : assembledTools;
  if (
    modelCommandToolsEnabled &&
    options.modelCommandExecutor !== undefined &&
    options.isModelCommandInvocable !== undefined
  ) {
    tools.push(
      ...createProjectedCommandExecutionTools({
        execute: options.modelCommandExecutor,
        isModelInvocable: options.isModelCommandInvocable,
        commandDescriptors: modelInvocableCommandDescriptors,
      }),
    );
  }

  const hookTypeExecutors: IHookTypeExecutor[] = [];
  if (options.providerFactory) {
    hookTypeExecutors.push(
      new PromptExecutor({
        providerFactory: options.providerFactory,
        defaultModel: options.config.provider.model,
      }),
    );
  }
  if (options.sessionFactory) {
    hookTypeExecutors.push(new AgentExecutor({ sessionFactory: options.sessionFactory }));
  }
  if (options.additionalHookExecutors) {
    hookTypeExecutors.push(...options.additionalHookExecutors);
  }

  const { agentToolDeps, agentDefinitions, backgroundTaskManager } = buildAgentRuntime(
    options,
    sessionId,
    cwd,
    provider,
    tools,
    hookTypeExecutors,
  );

  const { backgroundProcessToolDeps } = buildBackgroundProcessTool(
    options,
    backgroundTaskManager,
    sessionId,
    cwd,
    tools,
  );

  const { finalSystemMessage, rebuildSystemMessage } = buildSessionSystemPrompt(
    options,
    cwd,
    modelInvocableCommandDescriptors,
    modelCommandToolProjection,
    backgroundProcessToolDeps,
    modelVisibleSkills,
    agentDefinitions,
  );

  const defaultAllow = [
    'Read(.agents/**)',
    'Read(.claude/**)',
    'Read(.robota/**)',
    'Glob(.agents/**)',
    'Glob(.claude/**)',
    'Glob(.robota/**)',
  ];

  // Commands with requiresPermission: false are auto-approved — no prompt needed.
  const commandAutoAllow = modelCommandToolProjection
    ? modelCommandToolProjection.commandTools
        .filter((t) => !t.requiresPermission)
        .map((t) => t.toolName)
    : [];

  const allowedToolPatterns = (options.allowedTools ?? []).map((name) => `${name}(*)`);
  const deniedToolPatterns = (options.deniedTools ?? []).map((name) => `${name}(*)`);
  const mergedPermissions = {
    allow: [
      ...defaultAllow,
      ...commandAutoAllow,
      ...(options.config.permissions.allow ?? []),
      ...allowedToolPatterns,
    ],
    deny: [...(options.config.permissions.deny ?? []), ...deniedToolPatterns],
  };

  const projectSettingsPath = join(cwd, '.robota', 'settings.local.json');
  function onProjectAllowTool(toolName: string): void {
    const pattern = `${toolName}(*)`;
    const settings = readSettings(projectSettingsPath);
    const currentAllow = Array.isArray(settings.permissions)
      ? []
      : (((settings.permissions as Record<string, unknown> | undefined)?.allow as
          | string[]
          | undefined) ?? []);
    if (!currentAllow.includes(pattern)) {
      writeSettings(projectSettingsPath, {
        ...settings,
        permissions: {
          ...((settings.permissions as Record<string, unknown>) ?? {}),
          allow: [...currentAllow, pattern],
        },
      });
    }
  }

  const SessionWithAutoCompact = Session as TSessionConstructorWithAutoCompact;
  const session = new SessionWithAutoCompact({
    tools,
    provider,
    systemMessage: finalSystemMessage,
    terminal: options.terminal,
    permissions: mergedPermissions,
    hooks: options.config.hooks,
    permissionMode: options.permissionMode,
    defaultTrustLevel: options.config.defaultTrustLevel,
    model: options.model ?? options.config.provider.model,
    providerTimeout: options.config.provider.timeout ?? DEFAULT_PROVIDER_IDLE_TIMEOUT_MS,
    maxTurns: options.maxTurns,
    sessionStore: options.sessionStore,
    sessionId,
    permissionHandler: options.permissionHandler,
    onProjectAllowTool,
    onTextDelta: options.onTextDelta,
    onContextUpdate: options.onContextUpdate,
    onToolExecution: options.onToolExecution,
    promptForApproval: options.promptForApproval,
    onCompact: options.onCompact,
    onCompactEvent: options.onCompactEvent,
    compactInstructions: options.compactInstructions ?? options.context.compactInstructions,
    autoCompactThreshold: options.autoCompactThreshold ?? options.config.autoCompactThreshold,
    sessionLogger: options.sessionLogger,
    hookTypeExecutors: hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
    agentName: options.agentName,
  });

  wireSessionDeps(session, agentToolDeps, backgroundProcessToolDeps, backgroundTaskManager);

  return { session, rebuildSystemMessage };
}

function createSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
}
