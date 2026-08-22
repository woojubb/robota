/**
 * Session factory — assembles a fully-configured Session from config, context,
 * tools, and provider.
 */

import { randomUUID } from 'node:crypto';
import { join } from 'node:path';

import { applyPresetToolLists, GuardrailExecutor } from '@robota-sdk/agent-core';
import { Session } from '@robota-sdk/agent-session';

import { assembleSessionTools } from './assemble-session-tools.js';
import {
  buildAgentRuntime,
  buildBackgroundProcessTool,
  buildSessionSystemPrompt,
  wireSessionDeps,
} from './create-session-runtime.js';
import { SkillCommandSource } from '../commands/skill-source.js';
import { readSettings, writeSettings } from '../config/settings-io.js';
import { AgentExecutor } from '../hooks/agent-executor.js';
import { PromptExecutor } from '../hooks/prompt-executor.js';
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
 * ARCH-035 made this async. The default tool tier now lives in `@robota-sdk/agent-tool-defaults` and is
 * reached by dynamic import, which is what keeps a static edge to a composition leaf out of this
 * package — see `assembleSessionTools`. The propagation stops one hop up: the only in-repo caller is
 * `createInteractiveSession`, already async.
 *
 * `IAgentRuntime.createSession` is NOT affected and must stay synchronous. It does not call this
 * function — it constructs `InteractiveSession` directly and the assembly happens later inside
 * `initializeInteractiveSessionAsync`. That indirection is load-bearing rather than incidental:
 * propagating async through it would break every consumer that builds a session without supplying
 * `defaultTools`, which is the zero-config contract this whole extraction exists to preserve.
 */
export async function createSession(options: ICreateSessionOptions): Promise<ICreateSessionResult> {
  if (!options.provider) {
    throw new Error(
      'provider is required. SDK is provider-neutral — consumer must create and pass a provider instance.',
    );
  }
  const provider = options.provider;
  const cwd = options.cwd ?? process.cwd();
  const sessionId = options.sessionId ?? createSessionId();
  const skillCommandSource = new SkillCommandSource(options.contributionSources ?? []);
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
    options.commandSemanticRoles?.skillActivation ?? '',
  )
    ? skillCommandSource.getModelInvocableSkills()
    : [];

  const { tools } = await assembleSessionTools(options, cwd);
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

  // ARCH-040 Group C (issue #1934): one translation, shared with the live `/preset` re-application,
  // so the two paths cannot disagree about what the same preset permits.
  // The rules independent of any preset. Kept as its own value because the enforcer needs it to
  // re-apply a preset live: deriving it later from `mergedPermissions` would already include this
  // preset's patterns, and the first preset's allowlist would then survive every later switch.
  const presetFreePermissions = {
    allow: [...defaultAllow, ...commandAutoAllow, ...(options.config.permissions.allow ?? [])],
    deny: options.config.permissions.deny ?? [],
  };
  const mergedPermissions = applyPresetToolLists(presetFreePermissions, options);

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
    // ARCH-010: the same root the tools, hooks and skill source were bound to above. It used to be
    // computed here and then re-derived inside `Session` from `process.cwd()`, so the two could
    // disagree the moment a caller supplied `options.cwd`.
    cwd,
    permissions: mergedPermissions,
    presetFreePermissions,
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
    transcriptPath: options.transcriptPath,
    hookTypeExecutors: hookTypeExecutors.length > 0 ? hookTypeExecutors : undefined,
    agentName: options.agentName,
    ...(options.activePresetId !== undefined ? { activePresetId: options.activePresetId } : {}),
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
  });
  wireSessionDeps(session, agentToolDeps, backgroundProcessToolDeps, backgroundTaskManager);

  return { session, rebuildSystemMessage };
}

function createSessionId(): string {
  return `session_${randomUUID()}`;
}
