/**
 * Context file refresh helper for InteractiveSession.
 *
 * Checks if AGENTS.md/CLAUDE.md context entries are stale and
 * refreshes them before each prompt turn.
 */

import { refreshContextEntries } from '../context/context-file-tracker.js';

import type { ICreatedInteractiveSession } from './interactive-session-init.js';
import type { IContextFileEntry } from '../context/context-file-tracker.js';
import type { IWorkspaceProjectReader } from '../workspace-trust/index.js';

export type TContextRefreshSource =
  { status: 'unavailable' } | { status: 'authorized'; reader: IWorkspaceProjectReader };

export async function checkAndRefreshContextIfStale(
  agentsFileEntries: IContextFileEntry[],
  projectNotesFileEntries: IContextFileEntry[],
  rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null,
  source: TContextRefreshSource,
  setEntries: (agents: IContextFileEntry[], claude: IContextFileEntry[]) => void,
  getSessionOrThrow: () => { updateSystemMessage: (msg: string) => void },
  emit: (event: string, payload: unknown) => void,
): Promise<void> {
  if (source.status === 'unavailable') return;
  if (!rebuildSystemMessage) return;
  const allEntries = [...agentsFileEntries, ...projectNotesFileEntries];
  if (allEntries.length === 0) return;

  const agentsCount = agentsFileEntries.length;
  const { updated, refreshed } = await refreshContextEntries(allEntries, source.reader);
  if (refreshed.length === 0) return;

  const newAgents = updated.slice(0, agentsCount);
  const newClaude = updated.slice(agentsCount);
  setEntries(newAgents, newClaude);

  const newSystemMessage = rebuildSystemMessage(
    newAgents.map((e) => e.content).join('\n\n'),
    newClaude.map((e) => e.content).join('\n\n'),
  );
  getSessionOrThrow().updateSystemMessage(newSystemMessage);

  for (const filePath of refreshed) {
    emit('context_file_refreshed', { filePath });
  }
}
