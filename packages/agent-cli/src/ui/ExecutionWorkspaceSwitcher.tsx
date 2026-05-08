import React, { useEffect, useRef, useState } from 'react';
import { Box, Text, useInput } from 'ink';
import type { IExecutionWorkspaceEntry, IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-sdk';
import {
  applySelectionInput,
  createSelectionFlowState,
  getVerticalSelectionInputAction,
  normalizeSelectionState,
  type ISelectionFlowState,
  type TSelectionInputAction,
} from './flows/selection-flow.js';
import { formatExecutionWorkspaceEntryRow } from './execution-workspace-view-model.js';

const MAX_VISIBLE_WORKSPACE_ENTRIES = 8;

interface IProps {
  snapshot: IExecutionWorkspaceSnapshot | null;
  selectedEntryId?: string;
  onSelect: (entryId: string) => void;
  onClose: () => void;
}

export default function ExecutionWorkspaceSwitcher({
  snapshot,
  selectedEntryId,
  onSelect,
  onClose,
}: IProps): React.ReactElement {
  const entries = [...(snapshot?.entries ?? [])];
  const { normalized, visibleEntries, applyAction } = useWorkspaceSwitcherSelection({
    entries,
    selectedEntryId,
    onSelect,
    onClose,
  });

  useInput((_input, key) => {
    const action = getVerticalSelectionInputAction(key);
    if (action !== undefined) applyAction(action);
  });

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="cyan" paddingX={1}>
      <Text color="cyan" bold>
        Execution workspace
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.length === 0 ? (
          <Text dimColor>No workspace entries</Text>
        ) : (
          visibleEntries.map((entry, index) => (
            <ExecutionWorkspaceSwitcherRow
              key={entry.id}
              entry={entry}
              isFocused={normalized.scrollOffset + index === normalized.selectedIndex}
              selectedEntryId={selectedEntryId}
            />
          ))
        )}
      </Box>
      <Text dimColor>Ctrl+B Close ↑↓ Navigate Enter Switch Esc Close</Text>
    </Box>
  );
}

interface IUseWorkspaceSwitcherSelectionInput {
  entries: IExecutionWorkspaceEntry[];
  selectedEntryId?: string;
  onSelect: (entryId: string) => void;
  onClose: () => void;
}

function useWorkspaceSwitcherSelection({
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

function ExecutionWorkspaceSwitcherRow({
  entry,
  isFocused,
  selectedEntryId,
}: {
  entry: IExecutionWorkspaceEntry;
  isFocused: boolean;
  selectedEntryId?: string;
}): React.ReactElement {
  const row = formatExecutionWorkspaceEntryRow(entry, { selectedEntryId });
  return (
    <Text>
      <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>
        {isFocused ? '> ' : '  '}
      </Text>
      <Text color={row.color}>{row.radio}</Text>
      <Text color={isFocused ? 'cyan' : undefined} bold={isFocused}>{` ${row.title}`}</Text>
      <Text dimColor>{` · ${row.statusLabel}`}</Text>
      {row.subtitle ? <Text dimColor>{` · ${row.subtitle}`}</Text> : null}
      {row.preview ? <Text dimColor>{` · ${row.preview}`}</Text> : null}
    </Text>
  );
}
