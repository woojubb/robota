import React from 'react';
import { render } from 'ink-testing-library';
import { Text } from 'ink';
import { describe, it, expect } from 'vitest';
import ListPicker from '../ListPicker.js';

describe('ListPicker', () => {
  it('renders all items with first selected by default', () => {
    const items = ['Alpha', 'Beta', 'Gamma'];
    const { lastFrame } = render(
      <ListPicker
        items={items}
        renderItem={(item, isSelected) => (
          <Text>
            {isSelected ? '> ' : '  '}
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
            {isSelected ? '> ' : '  '}
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
            {isSelected ? '> ' : '  '}
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
            {isSelected ? '> ' : '  '}
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
            {isSelected ? '> ' : '  '}
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
            {isSelected ? '> ' : '  '}
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
            {isSelected ? '> ' : '  '}
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
});
