import React from 'react';
import { render } from 'ink-testing-library';
import { describe, expect, it, vi } from 'vitest';

import InputArea from '../InputArea.js';
import { KeybindingsProvider } from '../keybindings/keybindings-context.js';
import { parseKeybindingsDocument } from '../keybindings/keybinding-registry.js';

import type { IInputAreaHistorySearch } from '../hooks/useInputAreaHistorySearch.js';
import type { IKeybindingsSource } from '../keybindings/node-keybindings-source.js';
import type { ITuiCommandQueryPort } from '../tui-app-channel-port.js';

async function tick(ms = 25): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function source(
  bindings: Record<string, Record<string, string>> = {
    'chat-input': { submit: 'ctrl+j' },
    'autocomplete-menu': { accept: 'ctrl+j' },
  },
): IKeybindingsSource {
  const parsed = parseKeybindingsDocument(
    JSON.stringify({ version: 1, bindings }),
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

  // SCREEN-1993 TC-05: the open key and every overlay action are rebindable through the document,
  // and the footer lists the live keys rather than the defaults.
  it('rebinds the history-search open key and its actions through the document', async () => {
    const onSubmit = vi.fn();
    const historySearch: IInputAreaHistorySearch = {
      source: {
        async *read() {
          yield {
            entries: [
              { at: '', sessionId: 'x', project: '/x', text: 'rotate the staging secrets' },
            ],
            skippedLines: 0,
          };
        },
      },
      sessionId: 's1',
      project: '/p',
    };
    const { stdin, lastFrame } = render(
      <KeybindingsProvider
        source={source({
          'chat-input': { 'history-search': 'ctrl+o' },
          'history-search': { execute: 'ctrl+x', cancel: 'ctrl+g' },
        })}
      >
        <InputArea onSubmit={onSubmit} isDisabled={false} historySearch={historySearch} />
      </KeybindingsProvider>,
    );
    await tick();
    stdin.write('\x12'); // the default ctrl+r no longer opens it
    await tick();
    expect(lastFrame()).not.toContain('(reverse-i-search)');
    stdin.write('\x0f'); // ctrl+o
    await tick();
    expect(lastFrame()).toContain('(reverse-i-search)');
    expect(lastFrame()).toContain('Ctrl+X Run');
    expect(lastFrame()).toContain('Ctrl+G Close');
    stdin.write('\x18'); // ctrl+x
    await tick();
    expect(onSubmit).toHaveBeenCalledWith('rotate the staging secrets');
  });
});
