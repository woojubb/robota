import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import SlashAutocomplete from '../SlashAutocomplete.js';
import type { ICommand } from '@robota-sdk/agent-sdk';

const ROW_WIDTH = 72;

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

  it('truncates long row to ROW_WIDTH with ellipsis via Ink wrap', () => {
    // indicator(2) + slash(1) + name(3) + sep(2) = 8 chars prefix → 64 chars for description
    const name = 'cmd';
    const longDesc = 'A'.repeat(ROW_WIDTH); // guaranteed to overflow
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd(name, longDesc)]} selectedIndex={0} visible={true} />,
    );
    const frame = lastFrame()!;
    // Ink renders truncation with ellipsis when Box width is exceeded
    expect(frame).toContain('…');
    expect(frame).not.toContain(longDesc);
  });

  it('does not truncate description that fits within row width', () => {
    // short name + short description — total well under ROW_WIDTH
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd('go', 'Run')]} selectedIndex={0} visible={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('Run');
    expect(frame).not.toContain('…');
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
