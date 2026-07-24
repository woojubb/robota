/**
 * Multi-select checklist (CMD-004): arrow-key navigation, Space toggles, Enter confirms once the
 * selection count is within [minSelect, maxSelect], Esc cancels. Used by PendingActionPrompt for an
 * IActionRequest whose `maxSelect` > 1.
 *
 * Note: unlike ListPicker, this renders all options without a scroll viewport — `IActionRequest`'s
 * optional `maxVisible` hint is not yet honored here (multi-select lists are typically short). Adding a
 * viewport is a follow-up if long multi-select lists appear.
 */

import { Box, Text, useInput } from 'ink';
import React, { useState } from 'react';

import {
  KeyHintFooter,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
  type IKeyHint,
} from './key-hint-footer.js';

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
  const [cursor, setCursor] = useState(0);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set(defaultValues ?? []));

  const toggle = (value: string): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(value)) {
        next.delete(value);
      } else if (next.size < maxSelect) {
        next.add(value);
      }
      return next;
    });
  };

  useInput((input, key) => {
    if (key.upArrow) {
      setCursor((c) => (c <= 0 ? options.length - 1 : c - 1));
    } else if (key.downArrow) {
      setCursor((c) => (c >= options.length - 1 ? 0 : c + 1));
    } else if (input === ' ') {
      const option = options[cursor];
      if (option !== undefined) toggle(option.value);
    } else if (key.return) {
      if (selected.size >= minSelect) onConfirm([...selected]);
    } else if (key.escape) {
      onCancel();
    }
  });

  const canConfirm = selected.size >= minSelect;

  return (
    <Box flexDirection="column" borderStyle="round" borderColor="yellow" paddingX={1}>
      <Text color="yellow" bold>
        {title}
      </Text>
      {description !== undefined && description.length > 0 && <Text dimColor>{description}</Text>}
      {options.map((option, index) => {
        const isCursor = index === cursor;
        const isChecked = selected.has(option.value);
        return (
          <Text key={option.value} color={isCursor ? 'cyan' : undefined}>
            {isCursor ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {isChecked ? '[x] ' : '[ ] '}
            {option.label}
          </Text>
        );
      })}
      <KeyHintFooter hints={getMultiSelectFooterHints({ canConfirm, minSelect })} />
    </Box>
  );
}
