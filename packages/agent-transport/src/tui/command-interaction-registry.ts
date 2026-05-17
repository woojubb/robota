import type { ITuiPickerItem, TAnyTuiCommandInteraction } from './command-interaction.js';

function getModeItems(): ITuiPickerItem[] {
  return [
    { label: 'plan', value: 'plan', description: 'Plan only, no execution' },
    { label: 'default', value: 'default', description: 'Ask before risky actions' },
    { label: 'acceptEdits', value: 'acceptEdits', description: 'Auto-approve file edits' },
    {
      label: 'bypassPermissions',
      value: 'bypassPermissions',
      description: 'Skip all permission checks',
    },
  ];
}

function getLanguageItems(): ITuiPickerItem[] {
  return [
    { label: 'ko  Korean', value: 'ko', description: '한국어' },
    { label: 'en  English', value: 'en', description: 'English' },
    { label: 'ja  Japanese', value: 'ja', description: '日本語' },
    { label: 'zh  Chinese', value: 'zh', description: '中文' },
  ];
}

function getProviderSubcommandItems(): ITuiPickerItem[] {
  return [
    { label: 'current', value: 'current', description: 'Show current provider' },
    { label: 'list', value: 'list', description: 'List available providers' },
    { label: 'use', value: 'use', description: 'Switch to a provider' },
    { label: 'add', value: 'add', description: 'Add a new provider' },
    { label: 'test', value: 'test', description: 'Test provider connection' },
  ];
}

const BUILT_IN_INTERACTIONS: Record<string, TAnyTuiCommandInteraction | undefined> = {
  agent: undefined,
  background: undefined,
  clear: { onMissingArgs: 'confirm', message: 'Clear conversation history?' },
  compact: undefined,
  context: undefined,
  cost: undefined,
  exit: { onMissingArgs: 'confirm', message: 'Exit the session?' },
  help: undefined,
  language: { onMissingArgs: 'picker', getItems: getLanguageItems },
  memory: undefined,
  mode: { onMissingArgs: 'picker', getItems: getModeItems },
  model: undefined,
  permissions: undefined,
  plugin: undefined,
  provider: { onMissingArgs: 'picker', getItems: getProviderSubcommandItems },
  rename: undefined,
  reset: undefined,
  resume: undefined,
  rewind: undefined,
  settings: undefined,
  skills: undefined,
  statusline: undefined,
  'user-local': undefined,
  'validate-session': undefined,
};

export function resolveCommandInteraction(
  commandName: string,
): TAnyTuiCommandInteraction | undefined {
  return BUILT_IN_INTERACTIONS[commandName];
}
