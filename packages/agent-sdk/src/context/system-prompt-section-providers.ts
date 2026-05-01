import type { ICapabilityDescriptor } from '../capabilities/types.js';
import type { TTrustLevel } from '../types.js';
import type { IProjectInfo } from './project-detector.js';
import type { ISystemPromptSection } from './system-prompt-types.js';

const TRUST_LEVEL_DESCRIPTIONS: Record<TTrustLevel, string> = {
  safe: 'safe (read-only / plan mode - only read-access tools are available)',
  moderate: 'moderate (default mode - write and bash tools require approval)',
  full: 'full (acceptEdits mode - file writes are auto-approved; bash requires approval)',
};

function createSection(
  id: string,
  title: string | undefined,
  priority: number,
  content: string,
  source: ISystemPromptSection['source'],
): ISystemPromptSection {
  return { id, title, priority, content, source };
}

export function createFrameworkSection(language?: string): ISystemPromptSection {
  const lines = [
    'You are an AI coding assistant with access to tools that let you read and modify code.',
    'You help developers understand, write, and improve their codebase.',
    'Always be precise, follow existing code conventions, and prefer minimal changes.',
  ];
  if (language) {
    lines.push(
      `Always respond in ${language}. Use ${language} for all explanations and communications.`,
    );
  }
  return createSection('framework-role', 'Role', 10, lines.join('\n'), 'framework');
}

export function createWorkingDirectorySection(cwd?: string): ISystemPromptSection | undefined {
  if (!cwd) return undefined;
  return createSection('runtime-cwd', 'Working Directory', 20, `\`${cwd}\``, 'runtime');
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
  return createSection('runtime-project', 'Current Project', 30, lines.join('\n'), 'runtime');
}

export function createPermissionSection(trustLevel: TTrustLevel): ISystemPromptSection {
  return createSection(
    'permission-mode',
    'Permission Mode',
    35,
    `Your current trust level is **${TRUST_LEVEL_DESCRIPTIONS[trustLevel]}**.`,
    'permissions',
  );
}

export function createAgentsMdSection(agentsMd: string): ISystemPromptSection | undefined {
  if (agentsMd.trim().length === 0) return undefined;
  return createSection(
    'project-agents-md',
    'Agent Instructions',
    40,
    agentsMd,
    'project-instructions',
  );
}

export function createClaudeMdSection(claudeMd: string): ISystemPromptSection | undefined {
  if (claudeMd.trim().length === 0) return undefined;
  return createSection('project-claude-md', 'Project Notes', 41, claudeMd, 'project-instructions');
}

export function createProviderWebSearchSection(): ISystemPromptSection {
  return createSection(
    'provider-web-search',
    'Web Search',
    50,
    [
      'You have access to web search. When the user asks to search, look up, or find current/latest information,',
      'you MUST use the web_search tool. Do NOT answer from training data when the user explicitly asks to search.',
      'Always prefer web search for: news, latest versions, current events, live documentation.',
    ].join('\n'),
    'provider',
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
