/**
 * System prompt builder — assembles the system message sent to the AI model
 * from base role, project context, AGENTS.md/CLAUDE.md, tool list, and
 * permission trust level.
 */
import type { IProjectInfo } from './project-detector.js';
import type { TTrustLevel } from '../types.js';

export interface ISystemPromptParams {
  /** Concatenated AGENTS.md content (may be empty string) */
  agentsMd: string;
  /** Concatenated CLAUDE.md content (may be empty string) */
  claudeMd: string;
  /** Human-readable tool descriptions, one per entry */
  toolDescriptions: string[];
  /** Active trust level governing permission checks */
  trustLevel: TTrustLevel;
  /** Detected project metadata */
  projectInfo: IProjectInfo;
  /** Current working directory */
  cwd?: string;
  /** Response language code (e.g., "ko", "en"). If set, AI must respond in this language. */
  language?: string;
  /** Discovered skills to expose in the system prompt */
  skills?: Array<{ name: string; description: string; disableModelInvocation?: boolean }>;
  /** Discovered agents to expose in the system prompt */
  agents?: Array<{ name: string; description: string }>;
}

const TRUST_LEVEL_DESCRIPTIONS: Record<TTrustLevel, string> = {
  safe: 'safe (read-only / plan mode — only read-access tools are available)',
  moderate: 'moderate (default mode — write and bash tools require approval)',
  full: 'full (acceptEdits mode — file writes are auto-approved; bash requires approval)',
};

function buildProjectSection(info: IProjectInfo): string {
  const lines: string[] = ['## Current Project'];
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
  return lines.join('\n');
}

function buildToolsSection(descriptions: string[]): string {
  if (descriptions.length === 0) {
    return '';
  }
  const lines = ['## Available Tools', ...descriptions.map((d) => `- ${d}`)];
  return lines.join('\n');
}

/**
 * Assemble the full system prompt string from the provided parameters.
 */
function buildSkillsSection(
  skills: Array<{ name: string; description: string; disableModelInvocation?: boolean }>,
): string {
  const invocable = skills.filter((s) => s.disableModelInvocation !== true);
  if (invocable.length === 0) {
    return '';
  }
  const lines = [
    '## Skills',
    'The following skills are available:',
    '',
    ...invocable.map((s) => `- ${s.name}: ${s.description}`),
  ];
  return lines.join('\n');
}

function buildAgentsSection(agents: Array<{ name: string; description: string }>): string {
  if (agents.length === 0) {
    return '';
  }
  const lines = [
    '## Subagents',
    'You can launch isolated agents with the Agent tool.',
    'Use the Agent tool when the user explicitly asks to call an agent, asks you to delegate work, or a task should run in an isolated context.',
    'Pass the selected agent name as subagent_type and summarize the returned result for the user.',
    '',
    'Available agents:',
    ...agents.map((agent) => `- ${agent.name}: ${agent.description}`),
  ];
  return lines.join('\n');
}

function appendSection(sections: string[], section: string): void {
  if (section.length > 0) {
    sections.push(section);
  }
}

function appendModelVisibleMetadataSections(
  sections: string[],
  params: Pick<ISystemPromptParams, 'skills' | 'agents'>,
): void {
  if (params.skills !== undefined && params.skills.length > 0) {
    appendSection(sections, buildSkillsSection(params.skills));
  }
  if (params.agents !== undefined && params.agents.length > 0) {
    appendSection(sections, buildAgentsSection(params.agents));
  }
}

export function buildSystemPrompt(params: ISystemPromptParams): string {
  const { agentsMd, claudeMd, toolDescriptions, trustLevel, projectInfo, cwd, language } = params;

  const sections: string[] = [];

  // Base role
  const roleLines = [
    '## Role',
    'You are an AI coding assistant with access to tools that let you read and modify code.',
    'You help developers understand, write, and improve their codebase.',
    'Always be precise, follow existing code conventions, and prefer minimal changes.',
  ];
  if (language) {
    roleLines.push(
      `Always respond in ${language}. Use ${language} for all explanations and communications.`,
    );
  }
  sections.push(roleLines.join('\n'));

  // Working directory
  if (cwd) {
    sections.push(`## Working Directory\n\`${cwd}\``);
  }

  // Project information
  sections.push(buildProjectSection(projectInfo));

  // Permission trust level
  sections.push(
    [
      '## Permission Mode',
      `Your current trust level is **${TRUST_LEVEL_DESCRIPTIONS[trustLevel]}**.`,
    ].join('\n'),
  );

  // AGENTS.md — project/repo-level instructions
  if (agentsMd.trim().length > 0) {
    sections.push(['## Agent Instructions', agentsMd].join('\n'));
  }

  // CLAUDE.md — additional project notes
  if (claudeMd.trim().length > 0) {
    sections.push(['## Project Notes', claudeMd].join('\n'));
  }

  // Web search capability
  sections.push(
    [
      '## Web Search',
      'You have access to web search. When the user asks to search, look up, or find current/latest information,',
      'you MUST use the web_search tool. Do NOT answer from training data when the user explicitly asks to search.',
      'Always prefer web search for: news, latest versions, current events, live documentation.',
    ].join('\n'),
  );

  // Tool list
  const toolsSection = buildToolsSection(toolDescriptions);
  if (toolsSection.length > 0) {
    sections.push(toolsSection);
  }

  // Skills list
  appendModelVisibleMetadataSections(sections, params);

  return sections.join('\n\n');
}
