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
export function buildSystemPrompt(params: ISystemPromptParams): string {
  const { agentsMd, claudeMd, toolDescriptions, trustLevel, projectInfo } = params;

  const sections: string[] = [];

  // Base role
  sections.push(
    [
      '## Role',
      'You are an AI coding assistant with access to tools that let you read and modify code.',
      'You help developers understand, write, and improve their codebase.',
      'Always be precise, follow existing code conventions, and prefer minimal changes.',
    ].join('\n'),
  );

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

  return sections.join('\n\n');
}
