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

function source(): IKeybindingsSource {
  const parsed = parseKeybindingsDocument(
    JSON.stringify({
      version: 1,
      bindings: {
        'chat-input': { submit: 'ctrl+j' },
        'autocomplete-menu': { accept: 'ctrl+j' },
      },
    }),
    '/tmp/keybindings.json',
  );
  if (!parsed.ok) throw new Error(parsed.diagnostic.message);
  return {
    filePath: '/tmp/keybindings.json',
    start: async () => undefined,
    isStarted: () => true,
    ensureFile: async () => '/tmp/keybindings.json',
    getSnapshot: () => parsed.snapshot,
    subscribe: () => () => undefined,
    dispose: () => undefined,
  };
}

describe('InputArea contextual keybindings', () => {
  it('uses the same chord for autocomplete accept and then chat submit without double execution', async () => {
    const onSubmit = vi.fn();
    const commandQueryPort: ITuiCommandQueryPort = {
      getCommands: () => [{ name: 'help', description: 'Show help', source: 'test' }],
      getSubcommands: () => [],
    };
    const { stdin, lastFrame } = render(
      <KeybindingsProvider source={source()}>
        <InputArea onSubmit={onSubmit} isDisabled={false} commandQueryPort={commandQueryPort} />
      </KeybindingsProvider>,
    );
    await tick();
    stdin.write('/he');
    await tick();
    expect(lastFrame()).toContain('/help');
    expect(lastFrame()).toContain('Ctrl+J Submit');

    stdin.write('\r\n');
    await tick();
    expect(onSubmit).not.toHaveBeenCalled();

    stdin.write('\r\n');
    await tick(50);
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(onSubmit).toHaveBeenCalledWith('/help');
  });
});
