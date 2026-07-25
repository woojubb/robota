/**
 * Session factory — assembles a fully-configured Session from config, context,
 * tools, and provider.
 */

import { join } from 'node:path';

import { GuardrailExecutor } from '@robota-sdk/agent-core';
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
import { createGoalStatusTool } from '../goal/index.js';
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
import type {
  IToolWithEventService,
  IHookTypeExecutor,
  THooksConfig,
  TGuardrail,
} from '@robota-sdk/agent-core';

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
/**
 * SELFHOST-005: ensure a guardrail hook definition exists when guardrails are registered, so the
 * `GuardrailExecutor` actually fires. Appends a `PreToolUse` guardrail group (matcher '' = all tools)
 * unless a guardrail hook is already declared anywhere in the config (idempotent — no double-run).
 */
function resolveGuardrailHooks(
  hooks: THooksConfig | undefined,
  guardrails: Record<string, TGuardrail> | undefined,
): THooksConfig | undefined {
  if (!guardrails || Object.keys(guardrails).length === 0) return hooks;
  const alreadyDeclared = Object.values(hooks ?? {}).some((groups) =>
    groups?.some((group) => group.hooks.some((hook) => hook.type === 'guardrail')),
  );
  if (alreadyDeclared) return hooks;
  return {
    ...hooks,
    PreToolUse: [...(hooks?.PreToolUse ?? []), { matcher: '', hooks: [{ type: 'guardrail' }] }],
  };
}

/**
 * ARCH-006 — collapse the assembled tool list to one entry per tool NAME.
 *
 * Precedence: the FIRST occurrence of a name wins, over the fixed tier order
 * `defaultTools ⊕ additionalTools ⊕ goalTool`. This is the same "first entry for a name wins" rule
 * `AgentDefinitionLoader` already applies within the subagent built-in tier.
 *
 * So a contributed tool whose name is NEW is additive (the axis stays open), and a contributed tool whose
 * name collides with a framework default is DROPPED rather than listed twice — it does not silently
 * displace the default. That direction is deliberate: the default tier is built with the session context
 * (`cwd` supplies the working-directory path guard, plus the sandbox client and retrieval adapter), and a
 * context-free contribution replacing it would silently weaken those guarantees. Replacement stays fully
 * expressible — through the EXPLICIT `defaultTools` injection seam, never as a side effect of a collision.
 * That mirrors `mergeCapabilityPacks`' own rule: additive merge, never a silent override.
 */
function dedupeToolsByName(tools: readonly IToolWithEventService[]): IToolWithEventService[] {
  const seen = new Set<string>();
  const deduped: IToolWithEventService[] = [];
  for (const tool of tools) {
    const name = tool.getName();
    if (seen.has(name)) continue;
    seen.add(name);
    deduped.push(tool);
  }
  return deduped;
}

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

  // ARCH-006: the default tool tier is INJECTABLE. `options.defaultTools` REPLACES
  // `createDefaultTools()` outright (an empty array suppresses every framework default), mirroring
  // NEUT-003's `builtInAgents` seam for subagents. Absent ⇒ the framework tier is constructed exactly as
  // before, WITH the session context (cwd → the working-directory path guard, sandbox client, retrieval
  // adapter) — which is why a name collision must never silently displace it (see `dedupeToolsByName`).
  const defaultTools =
    options.defaultTools ??
    createDefaultTools({
      sandboxClient: options.sandboxClient,
      cwd,
      ...(options.retrievalAdapter ? { retrievalAdapter: options.retrievalAdapter } : {}),
    });
  const shouldWrapHostEditCheckpoints =
    options.editCheckpointRecorder !== undefined && options.sandboxClient === undefined;
  const dedupedTools = dedupeToolsByName([
    ...defaultTools,
    ...(options.additionalTools ?? []),
    ...(options.includeGoalTool ? [createGoalStatusTool()] : []),
  ]);
  // The edit-checkpoint wrap covers the ASSEMBLED set, not just the default tier: once a product can hand
  // the tool axis to its capability packs (`defaultTools: []` + pack-supplied `additionalTools`), a
  // contributed `Write`/`Edit` must still be checkpointed. With no contributed Write/Edit this is
  // byte-identical to wrapping the default tier alone.
  const assembledTools =
    shouldWrapHostEditCheckpoints && options.editCheckpointRecorder
      ? wrapEditCheckpointTools(dedupedTools, options.editCheckpointRecorder)
      : dedupedTools;
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
  if (options.guardrails && Object.keys(options.guardrails).length > 0) {
    // SELFHOST-005: register the guardrail executor so a { type: 'guardrail' } hook definition runs
    // the consumer's guardrail set in parallel and fails the turn fast via the existing blocked path.
    hookTypeExecutors.push(new GuardrailExecutor(options.guardrails));
  }
  if (options.additionalHookExecutors) {
    hookTypeExecutors.push(...options.additionalHookExecutors);
  }

  // SELFHOST-005: registering guardrails only adds the EXECUTOR; the guardrail set fires only if a
  // { type: 'guardrail' } hook definition exists on an enforcing event. When guardrails are registered
  // and the config declares none, auto-inject a PreToolUse guardrail group (matcher '' = all tools) so
  // the gate actually runs — otherwise P3 would be inert. Idempotent: skipped if the user already
  // declared a guardrail hook.
  const resolvedHooks = resolveGuardrailHooks(options.config.hooks, options.guardrails);

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
          string[] | undefined) ?? []);
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
    hooks: resolvedHooks,
    permissionMode: options.permissionMode,
    defaultTrustLevel: options.config.defaultTrustLevel,
    model: options.model ?? options.config.provider.model,
    providerTimeout: options.config.provider.timeout ?? DEFAULT_PROVIDER_IDLE_TIMEOUT_MS,
    maxTurns: options.maxTurns,
    sessionStore: options.sessionStore,
    sessionId,
    permissionHandler: options.permissionHandler,
    // CMD-005: model-invoked tools solicit structured answers through this port.
    ...(options.ask ? { ask: options.ask } : {}),
    onProjectAllowTool,
    onTextDelta: options.onTextDelta,
    onContextUpdate: options.onContextUpdate,
    onToolExecution: options.onToolExecution,
    promptForApproval: options.promptForApproval,
    onCompact: options.onCompact,
    onCompactEvent: options.onCompactEvent,
    compactInstructions: options.compactInstructions ?? options.context.compactInstructions,
    contextCapacityHint: options.contextCapacityHint,
    autoCompactThreshold: options.autoCompactThreshold ?? options.config.autoCompactThreshold,
    sessionLogger: options.sessionLogger,
    hookTypeExecutors: hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
    agentName: options.agentName,
    ...(options.activePresetId !== undefined ? { activePresetId: options.activePresetId } : {}),
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
  });
  wireSessionDeps(session, agentToolDeps, backgroundProcessToolDeps, backgroundTaskManager);

  return { session, rebuildSystemMessage };
}

function createSessionId(): string {
  return `session_${Date.now()}_${Math.random().toString(ID_RADIX).substr(2, ID_RANDOM_LENGTH)}`;
}
