import type { IProjectInfo } from './project-detector.js';
import type { ISystemPromptSection } from './system-prompt-types.js';
import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { TPermissionMode } from '@robota-sdk/agent-core';

const PROJECT_MEMORY_PRIORITY = Number('25');
const TASK_CONTEXT_PRIORITY = Number('27');

function createSection(
  id: string,
  title: string | undefined,
  priority: number,
  content: string,
  source: ISystemPromptSection['source'],
): ISystemPromptSection {
  return { id, title, priority, content, source };
}

/**
 * PRESET-003: a preset persona is a normal section with a declared priority, not a
 * hardcoded slot. Priority `5` sits in the top band (5 < AGENTS.md=10) so the persona
 * establishes identity/behaviour before project instructions — the position is decided
 * by `composeSystemPrompt`'s priority sort, never by array order.
 */
export function createPersonaSection(persona: string): ISystemPromptSection {
  return createSection('preset-persona', undefined, 5, persona, 'persona');
}

/**
 * PRESET-017: a concise verify-before-done directive injected when a preset enables
 * `selfVerification`. The content must stay English, brief, and avoid heavy emphasis cues.
 */
const SELF_VERIFICATION_CONTENT =
  "Before you report a task complete, verify your work against this session's tool " +
  'results — re-run the relevant checks and confirm the outcome matches what was asked. ' +
  'If something is not yet verified, say so plainly rather than implying it is done.';

/**
 * PRESET-017: when a preset enables selfVerification, inject a concise verify-before-done
 * section as a normal priority-sorted section (priority 6 = just after persona=5, before
 * AGENTS.md=10), never a hardcoded slot.
 * NEUT-003: `content` is a string-valued seam — callers may replace the default directive
 * text (liftable to a preset); omitted keeps the documented default.
 */
export function createSelfVerificationSection(
  content: string = SELF_VERIFICATION_CONTENT,
): ISystemPromptSection {
  return createSection('preset-self-verification', undefined, 6, content, 'self-verification');
}

export function createWorkingDirectorySection(cwd?: string): ISystemPromptSection | undefined {
  if (!cwd) return undefined;
  return createSection('runtime-cwd', 'Working Directory', 30, `\`${cwd}\``, 'runtime');
}

export function createProjectSection(info: IProjectInfo): ISystemPromptSection {
  const lines: string[] = [];
  if (info.name !== undefined) {
    lines.push(`- **Name:** ${info.name}`);
  }
  if (info.type !== 'unknown') {
    lines.push(`- **Type:** ${info.type}`);
  }
  if (info.language !== 'unknown') {
    lines.push(`- **Language:** ${info.language}`);
  }
  if (info.packageManager !== undefined) {
    lines.push(`- **Package manager:** ${info.packageManager}`);
  }
  return createSection('runtime-project', 'Current Project', 40, lines.join('\n'), 'runtime');
}

/**
 * CLI-072: the prompt names the ACTIVE permission mode — the same value the
 * permission gate enforces — so the model's explanations can never quote a
 * stale trust-level label.
 */
export function createPermissionSection(permissionMode: TPermissionMode): ISystemPromptSection {
  return createSection(
    'permission-mode',
    'Permission Mode',
    50,
    `- **Permission mode:** ${permissionMode}`,
    'permissions',
  );
}

export function createResponseLanguageSection(language?: string): ISystemPromptSection | undefined {
  if (language === undefined || language.trim().length === 0) return undefined;
  return createSection('runtime-response-language', 'Response Language', 45, language, 'runtime');
}

export function createAgentsMdSection(agentsMd: string): ISystemPromptSection | undefined {
  if (agentsMd.trim().length === 0) return undefined;
  return createSection(
    'project-agents-md',
    'Agent Instructions',
    10,
    agentsMd,
    'project-instructions',
  );
}

export function createProjectNotesSection(
  projectNotesMd: string,
): ISystemPromptSection | undefined {
  if (projectNotesMd.trim().length === 0) return undefined;
  return createSection(
    'project-claude-md',
    'Project Notes',
    20,
    projectNotesMd,
    'project-instructions',
  );
}

export function createProjectMemorySection(memoryMd?: string): ISystemPromptSection | undefined {
  if (memoryMd === undefined || memoryMd.trim().length === 0) return undefined;
  return createSection(
    'project-memory',
    'Project Memory',
    PROJECT_MEMORY_PRIORITY,
    memoryMd,
    'project-instructions',
  );
}

export function createTaskContextSection(taskContext?: string): ISystemPromptSection | undefined {
  if (taskContext === undefined || taskContext.trim().length === 0) return undefined;
  return createSection(
    'active-task-context',
    'Active Task Context',
    TASK_CONTEXT_PRIORITY,
    taskContext,
    'project-instructions',
  );
}

export function createToolDescriptionSection(
  descriptions: readonly string[],
): ISystemPromptSection | undefined {
  if (descriptions.length === 0) return undefined;
  return createSection(
    'tool-descriptions',
    'Available Tools',
    60,
    descriptions.map((description) => `- ${description}`).join('\n'),
    'tool',
  );
}

function formatCapability(descriptor: ICapabilityDescriptor): string {
  const arg = descriptor.argumentHint ? ` ${descriptor.argumentHint}` : '';
  return `- ${descriptor.name}${arg}: ${descriptor.description}`;
}

function createCapabilityKindSection(
  kind: ICapabilityDescriptor['kind'],
  title: string,
  priority: number,
  source: ISystemPromptSection['source'],
  descriptors: readonly ICapabilityDescriptor[],
): ISystemPromptSection | undefined {
  const formattedDescriptors = descriptors
    .filter((descriptor) => descriptor.modelInvocable && descriptor.kind === kind)
    .map(formatCapability);
  if (formattedDescriptors.length === 0) return undefined;
  return createSection(
    `capability-${kind}`,
    title,
    priority,
    formattedDescriptors.join('\n'),
    source,
  );
}

export function createCapabilitySections(
  descriptors: readonly ICapabilityDescriptor[],
): ISystemPromptSection[] {
  const sections: ISystemPromptSection[] = [];
  const commandSection = createCapabilityKindSection(
    'builtin-command',
    'Built-in Commands',
    70,
    'command',
    descriptors,
  );
  const skillSection = createCapabilityKindSection('skill', 'Skills', 80, 'skill', descriptors);
  const agentSection = createCapabilityKindSection('agent', 'Agents', 90, 'agent', descriptors);
  const toolSection = createCapabilityKindSection('tool', 'Tools', 100, 'tool', descriptors);

  if (commandSection) sections.push(commandSection);
  if (skillSection) sections.push(skillSection);
  if (agentSection) sections.push(agentSection);
  if (toolSection) sections.push(toolSection);
  return sections;
}

export function createCapabilitySection(
  descriptors: readonly ICapabilityDescriptor[],
): ISystemPromptSection {
  return createSection(
    'capability-descriptors',
    'Capabilities',
    70,
    descriptors
      .filter((descriptor) => descriptor.modelInvocable)
      .map(formatCapability)
      .join('\n'),
    'command',
  );
}
