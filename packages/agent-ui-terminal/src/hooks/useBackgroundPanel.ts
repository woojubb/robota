/**
 * The background panel's two data concerns as one call: what the selected entry's detail page says,
 * and what happens when the operator attaches to a forked one.
 *
 * Both belong to the same surface and both are read by the same component, so `App` asks for them
 * once rather than wiring two hooks whose inputs it has to keep in step. Split out because CLI-2004
 * had already brought `App.tsx` to its size budget by extracting the detail read, and CLI-1994 adds
 * the attach handler beside it — growing the file was the alternative the size rule forbids.
 */

import { useMemo } from 'react';

import { useExecutionDetailPage } from './useExecutionDetailPage.js';
import { useForkAttach } from './useForkAttach.js';

import type { IExecutionDetailState } from './useExecutionDetailPage.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

export interface IUseBackgroundPanelOptions {
  /** Which entry the switcher has selected; resolved against the snapshot below. */
  readonly selectedEntryId: string | undefined;
  /** The panel's data, and the re-read trigger — the detail follows a running task's output. */
  readonly snapshot: IExecutionWorkspaceSnapshot | null;
  readonly read: (entryId: string) => Promise<IExecutionDetailPage>;
  /** Absent ⇒ this surface cannot open another session's record, and attach says so. */
  readonly sessionStore: IInteractiveSessionStore | undefined;
  readonly onSessionSwitch: (sessionId: string) => void;
  readonly addEntry: (entry: IHistoryEntry) => void;
}

export interface IBackgroundPanel {
  /** The selected entry itself, which the switcher and the detail view both render. */
  readonly entry: IExecutionWorkspaceEntry | undefined;
  readonly detail: IExecutionDetailState;
  readonly attachToFork: (entry: IExecutionWorkspaceEntry) => void;
}

/** Wire the background panel's detail read and its attach handler together. */
export function useBackgroundPanel(inputs: IUseBackgroundPanelOptions): IBackgroundPanel {
  const { snapshot, selectedEntryId } = inputs;
  const entry = useMemo(
    () => snapshot?.entries.find((candidate) => candidate.id === selectedEntryId),
    [snapshot, selectedEntryId],
  );
  const detail = useExecutionDetailPage({ entry, snapshot, read: inputs.read });
  const attachToFork = useForkAttach({
    sessionStore: inputs.sessionStore,
    onSessionSwitch: inputs.onSessionSwitch,
    addEntry: inputs.addEntry,
  });
  return { entry, detail, attachToFork };
}
