/**
 * SCREEN-005 anti-drift consistency guard — the mechanical floor for the key-hint SSOT.
 *
 * Covers the FULL footer inventory: every component's declared hint set must (a) render exactly as
 * `formatKeyHints(<declared hints>)` (round-trip through the SSOT — a fourth footer dialect cannot
 * re-appear silently), and (b) obey the navigate → modify → primary → dismiss ordering. Also pins
 * the Esc-suppression contract: the explicit-resolve prompts (Confirm/Permission) omit Esc from
 * their footers because their flows suppress it.
 */
import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it } from 'vitest';
import { Text } from 'ink';

import ConfirmPrompt, { CONFIRM_PROMPT_FOOTER_HINTS } from '../ConfirmPrompt.js';
import ExecutionWorkspaceSwitcher, {
  EXECUTION_WORKSPACE_SWITCHER_FOOTER_HINTS,
} from '../ExecutionWorkspaceSwitcher.js';
import ListPicker, { LIST_PICKER_DEFAULT_FOOTER_HINTS } from '../ListPicker.js';
import MenuSelect, {
  MENU_SELECT_ERROR_FOOTER_HINTS,
  MENU_SELECT_FOOTER_HINTS,
} from '../MenuSelect.js';
import MultiSelectList, { getMultiSelectFooterHints } from '../MultiSelectList.js';
import PermissionPrompt, { PERMISSION_PROMPT_FOOTER_HINTS } from '../PermissionPrompt.js';
import SlashAutocomplete, { SLASH_AUTOCOMPLETE_FOOTER_HINTS } from '../SlashAutocomplete.js';
import TextPrompt, { TEXT_PROMPT_FOOTER_HINTS } from '../TextPrompt.js';
import { formatKeyHints, type IKeyHint } from '../key-hint-footer.js';

import type { ICommand } from '@robota-sdk/agent-interface-transport';
import type { IExecutionWorkspaceSnapshot } from '@robota-sdk/agent-interface-transport';

/**
 * Footer ordering contract: navigate → modify → primary → dismiss (docs/SPEC.md "Interaction
 * affordance contract"). The rank vocabulary lives here in the test — the SSOT module stays
 * mechanics-only.
 */
const KEY_RANK: Record<string, number> = {
  '↑↓': 0, // navigate
  '←→': 0, // navigate
  Space: 1, // modify
  Tab: 1, // modify
  Enter: 2, // primary
  Esc: 3, // dismiss
  'Ctrl+B/Esc': 3, // dismiss
};

interface IFooterInventoryEntry {
  name: string;
  hints: readonly IKeyHint[];
  renderFrame: () => string;
}

function makeSnapshot(): IExecutionWorkspaceSnapshot {
  return {
    sessionId: 's1',
    selectedEntryId: 'main:s1',
    updatedAt: '2026-07-24T00:00:00.000Z',
    entries: [
      {
        id: 'main:s1',
        sourceId: 's1',
        kind: 'main_thread',
        origin: { kind: 'user_prompt', sessionId: 's1' },
        status: 'idle',
        title: 'Main thread',
        unread: false,
        attention: 'none',
        visibility: 'default',
        updatedAt: '2026-07-24T00:00:00.000Z',
        controls: ['select'],
      },
    ],
  };
}

const noop = (): void => {};

/** The FULL footer inventory — every footer call site in the package. */
const FOOTER_INVENTORY: readonly IFooterInventoryEntry[] = [
  {
    name: 'ListPicker (default footer)',
    hints: LIST_PICKER_DEFAULT_FOOTER_HINTS,
    renderFrame: () =>
      render(
        <ListPicker
          items={['a']}
          renderItem={(item) => <Text>{item}</Text>}
          onSelect={noop}
          onCancel={noop}
        />,
      ).lastFrame()!,
  },
  {
    name: 'SlashAutocomplete',
    hints: SLASH_AUTOCOMPLETE_FOOTER_HINTS,
    renderFrame: () =>
      render(
        <SlashAutocomplete
          commands={[{ name: 'help', description: 'Show help' } as ICommand]}
          selectedIndex={0}
          visible={true}
        />,
      ).lastFrame()!,
  },
  {
    name: 'TextPrompt',
    hints: TEXT_PROMPT_FOOTER_HINTS,
    renderFrame: () =>
      render(<TextPrompt title="t" onSubmit={noop} onCancel={noop} />).lastFrame()!,
  },
  {
    name: 'MenuSelect (normal)',
    hints: MENU_SELECT_FOOTER_HINTS,
    renderFrame: () =>
      render(
        <MenuSelect title="t" items={[{ label: 'A', value: 'a' }]} onSelect={noop} onBack={noop} />,
      ).lastFrame()!,
  },
  {
    name: 'MenuSelect (error-state hint)',
    hints: MENU_SELECT_ERROR_FOOTER_HINTS,
    renderFrame: () =>
      render(
        <MenuSelect title="t" items={[]} onSelect={noop} onBack={noop} error="Failed" />,
      ).lastFrame()!,
  },
  {
    name: 'MultiSelectList (min not yet satisfied)',
    hints: getMultiSelectFooterHints({ canConfirm: false, minSelect: 2 }),
    renderFrame: () =>
      render(
        <MultiSelectList
          title="t"
          options={[
            { value: 'a', label: 'A' },
            { value: 'b', label: 'B' },
          ]}
          minSelect={2}
          maxSelect={2}
          onConfirm={noop}
          onCancel={noop}
        />,
      ).lastFrame()!,
  },
  {
    name: 'MultiSelectList (confirmable)',
    hints: getMultiSelectFooterHints({ canConfirm: true, minSelect: 0 }),
    renderFrame: () =>
      render(
        <MultiSelectList
          title="t"
          options={[{ value: 'a', label: 'A' }]}
          minSelect={0}
          maxSelect={1}
          onConfirm={noop}
          onCancel={noop}
        />,
      ).lastFrame()!,
  },
  {
    name: 'ConfirmPrompt',
    hints: CONFIRM_PROMPT_FOOTER_HINTS,
    renderFrame: () => render(<ConfirmPrompt message="m" onSelect={noop} />).lastFrame()!,
  },
  {
    name: 'PermissionPrompt',
    hints: PERMISSION_PROMPT_FOOTER_HINTS,
    renderFrame: () =>
      render(
        <PermissionPrompt request={{ toolName: 'tool', toolArgs: {}, resolve: noop }} />,
      ).lastFrame()!,
  },
  {
    name: 'ExecutionWorkspaceSwitcher',
    hints: EXECUTION_WORKSPACE_SWITCHER_FOOTER_HINTS,
    renderFrame: () =>
      render(
        <ExecutionWorkspaceSwitcher
          snapshot={makeSnapshot()}
          selectedEntryId="main:s1"
          onSelect={noop}
          onClose={noop}
        />,
      ).lastFrame()!,
  },
];

describe('key-hint consistency (SCREEN-005 anti-drift guard)', () => {
  it.each(FOOTER_INVENTORY.map((entry) => [entry.name, entry] as const))(
    '%s: rendered footer round-trips through formatKeyHints',
    (_name, entry) => {
      expect(entry.renderFrame()).toContain(formatKeyHints(entry.hints));
    },
  );

  it.each(FOOTER_INVENTORY.map((entry) => [entry.name, entry] as const))(
    '%s: hint order is navigate → modify → primary → dismiss',
    (_name, entry) => {
      const ranks = entry.hints.map((hint) => {
        const rank = KEY_RANK[hint.keys];
        if (rank === undefined) {
          throw new Error(
            `Unknown key '${hint.keys}' — add it to KEY_RANK with its ordering category`,
          );
        }
        return rank;
      });
      const sorted = [...ranks].sort((a, b) => a - b);
      expect(ranks).toEqual(sorted);
    },
  );

  it('explicit-resolve prompts (Confirm/Permission) omit Esc from their footers', () => {
    for (const hints of [CONFIRM_PROMPT_FOOTER_HINTS, PERMISSION_PROMPT_FOOTER_HINTS]) {
      expect(hints.some((hint) => hint.keys.includes('Esc'))).toBe(false);
    }
  });

  it('Confirm and Permission prompt footers are identical (same row, same reducer)', () => {
    expect(formatKeyHints(CONFIRM_PROMPT_FOOTER_HINTS)).toBe(
      formatKeyHints(PERMISSION_PROMPT_FOOTER_HINTS),
    );
  });
});
