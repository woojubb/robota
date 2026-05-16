import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { IFileSystem, IDirent } from '@robota-sdk/agent-core';
import { NodeFileSystem } from '../adapters/node-file-system.js';
import type { ICommandSource, ICommand } from '../command-api/types.js';

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
  const separator = rawValue.includes(',') ? /\s*,\s*/ : /\s+/;
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
function scanSkillsDir(skillsDir: string, fs: IFileSystem): ICommand[] {
  if (!fs.existsSync(skillsDir)) return [];

  const commands: ICommand[] = [];
  const entries: IDirent[] = fs.readdirSync(skillsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, 'SKILL.md');
    if (!fs.existsSync(skillFile)) continue;

    const content = fs.readFileSync(skillFile, 'utf-8');
    const frontmatter = parseFrontmatter(content);
    commands.push(buildCommand(frontmatter, content, entry.name));
  }

  return commands;
}

/** Scan a commands directory for .md files (Claude Code legacy format) */
function scanCommandsDir(commandsDir: string, fs: IFileSystem): ICommand[] {
  if (!fs.existsSync(commandsDir)) return [];

  const commands: ICommand[] = [];
  const entries: IDirent[] = fs.readdirSync(commandsDir, { withFileTypes: true });

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;
    const filePath = join(commandsDir, entry.name);
    const content = fs.readFileSync(filePath, 'utf-8');
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
  private readonly fs: IFileSystem;
  private cachedCommands: ICommand[] | null = null;

  constructor(cwd: string, home?: string, fs: IFileSystem = new NodeFileSystem()) {
    this.cwd = cwd;
    this.home = home ?? homedir();
    this.fs = fs;
  }

  getCommands(): ICommand[] {
    if (this.cachedCommands) return this.cachedCommands;

    const sources: ICommand[][] = [
      scanSkillsDir(join(this.cwd, '.claude', 'skills'), this.fs),
      scanCommandsDir(join(this.cwd, '.claude', 'commands'), this.fs),
      scanSkillsDir(join(this.home, '.robota', 'skills'), this.fs),
      scanSkillsDir(join(this.cwd, '.agents', 'skills'), this.fs),
    ];

    const seen = new Set<string>();
    const merged: ICommand[] = [];

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

  getModelInvocableSkills(): ICommand[] {
    return this.getCommands().filter((cmd) => cmd.disableModelInvocation !== true);
  }

  getUserInvocableSkills(): ICommand[] {
    return this.getCommands().filter((cmd) => cmd.userInvocable !== false);
  }
}
