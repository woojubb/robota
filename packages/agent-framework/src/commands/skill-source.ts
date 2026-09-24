import { join, basename } from 'node:path';

import { decodeFrontmatter } from '../frontmatter/frontmatter-decoder.js';
import { FrontmatterDecodeError } from '../frontmatter/frontmatter-error.js';

import type { ICommandSource, ICommand } from '../command-api/types.js';
import type { IContributionSource } from '../contributions/contribution-source.js';
import type { ISkillFrontmatter } from '../frontmatter/frontmatter-types.js';

function decodeSkill(
  content: string,
  file: string,
  source: IContributionSource,
): ISkillFrontmatter {
  const result = decodeFrontmatter({
    source: join(source.displayName, file),
    content,
    profile: 'skill',
  });
  if (!result.ok) throw new FrontmatterDecodeError(result.diagnostics);
  return result.metadata;
}

/** Build a command from frontmatter, content, and a fallback name */
function buildCommand(
  frontmatter: ISkillFrontmatter,
  content: string,
  fallbackName: string,
): ICommand {
  const cmd: ICommand = {
    name: frontmatter.name ?? fallbackName,
    description: frontmatter.description ?? `Skill: ${fallbackName}`,
    source: 'skill',
    skillContent: content,
  };

  if (frontmatter.argumentHint !== undefined) cmd.argumentHint = frontmatter.argumentHint;
  if (frontmatter.disableModelInvocation !== undefined)
    cmd.disableModelInvocation = frontmatter.disableModelInvocation;
  if (frontmatter.userInvocable !== undefined) cmd.userInvocable = frontmatter.userInvocable;
  if (frontmatter.allowedTools !== undefined) cmd.allowedTools = frontmatter.allowedTools;
  if (frontmatter.model !== undefined) cmd.model = frontmatter.model;
  if (frontmatter.effort !== undefined) cmd.effort = frontmatter.effort;
  if (frontmatter.context !== undefined) cmd.context = frontmatter.context;
  if (frontmatter.agent !== undefined) cmd.agent = frontmatter.agent;

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
    const frontmatter = decodeSkill(content, skillFile, source);
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
    const frontmatter = decodeSkill(content, filePath, source);
    const fallbackName = basename(entry.name, '.md');
    commands.push(buildCommand(frontmatter, content, fallbackName));
  }

  return commands;
}

/** One host-selected skill or legacy-command directory, ordered by host precedence. */
export interface ISkillRootDescriptor {
  readonly root: string;
  readonly kind: 'skills' | 'commands';
}

/** Command source that discovers skills from multiple directories */
export class SkillCommandSource implements ICommandSource {
  readonly name = 'skill';
  private cachedCommands: ICommand[] | null = null;

  constructor(
    private readonly sources: readonly IContributionSource[],
    private readonly roots: readonly ISkillRootDescriptor[] = [],
  ) {}

  getCommands(): ICommand[] {
    if (this.cachedCommands) return this.cachedCommands;

    const discovered = this.sources.flatMap((source) =>
      this.roots.map(({ root, kind }) =>
        kind === 'skills' ? scanSkillsDir(root, source) : scanCommandsDir(root, source),
      ),
    );

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
  | 'missing-skill-file'
  | 'unreadable'
  | 'frontmatter-missing'
  | 'frontmatter-unterminated'
  | 'frontmatter-invalid';

export interface ISkillSourceSkip {
  readonly path: string;
  readonly reason: TSkillSkipReason;
  /** For `frontmatter-invalid`: the parser's message — the value set that was expected and the value seen. */
  readonly detail?: string;
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

function inspectFrontmatter(
  source: IContributionSource,
  file: string,
  content: string,
): ISkillSourceSkip | undefined {
  const decoded = decodeFrontmatter({
    source: join(source.displayName, file),
    content,
    profile: 'skill',
  });
  if (!decoded.ok) {
    return {
      path: file,
      reason:
        decoded.diagnostics[0].code === 'unterminated'
          ? 'frontmatter-unterminated'
          : 'frontmatter-invalid',
      detail: new FrontmatterDecodeError(decoded.diagnostics).message,
    };
  }
  return content.split('\n')[0]?.trim() === '---'
    ? undefined
    : { path: file, reason: 'frontmatter-missing' };
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
    const finding = inspectFrontmatter(source, file, content);
    if (finding !== undefined) skipped.push(finding);
    if (finding !== undefined && finding.reason !== 'frontmatter-missing') continue;
    discovered.push(kind === 'skills' ? basename(join(file, '..')) : basename(entry.name, '.md'));
  }
  return { ...base, present: true, discovered, skipped };
}

/**
 * The read-only counterpart of `SkillCommandSource.getCommands()`: the same supplied roots over the
 * same contribution sources, reporting what discovery silently skips — a skill directory without
 * `SKILL.md`, an unreadable definition, or a missing or refused frontmatter block.
 */
export function inspectSkillSources(
  sources: readonly IContributionSource[],
  roots: readonly ISkillRootDescriptor[] = [],
): ISkillSourceInspection {
  return {
    roots: sources.flatMap((source) =>
      roots.map(({ root, kind }) => inspectRoot(source, root, kind)),
    ),
  };
}
