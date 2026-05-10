import React from 'react';
import { render } from 'ink-testing-library';
import { describe, it, expect } from 'vitest';
import SlashAutocomplete from '../SlashAutocomplete.js';
import type { ICommand } from '@robota-sdk/agent-sdk';

// MAX_ROW_LENGTH = 72, indicator = 2 chars
// slash mode prefix  = 2 + 1 + name.length + 2
// subcmd mode prefix = 2     + name.length + 2
function allowedLen(name: string, showSlash = true): number {
  const prefixLen = showSlash ? 2 + 1 + name.length + 2 : 2 + name.length + 2;
  return Math.max(10, 72 - prefixLen);
}

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

  it('truncates description that exceeds allowed length for the command name', () => {
    const name = 'cmd';
    const allowed = allowedLen(name);
    const longDesc = 'A'.repeat(allowed + 1);
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd(name, longDesc)]} selectedIndex={0} visible={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain('…');
    expect(frame).not.toContain(longDesc);
    expect(frame).toContain('A'.repeat(allowed));
  });

  it('does not truncate description exactly at the allowed length', () => {
    const name = 'cmd';
    const allowed = allowedLen(name);
    const exactDesc = 'B'.repeat(allowed);
    const { lastFrame } = render(
      <SlashAutocomplete commands={[makeCmd(name, exactDesc)]} selectedIndex={0} visible={true} />,
    );
    const frame = lastFrame()!;
    expect(frame).toContain(exactDesc);
    expect(frame).not.toContain('…');
  });

  it('allocates less description space for longer command names', () => {
    const shortName = 'go';
    const longName = 'session-persistence';
    expect(allowedLen(shortName)).toBeGreaterThan(allowedLen(longName));

    const desc = 'X'.repeat(allowedLen(longName) + 1);

    const { lastFrame: shortFrame } = render(
      <SlashAutocomplete commands={[makeCmd(shortName, desc)]} selectedIndex={0} visible={true} />,
    );
    const { lastFrame: longFrame } = render(
      <SlashAutocomplete commands={[makeCmd(longName, desc)]} selectedIndex={0} visible={true} />,
    );

    // short name has enough room — no truncation
    expect(shortFrame()).not.toContain('…');
    // long name runs out of room — truncated
    expect(longFrame()).toContain('…');
  });

  it('guarantees at least 10 chars of description for extremely long names', () => {
    const veryLongName = 'a'.repeat(70);
    const desc = 'D'.repeat(15);
    const { lastFrame } = render(
      <SlashAutocomplete
        commands={[makeCmd(veryLongName, desc)]}
        selectedIndex={0}
        visible={true}
      />,
    );
    const frame = lastFrame()!;
    // minimum 10 chars shown before truncation point
    expect(frame).toContain('D'.repeat(10));
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

  it('subcommand mode allows 1 extra char compared to slash mode', () => {
    const name = 'cmd';
    expect(allowedLen(name, false)).toBe(allowedLen(name, true) + 1);
  });
});
