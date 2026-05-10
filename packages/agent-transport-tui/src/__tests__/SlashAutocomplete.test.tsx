import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import SlashAutocomplete from '../SlashAutocomplete.js';
import type { ICommand } from '@robota-sdk/agent-sdk';

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

  it('truncates description longer than 60 characters with ellipsis', () => {
    const longDesc = 'A'.repeat(61);
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd('cmd', longDesc)]} selectedIndex={0} visible={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('…');
    expect(frame).not.toContain(longDesc);
    expect(frame).toContain('A'.repeat(60));
  });

  it('does not truncate description exactly 60 characters', () => {
    const exactDesc = 'B'.repeat(60);
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd('cmd', exactDesc)]} selectedIndex={0} visible={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain(exactDesc);
    expect(frame).not.toContain('…');
  });

  it('handles undefined description gracefully', () => {
    const cmd = { name: 'cmd' } as ICommand;
    const { lastFrame } = render(
      <SlashAutocomplete commands={[cmd]} selectedIndex={0} visible={true} />,
    );
    expect(lastFrame()).not.toThrow;
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
