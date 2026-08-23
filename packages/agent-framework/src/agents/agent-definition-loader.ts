import { join, basename } from 'node:path';

import { BUILT_IN_AGENTS } from './built-in-agents.js';

import type { IAgentDefinition } from './agent-definition-types.js';
import type { IContributionSource } from '../contributions/index.js';
import type { IWorkspaceDirectoryEntry } from '../workspace-trust/index.js';

/** Known frontmatter keys that should be parsed as comma-separated or whitespace-separated lists. */
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

function parseListValue(rawValue: string): string[] {
  // A plain `','` rather than `/\s*,\s*/`: the padding that regex absorbed is stripped by the `.trim()` below
  // anyway, and `\s*,` retried its whitespace run from every offset — quadratic on a long run (SEC-003).
  const separator = rawValue.includes(',') ? ',' : /\s+/;
  return rawValue
    .split(separator)
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
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
      result[key] = parseListValue(rawValue);
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
function scanAgentsDir(dir: string, source: IContributionSource): IAgentDefinition[] {
  if (source.inspectKind(dir, 'discover agent directory') !== 'directory') return [];

  const agents: IAgentDefinition[] = [];
  let entries: readonly IWorkspaceDirectoryEntry[];

  try {
    entries = source.listDirectory(dir, 'discover agent definitions');
  } catch {
    // allow-fallback: unreadable agents directory returns empty list
    return [];
  }

  for (const entry of entries) {
    if (entry.kind !== 'file' || !entry.name.endsWith('.md')) continue;

    const filePath = join(dir, entry.name);
    const content = source.readText(filePath, 'load agent definition');
    if (content === undefined) continue;
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
 * 1. `<cwd>/.robota/agents/` — project-level Robota native
 * 2. `<cwd>/.agents/agents/` — project-level supported convention
 * 3. `<cwd>/.claude/agents/` — project-level Claude Code compatible
 * 4. `<home>/.robota/agents/` — user-level Robota native
 * 5. `<home>/.claude/agents/` — user-level Claude Code compatible
 *
 * Custom agents override built-in agents on name collision.
 */
export class AgentDefinitionLoader {
  private readonly builtInAgents: readonly IAgentDefinition[];

  constructor(
    private readonly sources: readonly IContributionSource[],
    // NEUT-003: injectable built-in set — replaces the default three when supplied
    // (empty array = no built-ins merged).
    builtInAgents: readonly IAgentDefinition[] = BUILT_IN_AGENTS,
  ) {
    this.builtInAgents = builtInAgents;
  }

  /** Load all agent definitions, merged with built-in agents. Custom overrides built-in on name collision. */
  loadAll(): IAgentDefinition[] {
    const discovered = this.sources.flatMap((source) => [
      scanAgentsDir(join('.robota', 'agents'), source),
      scanAgentsDir(join('.agents', 'agents'), source),
      scanAgentsDir(join('.claude', 'agents'), source),
    ]);

    // Deduplicate custom agents: higher-priority source wins
    const seen = new Set<string>();
    const customAgents: IAgentDefinition[] = [];

    for (const agents of discovered) {
      for (const agent of agents) {
        if (!seen.has(agent.name)) {
          seen.add(agent.name);
          customAgents.push(agent);
        }
      }
    }

    // Merge with the built-in tier: a discovered custom agent overrides it on name collision, and WITHIN
    // the tier the first entry wins. The first-wins rule is load-bearing for the ARCH-005 `agentDefinitions`
    // injection seam, which composes `[...injected, ...BUILT_IN_AGENTS]` into this tier: a pack-supplied
    // definition may override a framework built-in of the same name, and the roster never carries a
    // duplicate. (For a tier with no duplicate names — the historic BUILT_IN_AGENTS alone — this is a no-op.)
    const result = [...customAgents];
    for (const builtIn of this.builtInAgents) {
      if (!seen.has(builtIn.name)) {
        seen.add(builtIn.name);
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
