import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import ListPicker from '../ListPicker.js';
import {
  formatKeyHints,
  SELECTION_INDICATOR,
  SELECTION_INDICATOR_NONE,
} from '../key-hint-footer.js';

describe('ListPicker', () => {
  it('renders all items with first selected by default', () => {
    const items = ['Alpha', 'Beta', 'Gamma'];
    const { lastFrame } = render(
      <ListPicker
        items={items}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {item}
          </Text>
        )}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('> Alpha');
    expect(frame).toContain('  Beta');
    expect(frame).toContain('  Gamma');
  });

  it('renders empty state when no items', () => {
    const { lastFrame } = render(
      <ListPicker
        items={[]}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {String(item)}
          </Text>
        )}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    // Should render without crashing
    expect(lastFrame()).toBeDefined();
  });

  it('calls onSelect with item on Enter', () => {
    let selected = '';
    const items = ['Alpha', 'Beta'];
    const { stdin } = render(
      <ListPicker
        items={items}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {item}
          </Text>
        )}
        onSelect={(item) => {
          selected = item;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('\r');
    expect(selected).toBe('Alpha');
  });

  it('navigates down with arrow key and selects', () => {
    let selected = '';
    const items = ['Alpha', 'Beta', 'Gamma'];
    const { stdin } = render(
      <ListPicker
        items={items}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {item}
          </Text>
        )}
        onSelect={(item) => {
          selected = item;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('\x1B[B'); // Down arrow
    stdin.write('\r');
    expect(selected).toBe('Beta');
  });

  it('calls onCancel on Escape', async () => {
    const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));
    let cancelled = false;
    const { stdin } = render(
      <ListPicker
        items={['Alpha']}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {item}
          </Text>
        )}
        onSelect={() => {}}
        onCancel={() => {
          cancelled = true;
        }}
      />,
    );
    stdin.write('\x1B');
    await delay(50);
    expect(cancelled).toBe(true);
  });

  it('does not go above first item', () => {
    const items = ['Alpha', 'Beta'];
    const { stdin, lastFrame } = render(
      <ListPicker
        items={items}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {item}
          </Text>
        )}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    stdin.write('\x1B[A'); // Up arrow (already at 0)
    const frame = lastFrame()!;
    expect(frame).toContain('> Alpha');
  });

  it('does not go below last item', () => {
    let selected = '';
    const items = ['Alpha', 'Beta'];
    const { stdin } = render(
      <ListPicker
        items={items}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {item}
          </Text>
        )}
        onSelect={(item) => {
          selected = item;
        }}
        onCancel={() => {}}
      />,
    );
    stdin.write('\x1B[B'); // Down
    stdin.write('\x1B[B'); // Down (should stay at Beta)
    stdin.write('\x1B[B'); // Down (should stay at Beta)
    stdin.write('\r');
    expect(selected).toBe('Beta');
  });

  // SCREEN-005: default footer renders through the key-hint SSOT grammar.
  it('renders the default footer in the shared key-hint grammar', () => {
    const { lastFrame } = render(
      <ListPicker
        items={['Alpha']}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? SELECTION_INDICATOR : SELECTION_INDICATOR_NONE}
            {item}
          </Text>
        )}
        onSelect={() => {}}
        onCancel={() => {}}
      />,
    );
    expect(lastFrame()!).toContain(
      formatKeyHints([
        { keys: '↑↓', label: 'Navigate' },
        { keys: 'Enter', label: 'Select' },
        { keys: 'Esc', label: 'Cancel' },
      ]),
    );
  });
});
