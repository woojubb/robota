/** Root-bounded project context loading through an explicit workspace reader. */
import { computeContentHash } from './context-file-tracker.js';
import { loadTaskContext } from './task-context.js';
import { assertWorkspaceProjectReader } from '../workspace-trust/index.js';

import type { IContextFileEntry } from './context-file-tracker.js';
import type { IMemoryStore } from '../memory/types.js';
import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

export type { IContextFileEntry };

export interface ILoadedContext {
  /** Concatenated content of all AGENTS.md files found (root-first) */
  agentsMd: string;
  /** Concatenated content of all CLAUDE.md files found (root-first) */
  projectNotesMd: string;
  /** Startup project memory index loaded from .robota/memory/MEMORY.md, if present */
  memoryMd?: string;
  /** Formatted active task context loaded from .agents/tasks/*.md, if present */
  taskContext?: string;
  /** Extracted "Compact Instructions" section from CLAUDE.md, if present */
  compactInstructions?: string;
  /** Per-file entries for all AGENTS.md files, root-first. Present for staleness detection. */
  agentsFileEntries?: IContextFileEntry[];
  /** Per-file entries for all CLAUDE.md files, root-first. Present for staleness detection. */
  projectNotesFileEntries?: IContextFileEntry[];
}

const AGENTS_FILENAME = 'AGENTS.md';
const CLAUDE_FILENAME = 'CLAUDE.md';

/** NEUT-004: context-load behavior toggles (settings-driven at the composition root). */
export interface ILoadContextOptions {
  /**
   * Active-task context injection. Default preserves today's behavior (enabled,
   * scanning `.agents/tasks`); `enabled: false` skips the scan entirely; `dir`
   * replaces the scan directory (relative to cwd).
   */
  taskContext?: {
    enabled?: boolean;
    dir?: string;
  };
  /** Host-owned parent/organization context, already hydrated outside project authority. */
  hostContext?: {
    agents?: readonly IContextFileEntry[];
    projectNotes?: readonly IContextFileEntry[];
  };
}

export interface IWorkspaceProjectContextSource {
  reader: IWorkspaceProjectReader;
  /** Directory relative to the authenticated root where the session starts. */
  startRelativeDirectory?: string;
  /** Host-resolved Git metadata; project `.git` content is never followed by this loader. */
  currentBranch?: string;
}

function trackedEntries(
  source: IWorkspaceProjectContextSource,
  filename: string,
  purpose: string,
): IContextFileEntry[] {
  return assertWorkspaceProjectReader(source.reader)
    .readTextAlongAncestors(source.startRelativeDirectory ?? '', filename, purpose)
    .map((entry) => ({
      filePath: entry.relativePath,
      content: entry.content,
      contentHash: computeContentHash(entry.content),
    }));
}

/**
 * Extract the "Compact Instructions" section from CLAUDE.md content.
 * Looks for a markdown heading (any level) containing "Compact Instructions"
 * and returns all content until the next heading of the same or higher level.
 */
function extractCompactInstructions(content: string): string | undefined {
  const lines = content.split('\n');
  let capturing = false;
  let headingLevel = 0;
  const captured: string[] = [];

  for (const line of lines) {
    const headingMatch = /^(#{1,6})\s+/.exec(line);
    if (headingMatch) {
      if (capturing) {
        // Stop if we hit a heading of same or higher level
        if (headingMatch[1].length <= headingLevel) break;
      }
      if (/compact\s+instructions/i.test(line)) {
        capturing = true;
        headingLevel = headingMatch[1].length;
        continue;
      }
    }
    if (capturing) {
      captured.push(line);
    }
  }

  const result = captured.join('\n').trim();
  return result || undefined;
}

/**
 * Load project AGENTS.md and CLAUDE.md only within the authenticated root. Pre-hydrated host context,
 * when present, is ordered before project context and never grants project filesystem access.
 */
export async function loadContext(
  source: IWorkspaceProjectContextSource | undefined,
  memoryStore?: IMemoryStore,
  options: ILoadContextOptions = {},
): Promise<ILoadedContext> {
  const agentsEntries = [
    ...(options.hostContext?.agents ?? []),
    ...(source === undefined
      ? []
      : trackedEntries(source, AGENTS_FILENAME, 'load project agent instructions')),
  ];
  const claudeEntries = [
    ...(options.hostContext?.projectNotes ?? []),
    ...(source === undefined ? [] : trackedEntries(source, CLAUDE_FILENAME, 'load project notes')),
  ];

  const agentsMd = agentsEntries.map((e) => e.content).join('\n\n');
  const projectNotesMd = claudeEntries.map((e) => e.content).join('\n\n');

  const compactInstructions = extractCompactInstructions(projectNotesMd);
  const startupMemory = await memoryStore?.loadStartupMemory();
  const memoryMd = startupMemory?.content || undefined;
  // NEUT-004: task-context injection is off-switchable; disabled ⇒ no scan is performed.
  const taskContextEnabled = options.taskContext?.enabled !== false;
  const loadedTaskContext =
    taskContextEnabled && source !== undefined
      ? loadTaskContext(source.reader, {
          ...(options.taskContext?.dir ? { dir: options.taskContext.dir } : {}),
          ...(source.currentBranch ? { currentBranch: source.currentBranch } : {}),
        })
      : '';
  const taskContext = loadedTaskContext.trim().length > 0 ? loadedTaskContext : undefined;

  return {
    agentsMd,
    projectNotesMd,
    memoryMd,
    taskContext,
    compactInstructions,
    agentsFileEntries: agentsEntries,
    projectNotesFileEntries: claudeEntries,
  };
}
