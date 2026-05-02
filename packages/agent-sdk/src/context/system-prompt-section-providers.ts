import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { TTrustLevel } from '../types.js';
import type { IProjectInfo } from './project-detector.js';
import type { ISystemPromptSection } from './system-prompt-types.js';

const TRUST_LEVEL_LABELS: Record<TTrustLevel, string> = {
  safe: 'safe',
  moderate: 'moderate',
  full: 'full',
};
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

export function createPermissionSection(trustLevel: TTrustLevel): ISystemPromptSection {
  return createSection(
    'permission-mode',
    'Permission Mode',
    50,
    `- **Trust level:** ${TRUST_LEVEL_LABELS[trustLevel]}`,
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

export function createClaudeMdSection(claudeMd: string): ISystemPromptSection | undefined {
  if (claudeMd.trim().length === 0) return undefined;
  return createSection('project-claude-md', 'Project Notes', 20, claudeMd, 'project-instructions');
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
  const content = descriptors
    .filter((descriptor) => descriptor.modelInvocable && descriptor.kind === kind)
    .map(formatCapability)
    .join('\n');
  if (content.trim().length === 0) return undefined;
  return createSection(`capability-${kind}`, title, priority, content, source);
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
