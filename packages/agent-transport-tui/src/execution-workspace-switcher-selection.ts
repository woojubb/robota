/**
 * The switcher's selection state: where the cursor is, which slice of entries is on screen, and what
 * a keypress does to both.
 *
 * Split out of `ExecutionWorkspaceSwitcher.tsx` (CLI-1994 + CLI-2004 both grew that file past its
 * size budget) along the seam that was already there: this half owns "what is selected", the
 * component owns "what is drawn".
 */

import { useEffect, useRef, useState } from 'react';

import {
  applySelectionInput,
  createSelectionFlowState,
  normalizeSelectionState,
  type ISelectionFlowState,
  type TSelectionInputAction,
} from './flows/selection-flow.js';

import type { IExecutionWorkspaceEntry } from '@robota-sdk/agent-interface-execution';
import type React from 'react';

/** How many entries the list shows at once; the rest scroll. */
export const MAX_VISIBLE_WORKSPACE_ENTRIES = 8;

export interface IUseWorkspaceSwitcherSelectionInput {
  entries: IExecutionWorkspaceEntry[];
  selectedEntryId?: string;
  onSelect: (entryId: string) => void;
  onClose: () => void;
}

export function useWorkspaceSwitcherSelection({
  entries,
  selectedEntryId,
  onSelect,
  onClose,
}: IUseWorkspaceSwitcherSelectionInput): {
  normalized: ISelectionFlowState;
  visibleEntries: IExecutionWorkspaceEntry[];
  applyAction: (action: TSelectionInputAction) => void;
} {
  const [state, setState] = useState<ISelectionFlowState>(() => createSelectionFlowState());
  const stateRef = useRef(state);

  useEffect(() => {
    const selectedIndex = Math.max(
      0,
      entries.findIndex((entry) => entry.id === selectedEntryId),
    );
    const nextState = createNormalizedSelection({ selectedIndex, itemCount: entries.length });
    stateRef.current = nextState;
    setState(nextState);
  }, [entries.length, selectedEntryId]);

  const normalized = createNormalizedSelection({
    selectedIndex: state.selectedIndex,
    scrollOffset: state.scrollOffset,
    itemCount: entries.length,
  });
  if (normalized !== state) stateRef.current = normalized;
  return {
    normalized,
    visibleEntries: entries.slice(
      normalized.scrollOffset,
      normalized.scrollOffset + MAX_VISIBLE_WORKSPACE_ENTRIES,
    ),
    applyAction: createApplyAction({ entries, stateRef, setState, onSelect, onClose }),
  };
}

function createApplyAction({
  entries,
  stateRef,
  setState,
  onSelect,
  onClose,
}: {
  entries: IExecutionWorkspaceEntry[];
  stateRef: React.MutableRefObject<ISelectionFlowState>;
  setState: React.Dispatch<React.SetStateAction<ISelectionFlowState>>;
  onSelect: (entryId: string) => void;
  onClose: () => void;
}): (action: TSelectionInputAction) => void {
  return (action): void => {
    const result = applySelectionInput(stateRef.current, action, {
      itemCount: entries.length,
      maxVisible: MAX_VISIBLE_WORKSPACE_ENTRIES,
    });
    const nextState =
      result.effect.type === 'select' || result.effect.type === 'cancel'
        ? { ...result.state, resolved: false }
        : result.state;
    stateRef.current = nextState;
    setState(nextState);
    if (result.effect.type === 'cancel') {
      onClose();
    } else if (result.effect.type === 'select') {
      const entry = entries[result.effect.index];
      if (entry) onSelect(entry.id);
    }
  };
}

function createNormalizedSelection(input: {
  selectedIndex: number;
  scrollOffset?: number;
  itemCount: number;
}): ISelectionFlowState {
  return normalizeSelectionState(
    {
      selectedIndex: input.selectedIndex,
      scrollOffset: input.scrollOffset ?? 0,
      resolved: false,
    },
    { itemCount: input.itemCount, maxVisible: MAX_VISIBLE_WORKSPACE_ENTRIES },
  );
}
