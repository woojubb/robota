/**
 * Multi-select checklist (CMD-004): arrow-key navigation, Space toggles, Enter confirms once the
 * selection count is within [minSelect, maxSelect], Esc cancels. Used by PendingActionPrompt for an
 * IActionRequest whose `maxSelect` > 1.
 *
 * Note: unlike ListPicker, this renders all options without a scroll viewport — `IActionRequest`'s
 * optional `maxVisible` hint is not yet honored here (multi-select lists are typically short). Adding a
 * viewport is a follow-up if long multi-select lists appear.
 */

import { Box, useInput } from 'ink';
import React, { useState } from 'react';

import { useNumberedSelection } from './hooks/useNumberedSelection.js';
import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';
import { NumberedSelectionPrompt, numberedRowPrefix } from './numbered-list.js';
import { Text } from './SafeText.js';
import { useScreenReader } from './screen-reader-context.js';
import { PALETTE } from './tui-palette.js';

import type { IActionOption } from '@robota-sdk/agent-core';

/**
 * Footer hints for the multi-select checklist. The Enter hint carries a dynamic `(min N)` segment
 * until the selection is confirmable.
 */
export function getMultiSelectFooterHints(input: {
  canConfirm: boolean;
  minSelect: number;
}): readonly IKeyHint[] {
  return [
    { keys: '↑↓', label: 'Navigate' },
    { keys: 'Space', label: 'Toggle' },
    { keys: 'Enter', label: input.canConfirm ? 'Confirm' : `Confirm (min ${input.minSelect})` },
    { keys: 'Esc', label: 'Cancel' },
  ];
}

/**
 * One checklist row. The mode swaps the position cue — a spoken number for the `> ` cursor and its
 * colour — and nothing else: the checkbox is what says selected, in both.
 */
function ChecklistRow({
  label,
  index,
  isCursor,
  isChecked,
  screenReader,
}: {
  label: string;
  index: number;
  isCursor: boolean;
  isChecked: boolean;
  screenReader: boolean;
}): React.ReactElement {
  const box = isChecked ? '[x] ' : '[ ] ';
  if (screenReader) {
    return (
      <Text>
        {numberedRowPrefix(index)}
        {box}
        {label}
      </Text>
    );
  }
  return (
    <Text color={isCursor ? PALETTE.text.accent : undefined}>
      {isCursor ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
      {box}
      {label}
    </Text>
  );
}

export interface IMultiSelectListProps {
  title: string;
  description?: string;
  options: readonly IActionOption[];
  minSelect: number;
  maxSelect: number;
  defaultValues?: readonly string[];
  onConfirm: (values: string[]) => void;
  onCancel: () => void;
}

/** The arrow-key driver: cursor motion, Space toggles, Enter confirms. Inactive in the mode. */
function useChecklistArrowKeys(inputs: {
  active: boolean;
  itemCount: number;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
  onToggleAtCursor: () => void;
  onConfirm: () => void;
  onCancel: () => void;
}): void {
  const { active, itemCount, setCursor } = inputs;
  useInput(
    (input, key) => {
      if (key.upArrow) {
        setCursor((c) => (c <= 0 ? itemCount - 1 : c - 1));
      } else if (key.downArrow) {
        setCursor((c) => (c >= itemCount - 1 ? 0 : c + 1));
      } else if (input === ' ') {
        inputs.onToggleAtCursor();
      } else if (key.return) {
        inputs.onConfirm();
      } else if (key.escape) {
        inputs.onCancel();
      }
    },
    { isActive: active },
  );
}

/** How the checklist asks for an answer: a spoken range in the mode, the key hints otherwise. */
function ChecklistAnswer(props: {
  screenReader: boolean;
  itemCount: number;
  numbered: { buffer: string; invalid: boolean };
  canConfirm: boolean;
  minSelect: number;
}): React.ReactElement {
  if (props.screenReader) {
    return (
      <NumberedSelectionPrompt
        itemCount={props.itemCount}
        cancellable
        buffer={props.numbered.buffer}
        invalid={props.numbered.invalid}
      />
    );
  }
  return (
    <KeyHintFooter
      hints={getMultiSelectFooterHints({
        canConfirm: props.canConfirm,
        minSelect: props.minSelect,
      })}
    />
  );
}

/** The rendered checklist: the rows, and whichever answer affordance the mode calls for. */
function ChecklistView(props: {
  title: string;
  description?: string;
  options: readonly IActionOption[];
  cursor: number;
  selected: ReadonlySet<string>;
  screenReader: boolean;
  canConfirm: boolean;
  minSelect: number;
  numbered: { buffer: string; invalid: boolean };
}): React.ReactElement {
  const { title, description, options, cursor, selected, screenReader, numbered } = props;
  return (
    <Box
      flexDirection="column"
      {...(screenReader
        ? {}
        : { borderStyle: 'round' as const, borderColor: PALETTE.border.attention })}
      paddingX={1}
    >
      <Text color={PALETTE.text.warning} bold>
        {title}
      </Text>
      {description !== undefined && description.length > 0 && <Text dimColor>{description}</Text>}
      {options.map((option, index) => (
        <ChecklistRow
          key={option.value}
          label={option.label}
          index={index}
          isCursor={index === cursor}
          isChecked={selected.has(option.value)}
          screenReader={screenReader}
        />
      ))}
      <ChecklistAnswer
        screenReader={screenReader}
        itemCount={options.length}
        numbered={numbered}
        canConfirm={props.canConfirm}
        minSelect={props.minSelect}
      />
    </Box>
  );
}

/** The checklist's own state: which row the cursor is on, what is ticked, and how it commits. */
function useChecklistSelection(inputs: {
  options: readonly IActionOption[];
  minSelect: number;
  maxSelect: number;
  defaultValues?: readonly string[];
  onConfirm: (values: string[]) => void;
}): {
  cursor: number;
  setCursor: React.Dispatch<React.SetStateAction<number>>;
  selected: ReadonlySet<string>;
  toggleAt: (index: number) => void;
  confirmIfAllowed: () => void;
} {
  const { options, minSelect, maxSelect, defaultValues, onConfirm } = inputs;
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(defaultValues ?? []));

  const toggleAt = (index: number): void => {
    const option = options[index];
    if (option === undefined) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(option.value)) {
        next.delete(option.value);
      } else if (next.size < maxSelect) {
        next.add(option.value);
      }
      return next;
    });
  };
  const confirmIfAllowed = (): void => {
    if (selected.size >= minSelect) onConfirm([...selected]);
  };

  return { cursor, setCursor, selected, toggleAt, confirmIfAllowed };
}

export default function MultiSelectList({
  title,
  description,
  options,
  minSelect,
  maxSelect,
  defaultValues,
  onConfirm,
  onCancel,
}: IMultiSelectListProps): React.ReactElement {
  // CLI-2004: the checklist keeps its own reducer (Space toggles, Enter confirms) — what the mode
  // changes is the ROW: a spoken number replaces the `> ` cursor, and typing that number toggles it.
  const screenReader = useScreenReader();
  const { cursor, setCursor, selected, toggleAt, confirmIfAllowed } = useChecklistSelection({
    options,
    minSelect,
    maxSelect,
    defaultValues,
    onConfirm,
  });

  // CLI-2004: the checklist answers by number in the mode, through the SAME reducer every other
  // numbered menu uses — `multi` is what keeps it open after a toggle and makes an empty Enter the
  // commit. A local digit branch would have capped it at nine rows and skipped the shared prompt.
  const numbered = useNumberedSelection({
    enabled: screenReader,
    itemCount: options.length,
    cancellable: true,
    multi: true,
    onSelect: toggleAt,
    onConfirm: confirmIfAllowed,
    onCancel,
  });

  useChecklistArrowKeys({
    active: !screenReader,
    itemCount: options.length,
    setCursor,
    onToggleAtCursor: () => toggleAt(cursor),
    onConfirm: confirmIfAllowed,
    onCancel,
  });

  const canConfirm = selected.size >= minSelect;

  return (
    <ChecklistView
      title={title}
      {...(description !== undefined ? { description } : {})}
      options={options}
      cursor={cursor}
      selected={selected}
      screenReader={screenReader}
      canConfirm={canConfirm}
      minSelect={minSelect}
      numbered={numbered}
    />
  );
}
