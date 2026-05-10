import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import SlashAutocomplete from '../SlashAutocomplete.js';
import type { ICommand } from '@robota-sdk/agent-sdk';

// ink-testing-library fixes stdout.columns = 100
// outer box chrome = 4 (border×2 + paddingX×2)
// → rowWidth = 96 in tests
const TEST_COLUMNS = 100;
const OUTER_CHROME = 4;
const ROW_WIDTH = TEST_COLUMNS - OUTER_CHROME; // 96

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

  it('renders short description unchanged', () => {
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd('help', 'Short description')]}
        selectedIndex={0}
        visible={true}
      />,
    );
    expect(lastFrame()).toContain('Short description');
    expect(lastFrame()).not.toContain('…');
  });

  it('truncates row that exceeds terminal-derived row width', () => {
    // name='cmd'(3) → prefix = indicator(2)+slash(1)+name(3)+sep(2) = 8
    // rowWidth=96, so description > 88 chars triggers truncation
    const name = 'cmd';
    const longDesc = 'A'.repeat(ROW_WIDTH); // 96 chars — definitely overflows with prefix
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd(name, longDesc)]} selectedIndex={0} visible={true} />,
    );
    expect(lastFrame()).toContain('…');
    expect(lastFrame()).not.toContain(longDesc);
  });

  it('does not truncate when total row fits within width', () => {
    const name = 'go';
    // prefix = 2+1+2+2 = 7, keep description short enough
    const shortDesc = 'B'.repeat(10);
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd(name, shortDesc)]} selectedIndex={0} visible={true} />,
    );
    expect(lastFrame()).toContain(shortDesc);
    expect(lastFrame()).not.toContain('…');
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
