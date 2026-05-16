/**
 * Context file refresh helper for InteractiveSession.
 *
 * Checks if AGENTS.md/CLAUDE.md context entries are stale and
 * refreshes them before each prompt turn.
 */

import type { IContextFileEntry } from '../context/context-file-tracker.js';
import { refreshContextEntries } from '../context/context-file-tracker.js';
import type { ICreatedInteractiveSession } from './interactive-session-init.js';

export async function checkAndRefreshContextIfStale(
  agentsFileEntries: IContextFileEntry[],
  claudeFileEntries: IContextFileEntry[],
  rebuildSystemMessage: ICreatedInteractiveSession['rebuildSystemMessage'] | null,
  setEntries: (agents: IContextFileEntry[], claude: IContextFileEntry[]) => void,
  getSessionOrThrow: () => { updateSystemMessage: (msg: string) => void },
  emit: (event: string, payload: unknown) => void,
): Promise<void> {
  if (!rebuildSystemMessage) return;
  const allEntries = [...agentsFileEntries, ...claudeFileEntries];
  if (allEntries.length === 0) return;

  const agentsCount = agentsFileEntries.length;
  const { updated, refreshed } = await refreshContextEntries(allEntries);
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
