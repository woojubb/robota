import { join, basename } from 'node:path';

import type { ICommandSource, ICommand } from '../command-api/types.js';
import type { IContributionSource } from '../contributions/index.js';

interface IFrontmatter {
  name?: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  effort?: string;
  context?: string;
  agent?: string;
}

/** Known boolean frontmatter keys */
const BOOLEAN_KEYS = new Set(['disable-model-invocation', 'user-invocable']);

/** Known comma-separated or whitespace-separated list frontmatter keys */
const LIST_KEYS = new Set(['allowed-tools']);

/** Convert kebab-case to camelCase */
function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

function parseListValue(rawValue: string): string[] {
  // A plain `','` rather than `/\s*,\s*/`: the padding that regex absorbed is stripped by the `.trim()` below
  // anyway, and `\s*,` retried its whitespace run from every offset — quadratic on a long run (SEC-003).
  const separator = rawValue.includes(',') ? ',' : /\s+/;
  return rawValue
    .split(separator)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
}

/** Parse YAML-like frontmatter between --- markers */
export function parseFrontmatter(content: string): IFrontmatter | null {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  const result: Record<string, unknown> = {};

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '---') break;

    const match = line.match(/^([a-z][a-z0-9-]*):\s*(.+)/);
    if (!match) continue;

    const key = match[1]!;
    const rawValue = match[2]!.trim();
    const camelKey = kebabToCamel(key);

    if (BOOLEAN_KEYS.has(key)) {
      result[camelKey] = rawValue === 'true';
    } else if (LIST_KEYS.has(key)) {
      result[camelKey] = parseListValue(rawValue);
    } else {
      result[camelKey] = rawValue;
    }
  }

  return Object.keys(result).length > 0 ? (result as IFrontmatter) : null;
}

/** Build a command from frontmatter, content, and a fallback name */
function buildCommand(
  frontmatter: IFrontmatter | null,
  content: string,
  fallbackName: string,
): ICommand {
  const cmd: ICommand = {
    name: frontmatter?.name ?? fallbackName,
    description: frontmatter?.description ?? `Skill: ${fallbackName}`,
    source: 'skill',
    skillContent: content,
  };

  if (frontmatter?.argumentHint !== undefined) cmd.argumentHint = frontmatter.argumentHint;
  if (frontmatter?.disableModelInvocation !== undefined)
    cmd.disableModelInvocation = frontmatter.disableModelInvocation;
  if (frontmatter?.userInvocable !== undefined) cmd.userInvocable = frontmatter.userInvocable;
  if (frontmatter?.allowedTools !== undefined) cmd.allowedTools = frontmatter.allowedTools;
  if (frontmatter?.model !== undefined) cmd.model = frontmatter.model;
  if (frontmatter?.effort !== undefined) cmd.effort = frontmatter.effort;
  if (frontmatter?.context !== undefined) cmd.context = frontmatter.context;
  if (frontmatter?.agent !== undefined) cmd.agent = frontmatter.agent;

  return cmd;
}

/** Scan a skills directory for subdirectories containing SKILL.md */
function scanSkillsDir(skillsDir: string, source: IContributionSource): ICommand[] {
  if (source.inspectKind(skillsDir, 'discover skill directory') !== 'directory') return [];

  const commands: ICommand[] = [];
  const entries = source.listDirectory(skillsDir, 'discover skills');

  for (const entry of entries) {
    if (entry.kind !== 'directory') continue;
    const skillFile = join(skillsDir, entry.name, 'SKILL.md');
    if (source.inspectKind(skillFile, 'inspect skill definition') !== 'file') continue;

    const content = source.readText(skillFile, 'load skill definition');
    if (content === undefined) continue;
    const frontmatter = parseFrontmatter(content);
    commands.push(buildCommand(frontmatter, content, entry.name));
  }

  return commands;
}

/** Scan a commands directory for .md files (Claude Code legacy format) */
function scanCommandsDir(commandsDir: string, source: IContributionSource): ICommand[] {
  if (source.inspectKind(commandsDir, 'discover command directory') !== 'directory') return [];

  const commands: ICommand[] = [];
  const entries = source.listDirectory(commandsDir, 'discover commands');

  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
    const filePath = join(commandsDir, entry.name);
    const content = source.readText(filePath, 'load command definition');
    if (content === undefined) continue;
    const frontmatter = parseFrontmatter(content);
    const fallbackName = basename(entry.name, '.md');
    commands.push(buildCommand(frontmatter, content, fallbackName));
  }

  return commands;
}

/** Command source that discovers skills from multiple directories */
export class SkillCommandSource implements ICommandSource {
  readonly name = 'skill';
  private cachedCommands: ICommand[] | null = null;

  constructor(private readonly sources: readonly IContributionSource[]) {}

  getCommands(): ICommand[] {
    if (this.cachedCommands) return this.cachedCommands;

    const discovered = this.sources.flatMap((source) => [
      scanSkillsDir(join('.robota', 'skills'), source),
      scanSkillsDir(join('.claude', 'skills'), source),
      scanCommandsDir(join('.claude', 'commands'), source),
      scanSkillsDir(join('.agents', 'skills'), source),
    ]);

    const seen = new Set<string>();
    const merged: ICommand[] = [];

    for (const commands of discovered) {
      for (const cmd of commands) {
        if (!seen.has(cmd.name)) {
          seen.add(cmd.name);
          merged.push(cmd);
        }
      }
    }

    this.cachedCommands = merged;
    return this.cachedCommands;
  }

  getModelInvocableSkills(): ICommand[] {
    return this.getCommands().filter((cmd) => cmd.disableModelInvocation !== true);
  }

  getUserInvocableSkills(): ICommand[] {
    return this.getCommands().filter((cmd) => cmd.userInvocable !== false);
  }
}
