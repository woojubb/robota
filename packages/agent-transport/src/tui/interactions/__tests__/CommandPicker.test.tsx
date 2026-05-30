import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect, vi } from 'vitest';

import CommandPicker from '../CommandPicker.js';

import type { ITuiPickerInteraction, ITuiPickerItem } from '../../command-interaction.js';

const delay = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

function makeInteraction(items: ITuiPickerItem[]): ITuiPickerInteraction {
  return {
    onMissingArgs: 'picker',
    getItems: () => items,
  };
}

const ITEMS: ITuiPickerItem[] = [
  { label: 'plan', value: 'plan', description: 'Plan mode' },
  { label: 'default', value: 'default', description: 'Default mode' },
  { label: 'auto', value: 'auto' },
];

describe('CommandPicker', () => {
  it('renders all item labels', () => {
    const { lastFrame } = render(
      <CommandPicker
        commandName="mode"
        interaction={makeInteraction(ITEMS)}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('plan');
    expect(frame).toContain('default');
    expect(frame).toContain('auto');
  });

  it('highlights first item by default', () => {
    const { lastFrame } = render(
      <CommandPicker
        commandName="mode"
        interaction={makeInteraction(ITEMS)}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('▸ plan');
  });

  it('calls onSelect with first item on Enter', () => {
    const onSelect = vi.fn();
    const { stdin } = render(
      <CommandPicker
        commandName="mode"
        interaction={makeInteraction(ITEMS)}
        onSelect={onSelect}
        onCancel={() => {}}
      />,
    );
    stdin.write('\r');
    expect(onSelect).toHaveBeenCalledWith(ITEMS[0]);
  });

  it('moves highlight down on arrow-down then selects on Enter', async () => {
    let selected: ITuiPickerItem | undefined;
    const { stdin } = render(
      <CommandPicker
        commandName="mode"
        interaction={makeInteraction(ITEMS)}
        onSelect={(item) => {
          selected = item;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('\x1B[B'); // ↓
    await delay(50);
    stdin.write('\r');
    expect(selected).toEqual(ITEMS[1]);
  });

  it('calls onCancel on Escape', async () => {
    let cancelled = false;
    const { stdin } = render(
      <CommandPicker
        commandName="mode"
        interaction={makeInteraction(ITEMS)}
        onSelect={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write('\x1b');
    await delay(50);
    expect(cancelled).toBe(true);
  });

  it('calls onCancel on q', () => {
    const onCancel = vi.fn();
    const { stdin } = render(
      <CommandPicker
        commandName="mode"
        interaction={makeInteraction(ITEMS)}
        onSelect={() => {}}
        onCancel={onCancel}
      />,
    );
    stdin.write('q');
    expect(onCancel).toHaveBeenCalled();
  });

  it('wraps highlight from last to first on arrow-down at bottom', async () => {
    let selected: ITuiPickerItem | undefined;
    const { stdin } = render(
      <CommandPicker
        commandName="mode"
        interaction={makeInteraction(ITEMS)}
        onSelect={(item) => {
          selected = item;
        }}
        onCancel={() => {}}
      />,
    );
    // Navigate to last item (index 2)
    stdin.write('\x1B[B'); // ↓ to index 1
    await delay(50);
    stdin.write('\x1B[B'); // ↓ to index 2
    await delay(50);
    stdin.write('\x1B[B'); // ↓ wraps to index 0
    await delay(50);
    stdin.write('\r');
    expect(selected).toEqual(ITEMS[0]);
  });
});
