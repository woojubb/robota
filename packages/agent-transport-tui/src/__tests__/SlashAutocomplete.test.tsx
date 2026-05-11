import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import SlashAutocomplete from '../SlashAutocomplete.js';
import type { ICommand } from '@robota-sdk/agent-sdk';

// ink-testing-library fixes stdout.columns = 100
// outer box chrome = 4 → rowWidth = 96 in tests
const NAME_COL_MAX = 20;

function makeCmd(name: string, description: string): ICommand {
  return { name, description } as ICommand;
}

describe('SlashAutocomplete', () => {
  it('renders nothing when not visible', () => {
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd('help', 'Show help')]}
        selectedIndex={0}
        visible={false}
      />,
    );
    expect(lastFrame()).toBe('');
  });

  it('renders nothing when command list is empty', () => {
    const { lastFrame } = render(
      <SlashAutocomplete commands={[]} selectedIndex={0} visible={true} />,
    );
    expect(lastFrame()).toBe('');
  });

  it('aligns descriptions to the same column across all rows', () => {
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[
          makeCmd('go', 'Short'),
          makeCmd('session-persistence', 'Manage sessions'),
          makeCmd('help', 'Show help'),
        ]}
        selectedIndex={0}
        visible={true}
      />,
    );
    const frame = lastFrame()!;
    const lines = frame
      .split('\n')
      .filter((l) => l.includes('Short') || l.includes('Manage') || l.includes('Show help'));
    // All description texts should start at the same column index
    const descPositions = lines.map((l) => {
      // find position after the two-space separator following the name
      const match = /  \S/.exec(l.slice(l.indexOf('/') + 1));
      return match ? l.indexOf('/') + 1 + match.index + 2 : -1;
    });
    expect(new Set(descPositions).size).toBe(1);
  });

  it('pads short names to match the longest name in visible set', () => {
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd('go', 'Run'), makeCmd('help', 'Show help')]}
        selectedIndex={0}
        visible={true}
      />,
    );
    const frame = lastFrame()!;
    // 'go' should be padded to 4 chars (length of 'help')
    expect(frame).toContain('/go  ');
  });

  it('caps name column at NAME_COL_MAX and truncates with ellipsis', () => {
    const longName = 'a'.repeat(NAME_COL_MAX + 5);
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd(longName, 'Description'), makeCmd('go', 'Short')]}
        selectedIndex={0}
        visible={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('…');
    expect(frame).not.toContain(longName);
  });

  it('does not truncate name exactly at NAME_COL_MAX', () => {
    const exactName = 'b'.repeat(NAME_COL_MAX);
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd(exactName, 'Desc'), makeCmd('go', 'Short')]}
        selectedIndex={0}
        visible={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain(exactName);
  });

  it('truncates long row text with ellipsis via Ink wrap', () => {
    const longDesc = 'X'.repeat(100);
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd('cmd', longDesc)]} selectedIndex={0} visible={true} />,
    );
    expect(lastFrame()).toContain('…');
    expect(lastFrame()).not.toContain(longDesc);
  });

  it('handles undefined description gracefully', () => {
    const cmd = { name: 'cmd' } as ICommand;
    const { lastFrame } = render(
      <SlashAutocomplete commands={[cmd]} selectedIndex={0} visible={true} />,
    );
    expect(lastFrame()).toContain('cmd');
  });

  it('shows slash prefix in normal mode', () => {
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd('help', 'Show help')]}
        selectedIndex={0}
        visible={true}
      />,
    );
    expect(lastFrame()).toContain('/help');
  });

  it('omits slash prefix in subcommand mode', () => {
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd('run', 'Run task')]}
        selectedIndex={0}
        visible={true}
        isSubcommandMode={true}
      />,
    );
    const frame = lastFrame()!;
    expect(frame).not.toContain('/run');
    expect(frame).toContain('Run task');
  });
});
