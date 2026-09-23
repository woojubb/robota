import { join, basename } from 'node:path';

import { BUILT_IN_AGENTS } from './built-in-agents.js';
import { decodeFrontmatter } from '../frontmatter/frontmatter-decoder.js';
import { FrontmatterDecodeError } from '../frontmatter/frontmatter-error.js';

import type { IAgentDefinition } from './agent-definition-types.js';
import type { IContributionSource } from '../contributions/contribution-source.js';
import type { IWorkspaceDirectoryEntry } from '../workspace-trust/index.js';

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
    const decoded = decodeFrontmatter({
      source: join(source.displayName, filePath),
      content,
      profile: 'agent',
    });
    if (!decoded.ok) throw new FrontmatterDecodeError(decoded.diagnostics);
    const { metadata: frontmatter, body } = decoded;
    const fallbackName = basename(entry.name, '.md');

    const agent: IAgentDefinition = {
      name: frontmatter.name ?? fallbackName,
      description: frontmatter.description ?? '',
      systemPrompt: body === content ? body : body.trim(),
    };

    if (frontmatter.model !== undefined) agent.model = frontmatter.model;
    if (frontmatter.maxTurns !== undefined) agent.maxTurns = frontmatter.maxTurns;
    if (frontmatter.tools !== undefined) agent.tools = frontmatter.tools;
    if (frontmatter.disallowedTools !== undefined)
      agent.disallowedTools = frontmatter.disallowedTools;

    agents.push(agent);
  }

  return agents;
}

/**
 * Loads agent definitions from project and user directories, merging
 * them with built-in agents.
 *
 * The host supplies ordered relative roots; no product directory is selected here.
 * Sources are searched in order, then roots in order, with the first definition winning.
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
    private readonly roots: readonly string[] = [],
  ) {
    this.builtInAgents = builtInAgents;
  }

  /** Load all agent definitions, merged with built-in agents. Custom overrides built-in on name collision. */
  loadAll(): IAgentDefinition[] {
    const discovered = this.sources.flatMap((source) =>
      this.roots.map((root) => scanAgentsDir(root, source)),
    );

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
