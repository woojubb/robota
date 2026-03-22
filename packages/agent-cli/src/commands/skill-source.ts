import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { ICommandSource, ISlashCommand } from './types.js';

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

/** Known comma-separated list frontmatter keys */
const LIST_KEYS = new Set(['allowed-tools']);

/** Convert kebab-case to camelCase */
function kebabToCamel(key: string): string {
  return key.replace(/-([a-z])/g, (_match, letter: string) => letter.toUpperCase());
}

/** Parse YAML-like frontmatter between --- markers */
function parseFrontmatter(content: string): IFrontmatter | null {
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
      result[camelKey] = rawValue.split(',').map((s) => s.trim());
    } else {
      result[camelKey] = rawValue;
    }
  }

  return Object.keys(result).length > 0 ? (result as IFrontmatter) : null;
}

/** Build a slash command from frontmatter, content, and a fallback name */
function buildCommand(
  frontmatter: IFrontmatter | null,
  content: string,
  fallbackName: string,
): ISlashCommand {
  const cmd: ISlashCommand = {
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
function scanSkillsDir(skillsDir: string): ISlashCommand[] {
  if (!existsSync(skillsDir)) return [];

  const commands: ISlashCommand[] = [];
  const entries = readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, 'SKILL.md');
    if (!existsSync(skillFile)) continue;

    const content = readFileSync(skillFile, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    commands.push(buildCommand(frontmatter, content, entry.name));
  }

  return commands;
}

/** Scan a commands directory for .md files (Claude Code legacy format) */
function scanCommandsDir(commandsDir: string): ISlashCommand[] {
  if (!existsSync(commandsDir)) return [];

  const commands: ISlashCommand[] = [];
  const entries = readdirSync(commandsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = join(commandsDir, entry.name);
    const content = readFileSync(filePath, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    const fallbackName = basename(entry.name, '.md');
    commands.push(buildCommand(frontmatter, content, fallbackName));
  }

  return commands;
}

/** Command source that discovers skills from multiple directories */
export class SkillCommandSource implements ICommandSource {
  readonly name = 'skill';
  private readonly cwd: string;
  private readonly home: string;
  private cachedCommands: ISlashCommand[] | null = null;

  constructor(cwd: string, home?: string) {
    this.cwd = cwd;
    this.home = home ?? homedir();
  }

  getCommands(): ISlashCommand[] {
    if (this.cachedCommands) return this.cachedCommands;

    // Scan paths in priority order (highest first)
    const sources: ISlashCommand[][] = [
      scanSkillsDir(join(this.cwd, '.claude', 'skills')), // 1. project .claude/skills
      scanCommandsDir(join(this.cwd, '.claude', 'commands')), // 2. project .claude/commands (legacy)
      scanSkillsDir(join(this.home, '.claude', 'skills')), // 3. user ~/.claude/skills
      scanSkillsDir(join(this.cwd, '.agents', 'skills')), // 4. project .agents/skills
    ];

    // Deduplicate: higher-priority source wins
    const seen = new Set<string>();
    const merged: ISlashCommand[] = [];

    for (const commands of sources) {
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

  /** Get skills that models can invoke (excludes disableModelInvocation: true) */
  getModelInvocableSkills(): ISlashCommand[] {
    return this.getCommands().filter((cmd) => cmd.disableModelInvocation !== true);
  }

  /** Get skills that users can invoke (excludes userInvocable: false) */
  getUserInvocableSkills(): ISlashCommand[] {
    return this.getCommands().filter((cmd) => cmd.userInvocable !== false);
  }
}
