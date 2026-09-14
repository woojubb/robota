import { useInput } from 'ink';
import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  countActiveBackgroundWorkspaceEntries,
  getDefaultBackgroundWorkspaceEntries,
} from '../execution-workspace-view-model.js';
import { useBackgroundPanel } from './useBackgroundPanel.js';
import { resolveBackgroundFocusKey } from '../flows/background-focus-flow.js';

import type { IAppBackgroundViewModel } from '../app-view-model.js';
import type { IHistoryEntry } from '@robota-sdk/agent-core';
import type {
  IExecutionDetailPage,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';
import type { IInteractiveSessionStore } from '@robota-sdk/agent-interface-session';

export interface IAppWorkspaceState {
  readonly background: IAppBackgroundViewModel;
  readonly activeBackgroundTaskCount: number;
  readonly activeAgentLabel: string | undefined;
  readonly mainThreadEntryId: string | undefined;
  readonly isSelectedEntryInteractive: boolean;
  readonly isBackgroundListFocused: boolean;
  readonly openSwitcher: () => void;
  readonly toggleSwitcher: () => void;
  readonly focusBackgroundList: () => void;
}

interface IOptions {
  readonly snapshot: IExecutionWorkspaceSnapshot | null;
  readonly selectedEntryId: string | undefined;
  readonly select: (entryId: string) => void;
  readonly read: (entryId: string) => Promise<IExecutionDetailPage>;
  readonly sessionStore: IInteractiveSessionStore | undefined;
  readonly onSessionSwitch: (sessionId: string) => Promise<void>;
  readonly addEntry: (entry: IHistoryEntry) => void;
  readonly navigationEnabled: boolean;
  readonly switcherVisible: boolean;
  readonly setSwitcherVisible: (visible: boolean | ((current: boolean) => boolean)) => void;
}

interface ISwitcherActions {
  readonly open: () => void;
  readonly toggle: () => void;
  readonly close: () => void;
}

function useBackgroundListKeys(
  focusedIndex: number | null,
  entryIds: readonly string[],
  setFocusedIndex: (index: number | null) => void,
  select: (entryId: string) => void,
  enabled: boolean,
): void {
  useInput(
    (_input, key) => {
      if (focusedIndex === null) return;
      const action = resolveBackgroundFocusKey(focusedIndex, entryIds.length, key);
      if (action.type === 'move') setFocusedIndex(action.index);
      if (action.type === 'open') {
        const entryId = entryIds[action.index];
        if (entryId) select(entryId);
        setFocusedIndex(null);
      }
      if (action.type === 'exit') setFocusedIndex(null);
    },
    { isActive: focusedIndex !== null && enabled },
  );
}

function useBackgroundFocus(
  entryIds: readonly string[],
  select: (entryId: string) => void,
  enabled: boolean,
): { focusedIndex: number | null; focusList: () => void } {
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  useEffect(() => {
    setFocusedIndex((index) => {
      if (index === null || entryIds.length === 0) return null;
      return Math.min(index, entryIds.length - 1);
    });
  }, [entryIds.length]);
  useBackgroundListKeys(focusedIndex, entryIds, setFocusedIndex, select, enabled);
  const focusList = useCallback(() => {
    if (entryIds.length > 0) setFocusedIndex(0);
  }, [entryIds.length]);
  return { focusedIndex, focusList };
}

function useSwitcherActions(setVisible: IOptions['setSwitcherVisible']): ISwitcherActions {
  const open = useCallback(() => setVisible(true), [setVisible]);
  const toggle = useCallback(() => setVisible((visible) => !visible), [setVisible]);
  const close = useCallback(() => setVisible(false), [setVisible]);
  return { open, toggle, close };
}

export function useAppWorkspaceState(options: IOptions): IAppWorkspaceState {
  const entries = useMemo(
    () => getDefaultBackgroundWorkspaceEntries(options.snapshot),
    [options.snapshot],
  );
  const { focusedIndex, focusList } = useBackgroundFocus(
    entries.map((entry) => entry.id),
    options.select,
    options.navigationEnabled,
  );

  const panel = useBackgroundPanel({
    selectedEntryId: options.selectedEntryId,
    snapshot: options.snapshot,
    read: options.read,
    sessionStore: options.sessionStore,
    onSessionSwitch: options.onSessionSwitch,
    addEntry: options.addEntry,
  });
  const switcher = useSwitcherActions(options.setSwitcherVisible);
  const selected = panel.entry;
  return {
    background: {
      entries,
      focusedIndex,
      selectedEntry: selected,
      detail: panel.detail,
      switcherVisible: options.switcherVisible,
      snapshot: options.snapshot,
      selectedEntryId: options.selectedEntryId,
      select: options.select,
      closeSwitcher: switcher.close,
      attachToFork: panel.attachToFork,
    },
    activeBackgroundTaskCount: countActiveBackgroundWorkspaceEntries(options.snapshot),
    activeAgentLabel: selected?.kind === 'main_thread' ? undefined : selected?.title,
    mainThreadEntryId: options.snapshot?.entries.find((entry) => entry.kind === 'main_thread')?.id,
    isSelectedEntryInteractive:
      !selected || selected.kind === 'main_thread' || selected.controls.includes('send'),
    isBackgroundListFocused: focusedIndex !== null,
    openSwitcher: switcher.open,
    toggleSwitcher: switcher.toggle,
    focusBackgroundList: focusList,
  };
}
