import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, basename } from 'node:path';
import { homedir } from 'node:os';
import type { IAgentDefinition } from './agent-definition-types.js';
import { BUILT_IN_AGENTS } from './built-in-agents.js';

/** Known frontmatter keys that should be parsed as comma-separated lists. */
const LIST_KEYS = new Set(['tools', 'disallowedTools']);

/** Known frontmatter keys that should be parsed as numbers. */
const NUMBER_KEYS = new Set(['maxTurns']);

interface IRawFrontmatter {
  name?: string;
  description?: string;
  model?: string;
  maxTurns?: number;
  tools?: string[];
  disallowedTools?: string[];
}

/**
 * Parse simple YAML-like frontmatter between `---` markers.
 * Returns null when no frontmatter block is found.
 */
function parseFrontmatter(content: string): { frontmatter: IRawFrontmatter | null; body: string } {
  const lines = content.split('\n');
  if (lines[0]?.trim() !== '---') {
    return { frontmatter: null, body: content };
  }

  let endIndex = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === '---') {
      endIndex = i;
      break;
    }
  }

  if (endIndex === -1) {
    return { frontmatter: null, body: content };
  }

  const result: Record<string, unknown> = {};

  for (let i = 1; i < endIndex; i++) {
    const line = lines[i]!;
    const match = line.match(/^([a-zA-Z][a-zA-Z0-9]*(?:[A-Z][a-z]*)*):\s*(.+)/);
    if (!match) continue;

    const key = match[1]!;
    const rawValue = match[2]!.trim();

    if (LIST_KEYS.has(key)) {
      result[key] = rawValue.split(',').map((s) => s.trim());
    } else if (NUMBER_KEYS.has(key)) {
      result[key] = parseInt(rawValue, 10);
    } else {
      result[key] = rawValue;
    }
  }

  const body = lines
    .slice(endIndex + 1)
    .join('\n')
    .trim();

  return {
    frontmatter: Object.keys(result).length > 0 ? (result as IRawFrontmatter) : null,
    body,
  };
}

/** Scan a directory for .md files and return parsed agent definitions. */
function scanAgentsDir(dir: string): IAgentDefinition[] {
  if (!existsSync(dir)) return [];

  const agents: IAgentDefinition[] = [];
  let entries: import('node:fs').Dirent[];

  try {
    entries = readdirSync(dir, { withFileTypes: true }) as import('node:fs').Dirent[];
  } catch {
    return [];
  }

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.md')) continue;

    const filePath = join(dir, entry.name);
    const content = readFileSync(filePath, 'utf-8');
    const { frontmatter, body } = parseFrontmatter(content);
    const fallbackName = basename(entry.name, '.md');

    const agent: IAgentDefinition = {
      name: frontmatter?.name ?? fallbackName,
      description: frontmatter?.description ?? '',
      systemPrompt: body,
    };

    if (frontmatter?.model !== undefined) agent.model = frontmatter.model;
    if (frontmatter?.maxTurns !== undefined) agent.maxTurns = frontmatter.maxTurns;
    if (frontmatter?.tools !== undefined) agent.tools = frontmatter.tools;
    if (frontmatter?.disallowedTools !== undefined)
      agent.disallowedTools = frontmatter.disallowedTools;

    agents.push(agent);
  }

  return agents;
}

/**
 * Loads agent definitions from project and user directories, merging
 * them with built-in agents.
 *
 * Scan directories (highest priority first):
 * 1. `<cwd>/.claude/agents/` — project-level
 * 2. `<home>/.robota/agents/` — user-level
 *
 * Custom agents override built-in agents on name collision.
 */
export class AgentDefinitionLoader {
  private readonly cwd: string;
  private readonly home: string;

  constructor(cwd: string, home?: string) {
    this.cwd = cwd;
    this.home = home ?? homedir();
  }

  /** Load all agent definitions, merged with built-in agents. Custom overrides built-in on name collision. */
  loadAll(): IAgentDefinition[] {
    const sources: IAgentDefinition[][] = [
      scanAgentsDir(join(this.cwd, '.claude', 'agents')),
      scanAgentsDir(join(this.home, '.robota', 'agents')),
    ];

    // Deduplicate custom agents: higher-priority source wins
    const seen = new Set<string>();
    const customAgents: IAgentDefinition[] = [];

    for (const agents of sources) {
      for (const agent of agents) {
        if (!seen.has(agent.name)) {
          seen.add(agent.name);
          customAgents.push(agent);
        }
      }
    }

    // Merge with built-in: custom overrides built-in on name collision
    const result = [...customAgents];
    for (const builtIn of BUILT_IN_AGENTS) {
      if (!seen.has(builtIn.name)) {
        result.push(builtIn);
      }
    }

    return result;
  }

  /** Get a specific agent by name (custom or built-in). */
  getAgent(name: string): IAgentDefinition | undefined {
    return this.loadAll().find((agent) => agent.name === name);
  }
}
