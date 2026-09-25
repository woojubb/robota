import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import InputArea from '../InputArea.js';
import { KeybindingsProvider } from '../keybindings/keybindings-context.js';
import { parseKeybindingsDocument } from '../keybindings/keybinding-registry.js';

import type { IKeybindingsSource } from '../keybindings/node-keybindings-source.js';
import type { ITuiCommandQueryPort } from '../tui-app-channel-port.js';

async function tick(ms = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

const commandQueryPort: ITuiCommandQueryPort = {
  getCommands: (filter) =>
    [
      { name: 'help', description: 'Show help', source: 'test' },
      { name: 'permissions', description: 'Permissions', source: 'test' },
    ].filter((command) => command.name.startsWith(filter ?? '')),
  getSubcommands: (parent) =>
    parent === 'permissions'
      ? [{ name: 'retry', description: 'Retry a denial', source: 'test' }]
      : [],
};

describe('InputArea editing keys while the slash autocomplete is open', () => {
  it('deletes with backspace', async () => {
    const { stdin, lastFrame } = render(
      <InputArea onSubmit={vi.fn()} isDisabled={false} commandQueryPort={commandQueryPort} />,
    );
    await tick();
    stdin.write('/per');
    await tick();
    expect(lastFrame()).toContain('permissions');

    stdin.write('\x7f');
    await tick();
    expect(lastFrame()).toMatch(/> \/pe$/m);

    stdin.write('\x7f\x7f\x7f');
    await tick();
    expect(lastFrame()).toContain('Type a message or /help');
  });

  it('deletes back out of a tab-completed command whose subcommands stay listed', async () => {
    const { stdin, lastFrame } = render(
      <InputArea onSubmit={vi.fn()} isDisabled={false} commandQueryPort={commandQueryPort} />,
    );
    await tick();
    stdin.write('/per');
    await tick();
    stdin.write('\t');
    await tick();
    expect(lastFrame()).toContain('> /permissions');
    expect(lastFrame()).toContain('retry');

    stdin.write('\x7f\x7f');
    await tick();
    expect(lastFrame()).toMatch(/> \/permission$/m);
    expect(lastFrame()).not.toContain('retry');
  });

  it('clears the line with ctrl+u', async () => {
    const { stdin, lastFrame } = render(
      <InputArea onSubmit={vi.fn()} isDisabled={false} commandQueryPort={commandQueryPort} />,
    );
    await tick();
    stdin.write('/he');
    await tick();
    expect(lastFrame()).toContain('help');

    stdin.write('\x15');
    await tick();
    expect(lastFrame()).toContain('Type a message or /help');
  });

  it('moves the cursor with the arrow keys so an insertion lands mid-word', async () => {
    const { stdin, lastFrame } = render(
      <InputArea onSubmit={vi.fn()} isDisabled={false} commandQueryPort={commandQueryPort} />,
    );
    await tick();
    stdin.write('/pe');
    await tick();
    expect(lastFrame()).toContain('permissions');
    stdin.write('\x1b[D');
    await tick();
    stdin.write('r');
    await tick();
    expect(lastFrame()).toMatch(/> \/pre$/m);
  });

  it("follows the user's chat-input bindings, not the defaults", async () => {
    const parsed = parseKeybindingsDocument(
      JSON.stringify({ version: 1, bindings: { 'chat-input': { 'delete-line': 'ctrl+k' } } }),
      '/tmp/keybindings.json',
    );
    if (!parsed.ok) throw new Error(parsed.diagnostic.message);
    const source: IKeybindingsSource = {
      filePath: '/tmp/keybindings.json',
      start: async () => undefined,
      isStarted: () => true,
      ensureFile: async () => '/tmp/keybindings.json',
      getSnapshot: () => parsed.snapshot,
      subscribe: () => () => undefined,
      dispose: () => undefined,
    };
    const { stdin, lastFrame } = render(
      <KeybindingsProvider source={source}>
        <InputArea onSubmit={vi.fn()} isDisabled={false} commandQueryPort={commandQueryPort} />
      </KeybindingsProvider>,
    );
    await tick();
    stdin.write('/he');
    await tick();
    expect(lastFrame()).toContain('help');

    stdin.write('\x15'); // ctrl+u is no longer bound
    await tick();
    expect(lastFrame()).toMatch(/> \/he$/m);

    stdin.write('\x0b'); // ctrl+k
    await tick();
    expect(lastFrame()).toContain('Type a message or /help');
  });
});
