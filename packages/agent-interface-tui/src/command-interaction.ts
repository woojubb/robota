export type TOnMissingArgsAction = 'picker' | 'wizard' | 'confirm';

export interface ITuiPickerItem {
  label: string;
  value: string;
  description?: string;
}

export interface ITuiCommandInteraction {
  onMissingArgs?: TOnMissingArgsAction;
}

export interface ITuiPickerInteraction extends ITuiCommandInteraction {
  onMissingArgs: 'picker';
  getItems(): ITuiPickerItem[];
}

export interface ITuiConfirmInteraction extends ITuiCommandInteraction {
  onMissingArgs: 'confirm';
  message: string;
}

export type TAnyTuiCommandInteraction = ITuiPickerInteraction | ITuiConfirmInteraction;

// Runtime type-guards for these interfaces live in the consuming runtime package
// (`@robota-sdk/agent-transport`) — this interface package contains type contracts only.
