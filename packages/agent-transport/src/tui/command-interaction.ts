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

export function isPickerInteraction(
  interaction: ITuiCommandInteraction,
): interaction is ITuiPickerInteraction {
  return interaction.onMissingArgs === 'picker';
}

export function isConfirmInteraction(
  interaction: ITuiCommandInteraction,
): interaction is ITuiConfirmInteraction {
  return interaction.onMissingArgs === 'confirm';
}
