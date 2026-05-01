import type { ISlashCommand } from '../../commands/types.js';
import { parseSlashInput } from '../hooks/useAutocomplete.js';

export interface IAutocompleteInputKey {
  upArrow?: boolean;
  downArrow?: boolean;
  escape?: boolean;
  tab?: boolean;
  backspace?: boolean;
  delete?: boolean;
}

export type TAutocompletePopupAction = 'previous' | 'next' | 'close' | 'complete';
export type TPendingPromptInputAction = 'cancelQueue';

export type TCommandSelectionResult =
  | { type: 'insert'; value: string; selectedIndex?: number }
  | { type: 'submit'; value: string };

export interface IPasteLabelChange {
  value: string;
  cursorHint: number;
  label: string;
  lineCount: number;
}

export function getAutocompletePopupAction(
  key: IAutocompleteInputKey,
): TAutocompletePopupAction | undefined {
  if (key.upArrow === true) return 'previous';
  if (key.downArrow === true) return 'next';
  if (key.escape === true) return 'close';
  if (key.tab === true) return 'complete';
  return undefined;
}

export function getPendingPromptInputAction(
  key: IAutocompleteInputKey,
): TPendingPromptInputAction | undefined {
  if (key.backspace === true || key.delete === true) {
    return 'cancelQueue';
  }
  return undefined;
}

export function moveAutocompleteSelection(
  selectedIndex: number,
  commandCount: number,
  direction: 'previous' | 'next',
): number {
  if (commandCount === 0) return 0;
  if (direction === 'previous') {
    return selectedIndex > 0 ? selectedIndex - 1 : commandCount - 1;
  }
  return selectedIndex < commandCount - 1 ? selectedIndex + 1 : 0;
}

export function resolveTabCompletion(
  value: string,
  command: ISlashCommand,
): TCommandSelectionResult {
  const parsed = parseSlashInput(value);
  if (parsed.parentCommand) {
    return { type: 'insert', value: `/${parsed.parentCommand} ${command.name} ` };
  }
  if (command.subcommands && command.subcommands.length > 0) {
    return { type: 'insert', value: `/${command.name} `, selectedIndex: 0 };
  }
  return { type: 'insert', value: `/${command.name} ` };
}

export function resolveEnterCommandSelection(
  value: string,
  command: ISlashCommand,
): TCommandSelectionResult {
  const parsed = parseSlashInput(value);
  if (parsed.parentCommand) {
    return { type: 'submit', value: `/${parsed.parentCommand} ${command.name}` };
  }
  if (command.subcommands && command.subcommands.length > 0) {
    return { type: 'insert', value: `/${command.name} `, selectedIndex: 0 };
  }
  return { type: 'submit', value: `/${command.name}` };
}

export function createPasteLabelChange(
  value: string,
  cursorPosition: number,
  pasteId: number,
  text: string,
): IPasteLabelChange {
  const lineCount = text.split('\n').length;
  const label = `[Pasted text #${pasteId} +${lineCount} lines]`;
  return {
    value: value.slice(0, cursorPosition) + label + value.slice(cursorPosition),
    cursorHint: cursorPosition + label.length,
    label,
    lineCount,
  };
}

export function shouldSubmitInput(text: string): boolean {
  return text.trim().length > 0;
}
