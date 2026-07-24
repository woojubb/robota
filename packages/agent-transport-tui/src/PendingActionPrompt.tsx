/**
 * PendingActionPrompt (CMD-004) — the TUI renderer for the unified `IActionRequest`. It derives the
 * presentation from the request's fields (not a kind switch):
 * - no options                → free-text (TextPrompt, honoring `masked`/`placeholder`/`allowEmpty`)
 * - options, `maxSelect` > 1   → multi-select checklist (MultiSelectList)
 * - options, `maxSelect` <= 1  → single-select list (ListPicker); with `allowFreeText`, a synthetic
 *                                "Type a custom answer…" entry switches to a text field
 *
 * It always resolves the caller's `onAnswer` with a `TActionResponse` (answer or cancelled).
 */

import { Box, Text } from 'ink';
import React, { useState } from 'react';

import { SELECTION_INDICATOR, SELECTION_INDICATOR_NONE } from './key-hint-footer.js';
import ListPicker from './ListPicker.js';
import MultiSelectList from './MultiSelectList.js';
import TextPrompt from './TextPrompt.js';

import type { IActionOption, IActionRequest, TActionResponse } from '@robota-sdk/agent-core';

interface IPendingActionPromptProps {
  request: IActionRequest;
  onAnswer: (response: TActionResponse) => void;
}

/**
 * Synthetic "type a custom answer" entry for a single-select with free text. Routed by object identity
 * (reference equality), not by a magic value — so it can never collide with a real option's `value`.
 */
const FREE_TEXT_OPTION: IActionOption = { value: '', label: 'Type a custom answer…' };

export default function PendingActionPrompt({
  request,
  onAnswer,
}: IPendingActionPromptProps): React.ReactElement {
  const [freeTextMode, setFreeTextMode] = useState(false);

  const options = request.options ?? [];
  const hasOptions = options.length > 0;
  const maxSelect = request.maxSelect ?? 1;
  const cancel = (): void => onAnswer({ type: 'cancelled' });

  // Pure free-text (no options) — or the user chose "type a custom answer" on a single-select.
  if (!hasOptions || freeTextMode) {
    return (
      <TextPrompt
        key={`text:${request.id}`}
        title={request.title}
        description={request.description}
        placeholder={request.placeholder}
        allowEmpty={request.allowEmpty}
        masked={request.masked}
        onSubmit={(value) => onAnswer({ type: 'answer', values: [], text: value })}
        onCancel={freeTextMode ? () => setFreeTextMode(false) : cancel}
      />
    );
  }

  // Multi-select.
  if (maxSelect > 1) {
    return (
      <MultiSelectList
        title={request.title}
        description={request.description}
        options={options}
        minSelect={request.minSelect ?? 1}
        maxSelect={maxSelect}
        defaultValues={request.default?.values}
        onConfirm={(values) => onAnswer({ type: 'answer', values })}
        onCancel={cancel}
      />
    );
  }

  // Single-select, optionally with a "type your own" entry (routed by identity, see FREE_TEXT_OPTION).
  const pickerItems: IActionOption[] = request.allowFreeText
    ? [...options, FREE_TEXT_OPTION]
    : [...options];

  return (
    <Box flexDirection="column">
      <Text bold>{request.title}</Text>
      {request.description !== undefined && request.description.length > 0 && (
        <Text dimColor>{request.description}</Text>
      )}
      <ListPicker<IActionOption>
        items={pickerItems}
        maxVisible={request.maxVisible}
        renderItem={(option, isSelected) => (
          <Text color={isSelected ? 'cyan' : undefined}>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {option.label}
          </Text>
        )}
        onSelect={(option) => {
          if (option === FREE_TEXT_OPTION) {
            setFreeTextMode(true);
          } else {
            onAnswer({ type: 'answer', values: [option.value] });
          }
        }}
        onCancel={cancel}
      />
    </Box>
  );
}
