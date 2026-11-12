/**
 * Session factory — assembles a fully-configured Session from config, context,
 * tools, and provider.
 */

import { applyPresetToolLists, randomId } from '@robota-sdk/agent-core';
import { Session } from '@robota-sdk/agent-session';

import { hostSessionPorts } from './host-session-ports.js';
import { requireFrameworkHost } from '../host/require-framework-host.js';
import { sandboxApprovalFor } from './sandbox-approval.js';
import { sessionAdvisorAccess } from '../advisor/advisor-tool.js';
import { createModelPermissionClassifier } from './model-permission-classifier.js';

import { assembleSessionTools } from './assemble-session-tools.js';
import { buildHookTypeExecutors } from './build-hook-type-executors.js';
import {
  buildAgentRuntime,
  buildBackgroundProcessTool,
  buildSessionSystemPrompt,
  buildToolCallHandoff,
  wireSessionDeps,
} from './create-session-runtime.js';
import { assertConfiguredHookTypesExecutable } from './hook-type-reachability.js';
import { mergeSkillCommands, SkillCommandSource } from '../commands/skill-source.js';
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
import type { IHookDefinitionSource } from '../config/config-merge.js';
import type { THooksConfig, TGuardrail } from '@robota-sdk/agent-core';

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
 * Ensure a guardrail hook definition exists when guardrails are registered, so the
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
 * Create a fully-configured Session instance.
 *
 * Returns a promise so a failed assembly rejects instead of throwing, whatever step it failed in: a
 * caller builds a session at the end of an async chain and handles one failure shape. Nothing inside
 * awaits.
 *
 * `IAgentRuntime.createSession` is a different function and stays synchronous: it constructs
 * `InteractiveSession` directly, and this assembly runs later inside
 * `initializeInteractiveSessionAsync`.
 */
export async function createSession(
  options: ICreateSessionOptions,
  hookSources: readonly IHookDefinitionSource[] = [],
): Promise<ICreateSessionResult> {
  requireFrameworkHost(options.host, 'createSession');
  if (!options.provider) {
    throw new Error(
      'provider is required. SDK is provider-neutral — consumer must create and pass a provider instance.',
    );
  }
  const provider = options.provider;
  const { cwd } = options;
  const sessionId = options.sessionId ?? createSessionId();
  const skillCommandSource = new SkillCommandSource(
    options.contributionSources ?? [],
    options.skillRoots ?? [],
  );
  const modelInvocableCommandDescriptors = getModelInvocableCommandDescriptors(
    options.commandDescriptors,
  );
  const modelCommandToolsEnabled =
    modelInvocableCommandDescriptors.length > 0 &&
    options.modelCommandExecutor !== undefined &&
    options.isModelCommandInvocable !== undefined;
  const modelCommandToolProjection = modelCommandToolsEnabled
    ? createModelCommandToolProjection(
        modelInvocableCommandDescriptors,
        options.modelCommandToolPrefix,
      )
    : undefined;
  const modelVisibleSkills = hasModelInvocableCommandDescriptor(
    modelInvocableCommandDescriptors,
    options.commandSemanticRoles?.skillActivation ?? '',
  )
    ? mergeSkillCommands(
        skillCommandSource.getCommands(),
        options.pluginSkills ?? [],
      ).filter((skill) => skill.disableModelInvocation !== true)
    : [];

  let assembledSession: Session | undefined;
  const { tools, wrapAdded } = assembleSessionTools(options, cwd, () =>
    assembledSession === undefined
      ? undefined
      : sessionAdvisorAccess(assembledSession, options.onUsageRecorded),
  );
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
        toolNamePrefix: options.modelCommandToolPrefix,
      }),
    );
  }

  const hookTypeExecutors = buildHookTypeExecutors(options);

  // Registering guardrails only adds the EXECUTOR; the guardrail set fires only if a
  // { type: 'guardrail' } hook definition exists on an enforcing event. When guardrails are registered
  // and the config declares none, auto-inject a PreToolUse guardrail group (matcher '' = all tools) so
  // the gate actually runs — otherwise the guardrail would be inert. Idempotent: skipped if the
  // user already declared a guardrail hook.
  const resolvedHooks = resolveGuardrailHooks(options.config.hooks, options.guardrails);

  // A declared hook type with no executor would validate and then deny every tool
  // call. Refuse it here, before any turn, naming the type and the option it needs.
  assertConfiguredHookTypesExecutable(resolvedHooks, hookTypeExecutors, hookSources);

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

  // Replaces the selected entries in the session-local `tools` array in place.
  buildToolCallHandoff(options, backgroundTaskManager, sessionId, cwd, tools);

  const { finalSystemMessage, systemPromptManifest, rebuildSystemMessage } = buildSessionSystemPrompt(
    options,
    cwd,
    modelInvocableCommandDescriptors,
    modelCommandToolProjection,
    backgroundProcessToolDeps,
    modelVisibleSkills,
    agentDefinitions,
    // The assembled set, so the prompt can name what is deferred (and therefore
    // searchable). Passed here rather than recomputed: this is the list the session actually holds.
    tools,
  );

  // Commands with requiresPermission: false are auto-approved — no prompt needed.
  const commandAutoAllow = modelCommandToolProjection
    ? modelCommandToolProjection.commandTools
        .filter((t) => !t.requiresPermission)
        .map((t) => t.toolName)
    : [];

  // One translation, shared with the live `/preset` re-application,
  // so the two paths cannot disagree about what the same preset permits.
  // The rules independent of any preset. Kept as its own value because the enforcer needs it to
  // re-apply a preset live: deriving it later from `mergedPermissions` would already include this
  // preset's patterns, and the first preset's allowlist would then survive every later switch.
  const presetFreePermissions = {
    allow: [
      ...(options.baselinePermissionAllow ?? []),
      ...commandAutoAllow,
      ...(options.config.permissions.allow ?? []),
    ],
    deny: options.config.permissions.deny ?? [],
  };
  // Ask rules are not a preset's to change; they pass through untouched.
  const mergedPermissions = {
    ...applyPresetToolLists(presetFreePermissions, options),
    ask: [...(options.config.permissions.ask ?? [])],
  };

  // The enforcer hands over the CONSENT SCOPE pattern (`Bash(git *)`,
  // `Read(/w/src/**)`), which is persisted as-is; a bare tool name still widens to `Tool(*)`.
  const persistProjectPermission = options.persistProjectPermission;
  const onProjectAllowTool = persistProjectPermission
    ? (scope: string): void => {
        persistProjectPermission(scope.includes('(') ? scope : `${scope}(*)`);
      }
    : undefined;

  const SessionWithAutoCompact = Session as TSessionConstructorWithAutoCompact;
  const session = new SessionWithAutoCompact({
    pathProtection: options.pathProtection,
    tools,
    ...(options.toolExecutionPolicy !== undefined
      ? { toolExecutionPolicy: options.toolExecutionPolicy }
      : {}),
    wrapAddedTools: wrapAdded,
    provider,
    systemMessage: finalSystemMessage,
    ...(systemPromptManifest !== undefined ? { systemPromptManifest } : {}),
    terminal: options.terminal,
    // The same root the tools, hooks and skill source were bound to above. It used to be
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
    checkpointHistory: options.checkpointHistory,
    sessionId,
    permissionHandler: options.permissionHandler,
    // A sandbox that confines commands in place may let a confined one skip the prompt
    // — for the shell tools it wraps, and no other command-running tool.
    ...(options.sandboxClient?.autoApproves !== undefined
      ? { commandSandbox: sandboxApprovalFor(options.sandboxClient) }
      : {}),
    // `auto` mode asks the session's own model; an organization can turn the mode off.
    ...(options.disableAutoMode === true
      ? {}
      : {
          permissionClassifier: createModelPermissionClassifier(provider, {
            cwd,
            model: options.model ?? options.config.provider.model,
            readGitRemotes: options.host.readGitRemotes,
          }),
        }),
    // Model-invoked tools solicit structured answers through this port.
    ...(options.ask ? { ask: options.ask } : {}),
    ...(onProjectAllowTool === undefined ? {} : { onProjectAllowTool }),
    onTextDelta: options.onTextDelta,
    onThinkingDelta: options.onThinkingDelta,
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
    hookTypeExecutors,
    ...hostSessionPorts(options.host, cwd),
    agentName: options.agentName,
    ...(options.activePresetId !== undefined ? { activePresetId: options.activePresetId } : {}),
    ...(options.responseFormat ? { responseFormat: options.responseFormat } : {}),
    ...(options.effort !== undefined ? { effort: options.effort } : {}),
    ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
    ...(options.maxOutputTokens !== undefined ? { maxOutputTokens: options.maxOutputTokens } : {}),
  });
  assembledSession = session;
  wireSessionDeps(session, agentToolDeps, backgroundProcessToolDeps, backgroundTaskManager);

  return { session, rebuildSystemMessage };
}

/**
 * The id every session this package assembles gets. Exported for the one other producer of a
 * session record — the in-session fork (`interactive-session-fork-record.ts`) — so the
 * `session_<uuid>` form is written here once rather than a second time beside it.
 */
export function createSessionId(): string {
  return `session_${randomId()}`;
}
