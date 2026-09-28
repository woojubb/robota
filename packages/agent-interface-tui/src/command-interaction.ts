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

// This interface package contains type contracts only: a consumer narrows
// `TAnyTuiCommandInteraction` on its `onMissingArgs` discriminant rather than calling a type guard.
