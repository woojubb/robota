/**
 * Subagent session factory — assembles an isolated child Session for subagent execution.
 *
 * Unlike `createSession`, this factory does not load config files or context from disk.
 * It receives pre-resolved config and context from the parent session, applies tool
 * filtering and model resolution from the agent definition, and creates a lightweight
 * Session suitable for subagent use.
 */

import { Session } from '@robota-sdk/agent-session';

import { assembleSubagentPrompt } from './subagent-prompts.js';
import { resolveRoleFallbackChain } from '../routing/role-model-routing.js';
import { createProviderSafeModelCommandToolName } from '../tools/model-command-tool-projection.js';

import type { TSubagentSuffix } from './subagent-prompts.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { ISystemCommandSemanticRoles } from '../command-api/index.js';
import type { IResolvedConfig } from '../config/config-types.js';
import type { ILoadedContext } from '../context/context-loader.js';
import type { IToolWithEventService, IHookTypeExecutor } from '@robota-sdk/agent-core';
import type {
  TBackgroundPermissionPolicy,
  TPermissionMode,
  TToolArgs,
} from '@robota-sdk/agent-core';
import type { IAIProvider, TRoleModelMap } from '@robota-sdk/agent-core';
import type {
  ISessionLogger,
  ITerminalOutput,
  TPermissionHandler,
} from '@robota-sdk/agent-session';

/** Model shortcut names mapped to full Anthropic model IDs. */
const MODEL_SHORTCUTS: Record<string, string> = {
  sonnet: 'claude-sonnet-4-6',
  haiku: 'claude-haiku-4-5',
  opus: 'claude-opus-4-6',
};
const LEGACY_AGENT_TOOL_NAME = 'Agent';

/**
 * Issue #2317: the context members a subagent assembly READS, and no others.
 *
 * `parentContext` demanded the parent's whole `ILoadedContext` — seven members, two of them
 * (`agentsFileEntries`, `projectNotesFileEntries`) carrying the full text of every AGENTS.md and
 * CLAUDE.md the parent loaded — while this assembly reads exactly two. Declared structurally, as
 * ARCH-044 did for `parentConfig`: the in-process runner passes its full `ILoadedContext` and
 * satisfies it, and the child-process runner passes a projection carrying only these two, which is
 * what keeps the file contents off the wire.
 */
export interface ISubagentParentContext {
  readonly agentsMd: ILoadedContext['agentsMd'];
  readonly projectNotesMd: ILoadedContext['projectNotesMd'];
}

/** Options for creating a subagent session. */
export interface ISubagentOptions {
  /** Agent definition (built-in or custom). */
  agentDefinition: IAgentDefinition;
  /**
   * ARCH-044 (issue #2047): the config members this assembly READS, not the parent's whole config.
   *
   * Declared structurally so both callers satisfy it — the in-process runner passes its full
   * `IResolvedConfig`, and the child-process runner passes a projection carrying only these. Before
   * this it demanded `IResolvedConfig`, which is why the child's wire payload had to carry the
   * parent's resolved credential and `env` map to typecheck, neither of which anything here reads.
   */
  parentConfig: {
    readonly provider: { readonly model: string };
    readonly permissions: IResolvedConfig['permissions'];
    readonly defaultTrustLevel: IResolvedConfig['defaultTrustLevel'];
    readonly hooks?: IResolvedConfig['hooks'];
  };
  /** The two members of the parent's loaded context this assembly reads (issue #2317). */
  parentContext: ISubagentParentContext;
  /** Parent session's available tools (to inherit/filter). */
  parentTools: IToolWithEventService[];
  /** AI provider instance. */
  provider: IAIProvider;
  /**
   * SELFHOST-006: optional per-role model routing map. When set, a subagent with no explicit `model`
   * alias resolves its model from its role's fallback chain (primary first) keyed by
   * `agentDefinition.role ?? agentDefinition.name`. Rides the existing provider DIP.
   */
  roleModels?: TRoleModelMap;
  /** Terminal output interface. */
  terminal: ITerminalOutput;
  /**
   * The subagent's execution root. REQUIRED — ARCH-010.
   *
   * The spawn contract has always declared it required (`ISubagentSpawnRequest.cwd: string`), but
   * this assembly had no field for it, so the runner could not pass it on and the child session fell
   * back to whatever `process.cwd()` happened to be — the parent's directory, not the subagent's
   * workspace. A worktree-isolated subagent was the case that made that visibly wrong.
   */
  cwd: string;
  /** Stable session ID for transcript files. */
  sessionId?: string;
  /** Optional logger for subagent transcripts. */
  sessionLogger?: ISessionLogger;
  /** Whether this is a fork worker (uses fork suffix instead of standard). */
  isForkWorker?: boolean;
  /**
   * NEUT-003: replaces the framework prompt suffix (string verbatim, or a function
   * of the assembly context). Omitted keeps the documented default suffixes.
   */
  suffix?: TSubagentSuffix;
  /** Permission mode from parent (bypassPermissions, acceptEdits, etc.). */
  permissionMode?: TPermissionMode;
  /**
   * CORE-025: the spawned task's permission policy. Resolved BEFORE the session-mode gate, so
   * `deny`/`preapproved`/`inherit-allowlist` bind even when `permissionMode` would auto-allow. Absent →
   * the inherited session-mode gate alone.
   */
  permissionPolicy?: TBackgroundPermissionPolicy;
  /** CORE-025: the task's OWN declared tool allow/deny lists (what `preapproved` consults). */
  taskAllowedTools?: readonly string[];
  taskDisallowedTools?: readonly string[];
  /** Permission handler from parent. */
  permissionHandler?: TPermissionHandler;
  /** Plugin hooks configuration from parent session. */
  hooks?: Record<string, unknown>;
  /** Hook type executors from parent session (prompt, agent, etc.). */
  hookTypeExecutors?: IHookTypeExecutor[];
  /** Streaming callback. */
  onTextDelta?: (delta: string) => void;
  /** Tool execution callback. */
  onToolExecution?: (event: {
    type: 'start' | 'end';
    toolName: string;
    toolArgs?: TToolArgs;
    success?: boolean;
    denied?: boolean;
    toolResultData?: string;
    executionId?: string;
  }) => void;
  /** Selected command semantic roles inherited from the parent session. */
  commandSemanticRoles?: ISystemCommandSemanticRoles;
}

/**
 * Resolve a model shortcut name to a full model ID.
 * Returns the shortcut mapping if found, otherwise returns the input as-is.
 */
function resolveModelId(shortName: string, _parentModel: string): string {
  return MODEL_SHORTCUTS[shortName] ?? shortName;
}

/**
 * Filter parent tools according to the agent definition's tool constraints.
 *
 * Filtering order:
 * 1. Remove disallowed tools (denylist)
 * 2. Keep only allowed tools (allowlist), if specified
 * 3. Always remove agent-spawning tools (subagents cannot spawn subagents)
 */
function filterTools(
  parentTools: IToolWithEventService[],
  agentDefinition: IAgentDefinition,
  subagentSpawnCommandName: string | undefined,
): IToolWithEventService[] {
  let tools = [...parentTools];

  // Step 1: Remove disallowed tools
  if (agentDefinition.disallowedTools) {
    const denySet = new Set(agentDefinition.disallowedTools);
    tools = tools.filter((t) => !denySet.has(t.getName()));
  }

  // Step 2: Keep only allowed tools (if allowlist specified)
  if (agentDefinition.tools) {
    const allowSet = new Set(agentDefinition.tools);
    tools = tools.filter((t) => allowSet.has(t.getName()));
  }

  // Step 3: Always remove agent-spawning tools
  const projectedSpawnToolName = subagentSpawnCommandName
    ? createProviderSafeModelCommandToolName(subagentSpawnCommandName)
    : undefined;
  tools = tools.filter(
    (tool) =>
      tool.getName() !== LEGACY_AGENT_TOOL_NAME &&
      (projectedSpawnToolName === undefined || tool.getName() !== projectedSpawnToolName),
  );

  return tools;
}

/**
 * Create a fully-configured Session for subagent execution.
 *
 * Assembles provider, tools, and system prompt from parent context and
 * agent definition, then returns a new Session instance.
 */
export function createSubagentSession(options: ISubagentOptions): Session {
  const { agentDefinition, parentConfig, parentContext, parentTools, terminal } = options;

  // Filter tools based on agent definition constraints
  const tools = filterTools(
    parentTools,
    agentDefinition,
    options.commandSemanticRoles?.subagentSpawn,
  );

  // Resolve model (precedence): explicit alias override > SELFHOST-006 per-role routing > parent model.
  // v1 resolution site (per opaque role key = role ?? name). The subagent runs on the PARENT provider
  // instance (no provider registry to swap providers in v1), so only apply a role's model when its
  // chain entry targets that SAME provider — pick the first `IModelRef` whose `provider` matches. A
  // role whose entries all target a different provider falls back to the parent model rather than
  // running a foreign model string on the parent provider (which would mismatch). Cross-provider
  // fallback is the routing policy's job (`runWithRoleFallback`) once a provider registry is wired.
  const roleKey = agentDefinition.role ?? agentDefinition.name;
  const roleChain = options.roleModels ? resolveRoleFallbackChain(options.roleModels, roleKey) : [];
  const roleModel = roleChain.find((ref) => ref.provider === options.provider.name);
  const model = agentDefinition.model
    ? resolveModelId(agentDefinition.model, parentConfig.provider.model)
    : (roleModel?.model ?? parentConfig.provider.model);

  // Assemble system prompt with framework suffix
  const systemMessage = assembleSubagentPrompt({
    agentBody: agentDefinition.systemPrompt,
    projectNotesMd: parentContext.projectNotesMd,
    agentsMd: parentContext.agentsMd,
    isForkWorker: options.isForkWorker ?? false,
    ...(options.suffix !== undefined ? { suffix: options.suffix } : {}),
  });

  const provider = options.provider;

  return new Session({
    tools,
    provider,
    systemMessage,
    terminal,
    cwd: options.cwd,
    ...(options.sessionId !== undefined ? { sessionId: options.sessionId } : {}),
    ...(options.sessionLogger !== undefined ? { sessionLogger: options.sessionLogger } : {}),
    model,
    maxTurns: agentDefinition.maxTurns,
    permissions: parentConfig.permissions,
    permissionMode: options.permissionMode,
    // CORE-025: the task policy pre-empts the session-mode gate (deny/preapproved/inherit override even
    // bypassPermissions); `preapproved` reads the task's own lists, `inherit-allowlist` reads
    // `parentConfig.permissions` (passed above as `permissions`).
    ...(options.permissionPolicy !== undefined
      ? { permissionPolicy: options.permissionPolicy }
      : {}),
    taskPermissions: {
      ...(options.taskAllowedTools !== undefined ? { allow: options.taskAllowedTools } : {}),
      ...(options.taskDisallowedTools !== undefined ? { deny: options.taskDisallowedTools } : {}),
    },
    defaultTrustLevel: parentConfig.defaultTrustLevel,
    permissionHandler: options.permissionHandler,
    hooks: options.hooks,
    hookTypeExecutors: options.hookTypeExecutors,
    onTextDelta: options.onTextDelta,
    onToolExecution: options.onToolExecution,
  });
}
