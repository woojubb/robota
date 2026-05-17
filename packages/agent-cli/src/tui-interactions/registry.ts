import type {
  ITuiCommandInteraction,
  ITuiPickerItem,
  TAnyTuiCommandInteraction,
} from '@robota-sdk/agent-transport/tui';

type TSystemCommandName =
  | 'agent'
  | 'background'
  | 'clear'
  | 'compact'
  | 'context'
  | 'cost'
  | 'exit'
  | 'help'
  | 'language'
  | 'memory'
  | 'mode'
  | 'model'
  | 'permissions'
  | 'plugin'
  | 'provider'
  | 'rename'
  | 'reset'
  | 'resume'
  | 'rewind'
  | 'settings'
  | 'skills'
  | 'statusline'
  | 'user-local'
  | 'validate-session';

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

export const TUI_COMMAND_INTERACTIONS: Record<
  TSystemCommandName,
  TAnyTuiCommandInteraction | undefined
> = {
  agent: undefined, // natural language args — free input
  background: undefined, // has subcommands — insert
  clear: { onMissingArgs: 'confirm', message: 'Clear conversation history?' },
  compact: undefined, // optional args — runs immediately
  context: undefined, // has subcommands — insert
  cost: undefined, // no args needed — runs immediately
  exit: { onMissingArgs: 'confirm', message: 'Exit the session?' },
  help: undefined, // no args needed — runs immediately
  language: { onMissingArgs: 'picker', getItems: getLanguageItems },
  memory: undefined, // has subcommands — insert
  mode: { onMissingArgs: 'picker', getItems: getModeItems },
  model: undefined, // runtime model list — handled via subcommand insert for now
  permissions: undefined, // has subcommands — insert
  plugin: undefined, // has subcommands — insert
  provider: { onMissingArgs: 'picker', getItems: getProviderSubcommandItems },
  rename: undefined, // needs text input — free input
  reset: undefined, // wizard — deferred
  resume: undefined, // picker requires session store — deferred
  rewind: undefined, // optional args — runs immediately
  settings: undefined, // has subcommands — insert
  skills: undefined, // free input
  statusline: undefined, // has subcommands — insert
  'user-local': undefined, // has subcommands — insert
  'validate-session': undefined, // no args needed — runs immediately
};

export function resolveInteraction(commandName: string): TAnyTuiCommandInteraction | undefined {
  return TUI_COMMAND_INTERACTIONS[commandName as TSystemCommandName];
}
