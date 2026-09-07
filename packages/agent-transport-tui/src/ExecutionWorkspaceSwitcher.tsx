import { Box, useInput } from 'ink';
import React, { useEffect, useRef, useState } from 'react';

import { formatExecutionWorkspaceEntryRow } from './execution-workspace-view-model.js';
import {
  applySelectionInput,
  createSelectionFlowState,
  getVerticalSelectionInputAction,
  normalizeSelectionState,
  type ISelectionFlowState,
  type TSelectionInputAction,
} from './flows/selection-flow.js';
import { useNumberedSelection } from './hooks/useNumberedSelection.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';
import { formatNumberedSelectionPrompt, numberedRowPrefix } from './numbered-list.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { PALETTE } from './tui-palette.js';

import type {
  IExecutionWorkspaceEntry,
  IExecutionWorkspaceSnapshot,
} from '@robota-sdk/agent-interface-execution';

const MAX_VISIBLE_WORKSPACE_ENTRIES = 8;

/** Footer for the workspace switcher (order: navigate → primary → dismiss). */
export const EXECUTION_WORKSPACE_SWITCHER_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: '↑↓', label: 'Navigate' },
  { keys: 'Enter', label: 'Switch' },
  { keys: 'Ctrl+B/Esc', label: 'Close' },
];

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

  // CLI-2004: the switcher is an arrow-key menu, so the mode gives it numbers and a typed answer.
  const screenReader = useScreenReader();
  const numbered = useNumberedSelection({
    enabled: screenReader && entries.length > 0,
    itemCount: entries.length,
    cancellable: true,
    onSelect: (index) => {
      const entry = entries[index];
      if (entry) onSelect(entry.id);
    },
    onCancel: onClose,
  });

  useInput(
    (_input, key) => {
      const action = getVerticalSelectionInputAction(key);
      if (action !== undefined) applyAction(action);
    },
    { isActive: !screenReader },
  );

  return (
    <Box
      flexDirection="column"
      {...(screenReader ? {} : { borderStyle: 'round' as const, borderColor: PALETTE.border.focused })}
      paddingX={1}
    >
      <Text color={PALETTE.text.accent} bold>
        Execution workspace
      </Text>
      <Box flexDirection="column" marginTop={1}>
        {visibleEntries.length === 0 ? (
          <Text dimColor>No workspace entries</Text>
        ) : screenReader ? (
          entries.map((entry, index) => (
            <ExecutionWorkspaceSwitcherRow
              key={entry.id}
              entry={entry}
              isFocused={false}
              selectedEntryId={selectedEntryId}
              rowNumber={index}
            />
          ))
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
      {screenReader ? (
        <ScreenReaderSelectionPrompt
          itemCount={entries.length}
          buffer={numbered.buffer}
          invalid={numbered.invalid}
        />
      ) : (
        <KeyHintFooter hints={EXECUTION_WORKSPACE_SWITCHER_FOOTER_HINTS} />
      )}
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

/** The typed-selection prompt, re-printed verbatim after an out-of-range answer. */
function ScreenReaderSelectionPrompt({
  itemCount,
  buffer,
  invalid,
}: {
  itemCount: number;
  buffer: string;
  invalid: boolean;
}): React.ReactElement {
  const prompt = formatNumberedSelectionPrompt(itemCount, true);
  return (
    <Box flexDirection="column">
      <Text>
        {prompt}
        {buffer.length > 0 ? ` ${buffer}` : ''}
      </Text>
      {invalid && <Text>{prompt}</Text>}
    </Box>
  );
}

function ExecutionWorkspaceSwitcherRow({
  entry,
  isFocused,
  selectedEntryId,
  rowNumber,
}: {
  entry: IExecutionWorkspaceEntry;
  isFocused: boolean;
  selectedEntryId?: string;
  rowNumber?: number;
}): React.ReactElement {
  const row = formatExecutionWorkspaceEntryRow(entry, { selectedEntryId });
  return (
    <Text>
      <Text color={isFocused ? PALETTE.text.accent : undefined} bold={isFocused}>
        {rowNumber !== undefined
          ? numberedRowPrefix(rowNumber)
          : isFocused
            ? SELECTION_INDICATOR
            : SELECTION_INDICATOR_NONE}
      </Text>
      <Text color={row.color}>{row.radio}</Text>
      <Text
        color={isFocused ? PALETTE.text.accent : undefined}
        bold={isFocused}
      >{` ${row.title}`}</Text>
      <Text dimColor>{` · ${row.statusLabel}`}</Text>
      {row.subtitle ? <Text dimColor>{` · ${row.subtitle}`}</Text> : null}
      {row.preview ? <Text dimColor>{` · ${row.preview}`}</Text> : null}
    </Text>
  );
}
