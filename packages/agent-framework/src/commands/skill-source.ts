import { join, basename } from 'node:path';

import { isModelEffort, MODEL_EFFORT_VALUES } from '@robota-sdk/agent-core';

import type { ICommandSource, ICommand } from '../command-api/types.js';
import type { IContributionSource } from '../contributions/index.js';
import type { TModelEffort } from '@robota-sdk/agent-core';

interface IFrontmatter {
  name?: string;
  description?: string;
  argumentHint?: string;
  disableModelInvocation?: boolean;
  userInvocable?: boolean;
  allowedTools?: string[];
  model?: string;
  effort?: TModelEffort;
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
    } else if (key === 'effort') {
      if (!isModelEffort(rawValue)) {
        throw new Error(
          `Invalid frontmatter effort: expected one of ${MODEL_EFFORT_VALUES.join(', ')}; received "${rawValue}"`,
        );
      }
      result[camelKey] = rawValue;
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

// ── Read-only inspection (OBSERVABILITY-1991) ─────────────────────────────────────────────────────

/** Why an entry under a skill or command root produced no command. */
export type TSkillSkipReason =
  'missing-skill-file' | 'unreadable' | 'frontmatter-missing' | 'frontmatter-unterminated';

export interface ISkillSourceSkip {
  readonly path: string;
  readonly reason: TSkillSkipReason;
}

export interface ISkillRootInspection {
  readonly sourceDisplayName: string;
  readonly root: string;
  readonly present: boolean;
  readonly discovered: readonly string[];
  readonly skipped: readonly ISkillSourceSkip[];
}

export interface ISkillSourceInspection {
  readonly roots: readonly ISkillRootInspection[];
}

/** The four discovery roots `SkillCommandSource.getCommands()` scans, in the same order. */
const SKILL_ROOTS: ReadonlyArray<{ readonly root: string; readonly kind: 'skills' | 'commands' }> =
  [
    { root: join('.robota', 'skills'), kind: 'skills' },
    { root: join('.claude', 'skills'), kind: 'skills' },
    { root: join('.claude', 'commands'), kind: 'commands' },
    { root: join('.agents', 'skills'), kind: 'skills' },
  ];

function frontmatterSkip(content: string): TSkillSkipReason | undefined {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return 'frontmatter-missing';
  return lines.slice(1).some((line) => line.trim() === '---')
    ? undefined
    : 'frontmatter-unterminated';
}

function inspectRoot(
  source: IContributionSource,
  root: string,
  kind: 'skills' | 'commands',
): ISkillRootInspection {
  const base = { sourceDisplayName: source.displayName, root };
  if (source.inspectKind(root, 'inspect skill directory') !== 'directory') {
    return { ...base, present: false, discovered: [], skipped: [] };
  }
  const discovered: string[] = [];
  const skipped: ISkillSourceSkip[] = [];
  for (const entry of source.listDirectory(root, 'inspect skills')) {
    let file: string;
    if (kind === 'skills') {
      if (entry.kind !== 'directory') continue;
      file = join(root, entry.name, 'SKILL.md');
      if (source.inspectKind(file, 'inspect skill definition') !== 'file') {
        skipped.push({ path: join(root, entry.name), reason: 'missing-skill-file' });
        continue;
      }
    } else {
      if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;
      file = join(root, entry.name);
    }
    const content = source.readText(file, 'inspect skill definition');
    if (content === undefined) {
      skipped.push({ path: file, reason: 'unreadable' });
      continue;
    }
    const reason = frontmatterSkip(content);
    if (reason !== undefined) {
      // Discovery still registers such a file under its directory name; the finding is that its
      // frontmatter contributes nothing, which is what a user who wrote one wants to know.
      skipped.push({ path: file, reason });
    }
    discovered.push(kind === 'skills' ? basename(join(file, '..')) : basename(entry.name, '.md'));
  }
  return { ...base, present: true, discovered, skipped };
}

/**
 * The read-only counterpart of `SkillCommandSource.getCommands()`: the same four roots over the same
 * contribution sources, reporting what discovery silently skips — a skill directory without
 * `SKILL.md`, an unreadable definition, a definition whose frontmatter is missing or unterminated.
 */
export function inspectSkillSources(
  sources: readonly IContributionSource[],
): ISkillSourceInspection {
  return {
    roots: sources.flatMap((source) =>
      SKILL_ROOTS.map(({ root, kind }) => inspectRoot(source, root, kind)),
    ),
  };
}
