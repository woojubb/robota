import { Box, useInput } from 'ink';
import React from 'react';

import { useWorkspaceSwitcherSelection } from './execution-workspace-switcher-selection.js';
import { formatExecutionWorkspaceEntryRow } from './execution-workspace-view-model.js';
import { getVerticalSelectionInputAction } from './flows/selection-flow.js';
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

/** Footer for the workspace switcher (order: navigate → primary → dismiss). */
export const EXECUTION_WORKSPACE_SWITCHER_FOOTER_HINTS: readonly IKeyHint[] = [
  { keys: '↑↓', label: 'Navigate' },
  { keys: 'Enter', label: 'Switch' },
  { keys: 'Ctrl+B/Esc', label: 'Close' },
];

/**
 * CLI-1994: the extra hint shown only while a forked entry is focused. Appended rather than always
 * present, because a key that does nothing on most rows reads as a broken key, not an unused one.
 */
export const EXECUTION_WORKSPACE_ATTACH_HINT: IKeyHint = { keys: 'a', label: 'Attach' };

/** The key that attaches to a forked session. Lower-case only; `A` is left free. */
const ATTACH_KEY = 'a';

interface IProps {
  snapshot: IExecutionWorkspaceSnapshot | null;
  selectedEntryId?: string;
  onSelect: (entryId: string) => void;
  onClose: () => void;
  /**
   * CLI-1994: attach to the focused entry's forked session — a VIEW switch onto that record, never
   * a merge. Absent when the surface cannot switch sessions; the control is then not offered.
   */
  onAttach?: (entry: IExecutionWorkspaceEntry) => void;
}

/** CLI-1994: `attach` is offered by the projection; the switcher only reads what it was handed. */
function offersAttach(entry: IExecutionWorkspaceEntry | undefined): boolean {
  return entry?.controls.includes('attach') === true;
}

export default function ExecutionWorkspaceSwitcher({
  snapshot,
  selectedEntryId,
  onSelect,
  onClose,
  onAttach,
}: IProps): React.ReactElement {
  const entries = [...(snapshot?.entries ?? [])];
  const { normalized, visibleEntries, applyAction } = useWorkspaceSwitcherSelection({
    entries,
    selectedEntryId,
    onSelect,
    onClose,
  });
  const focusedEntry = entries[normalized.selectedIndex];
  const canAttach = onAttach !== undefined && offersAttach(focusedEntry);

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
    (input, key) => {
      // CLI-1994: `a` attaches to the focused fork. Guarded against the modifiers because Ink
      // reports Ctrl+A as the letter with `ctrl` set, and a chord must not attach silently.
      if (
        canAttach &&
        input === ATTACH_KEY &&
        key.ctrl !== true &&
        key.meta !== true &&
        focusedEntry
      ) {
        // Attaching replaces what the terminal is looking at, so the switcher has nothing left to
        // switch between — it closes itself rather than making every caller remember to.
        onAttach(focusedEntry);
        onClose();
        return;
      }
      const action = getVerticalSelectionInputAction(key);
      if (action !== undefined) applyAction(action);
    },
    { isActive: !screenReader },
  );

  return (
    <Box
      flexDirection="column"
      {...(screenReader
        ? {}
        : { borderStyle: 'round' as const, borderColor: PALETTE.border.focused })}
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
        <KeyHintFooter
          hints={
            canAttach
              ? [...EXECUTION_WORKSPACE_SWITCHER_FOOTER_HINTS, EXECUTION_WORKSPACE_ATTACH_HINT]
              : EXECUTION_WORKSPACE_SWITCHER_FOOTER_HINTS
          }
        />
      )}
    </Box>
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
