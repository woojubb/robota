import { TRUST_TO_MODE } from '@robota-sdk/agent-core';

import { buildAgentRuntime } from './build-runtime.js';
import { formatDeferredToolRoster } from './deferred-tool-roster.js';
import { ToolCallHandoffTool } from './tool-call-handoff.js';
import { createExecutionOriginMetadata } from '../background-tasks/index.js';
import { storeSessionBackgroundTaskManager } from '../background-tasks/session-background-store.js';
import { buildSystemPromptSections } from '../context/system-prompt-builder.js';
import {
  appendToSystemPromptManifest,
  composeSystemPrompt,
  describeSystemPromptSections,
} from '../context/system-prompt-composer.js';
import { storeAgentToolDeps } from '../tools/agent-tool.js';
import { createBackgroundProcessTool } from '../tools/background-process-tool.js';
import { formatProjectedModelCommandToolPromptDescription } from '../tools/model-command-tool-projection.js';

import type { ICreateSessionOptions } from './create-session-types.js';
import type { IToolCallHandoffDeps } from './tool-call-handoff.js';
import type { IAgentDefinition } from '../agents/agent-definition-types.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { IOutputStylePrompt } from '../context/output-style-prompt.js';
import type { ISystemPromptParams } from '../context/system-prompt-builder.js';
import type { IComposedSystemPrompt } from '../context/system-prompt-types.js';
import type { IAgentToolDeps } from '../tools/agent-tool.js';
import type { IBackgroundProcessToolDeps } from '../tools/background-process-tool.js';
import type { createModelCommandToolProjection } from '../tools/model-command-tool-projection.js';
import type { IToolWithEventService } from '@robota-sdk/agent-core';
import type {
  IBackgroundTaskManager,
  IBackgroundTaskRunner,
  IToolInvocationAdopter,
} from '@robota-sdk/agent-executor';
import type { Session } from '@robota-sdk/agent-session';

/**
 * Human-readable descriptions of the built-in tools, for the system prompt.
 *
 * It lives here because it has exactly one consumer — the prompt build below — so a separate
 * module boundary would exist for nobody.
 *
 * A LIMIT worth meeting head-on now that the list sits beside its consumer: this inventory is
 * hard-coded and is NOT derived from the tools the session actually assembled. It happens to be
 * accurate for every in-repo product today. Making it derived is filed separately; putting the list
 * here is what makes the gap visible at the site that would fix it.
 */
/** Human-readable descriptions of the built-in tools (for system prompt) */
export const DEFAULT_TOOL_DESCRIPTIONS = [
  'Shell — execute host shell commands (OS-aware: bash/PowerShell)',
  'Bash — alias of Shell (model-familiar name)',
  'Read — read file contents with line numbers',
  'Write — write content to a file',
  'Edit — replace a string in a file',
  'Glob — find files matching a pattern',
  'Grep — search file contents with regex',
  'WebFetch — fetch URL content as text',
  'AskUserQuestion — ask the user structured questions (options/multi-select/free text) mid-task',
];

// Re-exported so existing importers of the assembly module keep one entry point — the
// deferred roster included, since its one consumer is the prompt build below.
export { buildAgentRuntime };
export { DEFERRED_TOOL_ROSTER_HEADER, formatDeferredToolRoster } from './deferred-tool-roster.js';
export type { IAgentRuntimeResult } from './build-runtime.js';

/**
 * What a live preset switch may re-apply to the system prompt.
 *
 * One type rather than an inline literal at each site, because it is written in four places —
 * the closure's parameter, the interface that declares it, the session's applier, and the host role.
 * An inline `{ persona?; selfVerification? }` at each would be four copies, and one of them would
 * be the copy that forgets a field.
 */
export interface TLivePromptOverrides {
  memoryMd?: string;
  skills?: ISystemPromptParams['skills'];
  outputStyle?: IOutputStylePrompt;
  persona?: string;
  selfVerification?: boolean | string;
  language?: string;
  presetSystemPrompt?: string;
}

export interface IBackgroundProcessResult {
  backgroundProcessToolDeps: IBackgroundProcessToolDeps | undefined;
}

export function buildBackgroundProcessTool(
  options: ICreateSessionOptions,
  backgroundTaskManager: IBackgroundTaskManager,
  sessionId: string,
  cwd: string,
  tools: IToolWithEventService[],
): IBackgroundProcessResult {
  const hasProcessRunner = options.backgroundTaskRunners?.some((r) => r.kind === 'process');
  if (!hasProcessRunner) return { backgroundProcessToolDeps: undefined };
  const backgroundProcessToolDeps: IBackgroundProcessToolDeps = {
    backgroundTaskManager,
    cwd,
    parentSessionId: sessionId,
    metadata: createExecutionOriginMetadata({
      kind: 'tool_call',
      sessionId,
      label: 'BackgroundProcess',
    }),
  };
  tools.push(createBackgroundProcessTool(backgroundProcessToolDeps));
  return { backgroundProcessToolDeps };
}

/**
 * When `options.toolCallHandoff` is set AND a `tool-invocation` runner is present in
 * `options.backgroundTaskRunners` (the `hasProcessRunner` pattern above, narrowed by `'adopt' in
 * runner` to the adopter port `agent-executor`'s runner also implements), REPLACES each entry in the
 * session-local `tools` array whose `getName()` is named in `toolCallHandoff.toolNames` with its
 * wrapper — splice by index, in place. `tools` is the fresh, deduped array `assembleSessionTools`
 * built, never `options.additionalTools` itself (`cli.ts` shares that array across every session the
 * process creates). Absent policy or absent runner ⇒ no-op, unchanged behavior.
 */
export function buildToolCallHandoff(
  options: ICreateSessionOptions,
  backgroundTaskManager: IBackgroundTaskManager,
  sessionId: string,
  cwd: string,
  tools: IToolWithEventService[],
): void {
  const policy = options.toolCallHandoff;
  if (!policy) return;
  const runner = options.backgroundTaskRunners?.find((r) => r.kind === 'tool-invocation');
  if (!runner || !('adopt' in runner)) return;
  const adopter = runner as IBackgroundTaskRunner & IToolInvocationAdopter;

  // Refuse at build time: every name in `toolNames` must have a provenance entry.
  for (const toolName of policy.toolNames) {
    if (!policy.provenance[toolName]) {
      throw new Error(
        `toolCallHandoff.provenance is missing an entry for tool "${toolName}" named in toolNames`,
      );
    }
  }

  for (const toolName of policy.toolNames) {
    const index = tools.findIndex((tool) => tool.getName() === toolName);
    if (index === -1) continue;
    const provenance = policy.provenance[toolName];
    if (!provenance) continue; // unreachable — validated above; narrows for TS
    const deps: IToolCallHandoffDeps = {
      manager: backgroundTaskManager,
      runner: adopter,
      sessionId,
      cwd,
      thresholdMs: policy.thresholdMs,
      budgetMs: policy.budgetMs,
      provenance,
      ...(options.sessionLogger !== undefined ? { sessionLogger: options.sessionLogger } : {}),
    };
    tools[index] = new ToolCallHandoffTool(tools[index], deps);
  }
}

export interface ISystemPromptResult {
  finalSystemMessage: string;
  /** What `finalSystemMessage` was composed from; absent when a caller-supplied builder made it. */
  systemPromptManifest: IComposedSystemPrompt['manifest'];
  rebuildSystemMessage: (
    agentsMd: string,
    projectNotesMd: string,
    overrides?: TLivePromptOverrides,
  ) => IComposedSystemPrompt;
}

const APPEND_SYSTEM_PROMPT_SECTION_ID = 'append-system-prompt';

/**
 * Compose the prompt for `params`. The default builder composes from sections, so the manifest can
 * say which; a caller-supplied builder returns text only and its sections are not known.
 */
function composeSessionPrompt(
  options: ICreateSessionOptions,
  params: ISystemPromptParams,
): IComposedSystemPrompt {
  const customBuilder = options.systemPromptBuilder;
  const composed: IComposedSystemPrompt =
    customBuilder !== undefined
      ? { message: customBuilder(params), manifest: undefined }
      : composeFromSections(params);
  const append = options.appendSystemPrompt;
  if (!append) return composed;
  const extra = `\n\n${append}`;
  return {
    message: `${composed.message}${extra}`,
    manifest:
      composed.manifest === undefined
        ? undefined
        : appendToSystemPromptManifest(composed.manifest, APPEND_SYSTEM_PROMPT_SECTION_ID, append),
  };
}

function composeFromSections(params: ISystemPromptParams): IComposedSystemPrompt {
  const sections = buildSystemPromptSections(params);
  return {
    message: composeSystemPrompt(sections),
    manifest: describeSystemPromptSections(sections),
  };
}

/**
 * Build the static system-prompt params shared by the initial build and every rebuild. Persona
 * and selfVerification are composed separately per-build so their mutable
 * closure values always take precedence over these static params.
 */
function buildStaticPromptParams(
  options: ICreateSessionOptions,
  cwd: string,
  resolvedToolDescriptions: string[],
  modelVisibleSkills: Array<{
    name: string;
    description: string;
    disableModelInvocation?: boolean;
  }>,
  agentDefinitions: IAgentDefinition[],
): Omit<ISystemPromptParams, 'outputStyle' | 'persona' | 'selfVerification'> {
  return {
    agentsMd: options.context.agentsMd,
    projectNotesMd: options.context.projectNotesMd,
    memoryMd: options.context.memoryMd,
    taskContext: options.context.taskContext,
    toolDescriptions: resolvedToolDescriptions,
    // The prompt names the mode the gate enforces — same resolution
    // as agent-session (explicit mode, else trust-level mapping, else default).
    permissionMode:
      options.permissionMode ?? TRUST_TO_MODE[options.config.defaultTrustLevel] ?? 'default',
    projectInfo: options.projectInfo ?? { type: 'unknown', language: 'unknown' },
    cwd,
    skills: modelVisibleSkills.map((skill) => ({
      name: skill.name,
      description: skill.description,
      disableModelInvocation: skill.disableModelInvocation,
    })),
    ...(agentDefinitions.length > 0
      ? {
          agents: agentDefinitions.map((agent) => ({
            name: agent.name,
            description: agent.description,
          })),
        }
      : {}),
    commandDescriptors: options.commandDescriptors ?? [],
  };
}

export function buildSessionSystemPrompt(
  options: ICreateSessionOptions,
  cwd: string,
  modelInvocableCommandDescriptors: ICapabilityDescriptor[],
  modelCommandToolProjection: ReturnType<typeof createModelCommandToolProjection> | undefined,
  backgroundProcessToolDeps: IBackgroundProcessToolDeps | undefined,
  modelVisibleSkills: Array<{
    name: string;
    description: string;
    disableModelInvocation?: boolean;
  }>,
  agentDefinitions: IAgentDefinition[],
  assembledTools: readonly IToolWithEventService[] = [],
): ISystemPromptResult {
  const defaultToolDescriptions = [
    ...DEFAULT_TOOL_DESCRIPTIONS,
    ...(modelCommandToolProjection
      ? modelCommandToolProjection.commandTools.map(
          formatProjectedModelCommandToolPromptDescription,
        )
      : []),
  ];
  const listedToolDescriptions =
    options.toolDescriptions ??
    (backgroundProcessToolDeps
      ? [
          ...defaultToolDescriptions,
          'BackgroundProcess — start long-running shell commands as managed background tasks',
        ]
      : defaultToolDescriptions);
  // Appended AFTER the override branch, deliberately. A caller supplying its own
  // `toolDescriptions` owns which resident tools are described, but no caller can know what this
  // session deferred — and a deferred tool the model is never told about cannot be searched for.
  const resolvedToolDescriptions = [
    ...listedToolDescriptions,
    ...formatDeferredToolRoster(assembledTools),
  ];

  // Persona is mutable for the lifetime of this closure. A live preset switch can
  // re-apply a new persona mid-session (via `rebuildSystemMessage(..., { persona })`); later
  // staleness rebuilds (no override) must keep the most recently applied persona.
  let currentPersona = options.persona;

  let currentOutputStyle = options.outputStyle;

  // selfVerification is mutable for the lifetime of this closure, mirroring persona. A
  // live preset switch can toggle the verify-before-done section mid-session (via
  // `rebuildSystemMessage(..., { selfVerification })`); later staleness rebuilds (no override) must
  // keep the most recently applied value.
  let currentSelfVerification = options.selfVerification;

  // Language is mutable for the lifetime of this closure, mirroring persona. A live preset
  // switch re-applies the response-language section mid-session; later staleness rebuilds (no
  // override) must keep the most recently applied value.
  //
  // Sourced from `config.language`, which is where a preset's language already ARRIVES — the
  // interactive init merges `options.language` into the config. A second key on
  // `ICreateSessionOptions` would be a second route to one value, so there is none.
  let currentLanguage = options.config.language;

  // A preset-supplied system prompt, mutable for the lifetime of this closure like the
  // three above it. It SEEDS the composed prompt as a priority-4 section — the framework's own
  // `systemPrompt` option is the REPLACE seam, and a preset pointing at that would drop the
  // AGENTS.md and capability sections without saying so.
  let currentPresetSystemPrompt = options.presetSystemPrompt;

  // Persona/selfVerification/language are composed per-build (initial + each rebuild) so the mutable
  // closure values always win; they are therefore excluded from these static params.
  const staticPromptParams = buildStaticPromptParams(
    options,
    cwd,
    resolvedToolDescriptions,
    modelVisibleSkills,
    agentDefinitions,
  );
  const initial = composeSessionPrompt(options, {
    ...staticPromptParams,
    ...(currentOutputStyle !== undefined ? { outputStyle: currentOutputStyle } : {}),
    ...(currentPersona !== undefined ? { persona: currentPersona } : {}),
    ...(currentSelfVerification !== undefined ? { selfVerification: currentSelfVerification } : {}),
    ...(currentLanguage !== undefined ? { language: currentLanguage } : {}),
    ...(currentPresetSystemPrompt !== undefined
      ? { presetSystemPrompt: currentPresetSystemPrompt }
      : {}),
  });
  let currentSkills = staticPromptParams.skills;
  let currentMemory = staticPromptParams.memoryMd;
  const rebuildSystemMessage = (
    newAgentsMd: string,
    newProjectNotesMd: string,
    overrides?: TLivePromptOverrides,
  ): IComposedSystemPrompt => {
    if (overrides?.skills !== undefined) currentSkills = overrides.skills;
    if (overrides?.memoryMd !== undefined) currentMemory = overrides.memoryMd;
    if (overrides?.outputStyle !== undefined) {
      currentOutputStyle = overrides.outputStyle;
    }
    // A persona override mutates the retained persona so subsequent rebuilds
    // (e.g. staleness refresh, which passes no override) keep the latest applied persona.
    if (overrides?.persona !== undefined) {
      currentPersona = overrides.persona;
    }
    // A selfVerification override mutates the retained flag the same way, so later
    // override-less rebuilds keep the latest applied value.
    if (overrides?.selfVerification !== undefined) {
      currentSelfVerification = overrides.selfVerification;
    }
    if (overrides?.language !== undefined) {
      currentLanguage = overrides.language;
    }
    if (overrides?.presetSystemPrompt !== undefined) {
      currentPresetSystemPrompt = overrides.presetSystemPrompt;
    }
    return composeSessionPrompt(options, {
      ...staticPromptParams,
      memoryMd: currentMemory,
      skills: currentSkills,
      ...(currentOutputStyle !== undefined ? { outputStyle: currentOutputStyle } : {}),
      ...(currentPersona !== undefined ? { persona: currentPersona } : {}),
      ...(currentSelfVerification !== undefined
        ? { selfVerification: currentSelfVerification }
        : {}),
      ...(currentLanguage !== undefined ? { language: currentLanguage } : {}),
      ...(currentPresetSystemPrompt !== undefined
        ? { presetSystemPrompt: currentPresetSystemPrompt }
        : {}),
      agentsMd: newAgentsMd,
      projectNotesMd: newProjectNotesMd,
    });
  };

  return {
    finalSystemMessage: initial.message,
    systemPromptManifest: initial.manifest,
    rebuildSystemMessage,
  };
}

export function wireSessionDeps(
  session: Session,
  agentToolDeps: IAgentToolDeps | undefined,
  backgroundProcessToolDeps: IBackgroundProcessToolDeps | undefined,
  backgroundTaskManager: IBackgroundTaskManager,
): void {
  if (agentToolDeps) agentToolDeps.parentSessionId = session.getSessionId();
  if (agentToolDeps) {
    agentToolDeps.getParentModelEffort = () => {
      const selection = session.getModelEffort();
      return selection === 'auto' ? undefined : selection;
    };
  }
  // Wire the runtime gate to the session's live flag so a preset switch can
  // enable/disable subagent dispatch on this already-constructed session.
  if (agentToolDeps) {
    agentToolDeps.isParallelSubagentsEnabled = () => session.getParallelSubagentsEnabled();
    // Subagents inherit what this session's gate enforces now, not the settings file.
    agentToolDeps.getParentPermissionRules = () => session.getPermissionRules();
    agentToolDeps.getParentPermissionMode = () => session.getPermissionMode();
  }
  if (backgroundProcessToolDeps) backgroundProcessToolDeps.parentSessionId = session.getSessionId();
  storeSessionBackgroundTaskManager(session, backgroundTaskManager);
  if (agentToolDeps) storeAgentToolDeps(session, agentToolDeps);
}
