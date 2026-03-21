import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import type { ICommandSource, ISlashCommand } from './types.js';

interface IFrontmatter {
  name: string;
  description: string;
}

/** Parse YAML-like frontmatter between --- markers */
function parseFrontmatter(content: string): IFrontmatter | null {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') return null;

  let name = '';
  let description = '';

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!;
    if (line.trim() === '---') break;
    const nameMatch = line.match(/^name:\s*(.+)/);
    if (nameMatch) {
      name = nameMatch[1]!.trim();
      continue;
    }
    const descMatch = line.match(/^description:\s*(.+)/);
    if (descMatch) {
      description = descMatch[1]!.trim();
    }
  }

  return name ? { name, description } : null;
}

/** Scan a skills directory and return slash commands */
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

    commands.push({
      name: frontmatter?.name ?? entry.name,
      description: frontmatter?.description ?? `Skill: ${entry.name}`,
      source: 'skill',
      skillContent: content,
    });
  }

  return commands;
}

/** Command source that discovers skills from .agents/skills/ directories */
export class SkillCommandSource implements ICommandSource {
  readonly name = 'skill';
  private readonly cwd: string;
  private cachedCommands: ISlashCommand[] | null = null;

  constructor(cwd: string) {
    this.cwd = cwd;
  }

  getCommands(): ISlashCommand[] {
    if (this.cachedCommands) return this.cachedCommands;

    const projectSkills = scanSkillsDir(join(this.cwd, '.agents', 'skills'));
    const userSkills = scanSkillsDir(join(homedir(), '.claude', 'skills'));

    // Deduplicate: project skills take precedence over user skills
    const seen = new Set(projectSkills.map((cmd) => cmd.name));
    const merged = [...projectSkills];
    for (const cmd of userSkills) {
      if (!seen.has(cmd.name)) {
        merged.push(cmd);
      }
    }

    this.cachedCommands = merged;
    return this.cachedCommands;
  }
}
