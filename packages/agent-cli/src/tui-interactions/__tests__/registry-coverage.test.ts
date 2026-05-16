import { describe, it, expect } from 'vitest';
import type { TAnyTuiCommandInteraction } from '@robota-sdk/agent-transport-tui';
import { TUI_COMMAND_INTERACTIONS } from '../registry.js';

const EXPECTED_SYSTEM_COMMANDS = [
  'agent',
  'background',
  'clear',
  'compact',
  'context',
  'cost',
  'exit',
  'help',
  'language',
  'memory',
  'mode',
  'model',
  'permissions',
  'plugin',
  'provider',
  'rename',
  'reset',
  'resume',
  'rewind',
  'settings',
  'skills',
  'statusline',
  'user-local',
  'validate-session',
] as const;

describe('TUI_COMMAND_INTERACTIONS registry', () => {
  it('declares all expected system command names', () => {
    const actualNames = Object.keys(TUI_COMMAND_INTERACTIONS).sort();
    expect(actualNames).toEqual([...EXPECTED_SYSTEM_COMMANDS].sort());
  });

  it('each interaction entry with onMissingArgs picker has getItems function', () => {
    for (const [name, rawEntry] of Object.entries(TUI_COMMAND_INTERACTIONS)) {
      const entry = rawEntry as TAnyTuiCommandInteraction | undefined;
      if (entry?.onMissingArgs === 'picker') {
        expect(typeof entry.getItems, `${name}.getItems`).toBe('function');
        const items = entry.getItems();
        expect(Array.isArray(items), `${name}.getItems() returns array`).toBe(true);
        expect(items.length, `${name} picker has at least one item`).toBeGreaterThan(0);
      }
    }
  });

  it('each interaction entry with onMissingArgs confirm has message string', () => {
    for (const [name, rawEntry] of Object.entries(TUI_COMMAND_INTERACTIONS)) {
      const entry = rawEntry as TAnyTuiCommandInteraction | undefined;
      if (entry?.onMissingArgs === 'confirm') {
        expect(typeof entry.message, `${name}.message`).toBe('string');
        expect(entry.message.length, `${name}.message is non-empty`).toBeGreaterThan(0);
      }
    }
  });
});
