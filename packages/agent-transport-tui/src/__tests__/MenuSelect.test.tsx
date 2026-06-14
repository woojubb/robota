import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import MenuSelect from '../MenuSelect.js';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('MenuSelect', () => {
  const items = [
    { label: 'Option A', value: 'a' },
    { label: 'Option B', value: 'b', hint: 'some hint' },
    { label: 'Option C', value: 'c' },
  ];

  it('renders title and all items', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test Menu" items={items} onSelect={() => {}} onBack={() => {}} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Test Menu');
    expect(frame).toContain('Option A');
    expect(frame).toContain('Option B');
    expect(frame).toContain('Option C');
  });

  it('renders hint text when provided', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={items} onSelect={() => {}} onBack={() => {}} />,
    );
    expect(lastFrame()!).toContain('some hint');
  });

  it('highlights first item by default with > prefix', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={items} onSelect={() => {}} onBack={() => {}} />,
    );
    expect(lastFrame()!).toContain('>');
  });

  it('shows loading state', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={[]} onSelect={() => {}} onBack={() => {}} loading />,
    );
    expect(lastFrame()!).toContain('Loading');
  });

  it('shows error state', () => {
    const { lastFrame } = render(
      <MenuSelect title="Test" items={[]} onSelect={() => {}} onBack={() => {}} error="Failed" />,
    );
    expect(lastFrame()!).toContain('Failed');
  });

  it('calls onSelect with value on Enter', () => {
    let selected = '';
    const { stdin } = render(
      <MenuSelect
        title="Test"
        items={items}
        onSelect={(v) => {
          selected = v;
        }}
        onBack={() => {}}
      />,
    );
    stdin.write('\r');
    expect(selected).toBe('a');
  });

  it('calls onBack on Escape', async () => {
    let backed = false;
    const { stdin } = render(
      <MenuSelect
        title="Test"
        items={items}
        onSelect={() => {}}
        onBack={() => {
          backed = true;
        }}
      />,
    );
    stdin.write('\x1B');
    await delay(50);
    expect(backed).toBe(true);
  });

  it('navigates down with arrow key', () => {
    let selected = '';
    const { stdin } = render(
      <MenuSelect
        title="Test"
        items={items}
        onSelect={(v) => {
          selected = v;
        }}
        onBack={() => {}}
      />,
    );
    stdin.write('\x1B[B'); // Down arrow
    stdin.write('\r');
    expect(selected).toBe('b');
  });
});
