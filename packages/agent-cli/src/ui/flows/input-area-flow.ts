import type { IHistoryEntry, TUniversalValue } from '@robota-sdk/agent-core';
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
export type TPromptHistoryInputAction = 'previous' | 'next';

export type TCommandSelectionResult =
  | { type: 'insert'; value: string; selectedIndex?: number }
  | { type: 'submit'; value: string };

export interface IPasteLabelChange {
  value: string;
  cursorHint: number;
  label: string;
  lineCount: number;
}

export interface IPromptHistoryNavigationState {
  selectedIndex: number | null;
  draft: string;
}

export interface IPromptHistoryNavigationResult {
  value: string;
  cursorHint: number;
  state: IPromptHistoryNavigationState;
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

export function getPromptHistoryInputAction(
  key: IAutocompleteInputKey,
): TPromptHistoryInputAction | undefined {
  if (key.upArrow === true) return 'previous';
  if (key.downArrow === true) return 'next';
  return undefined;
}

export function createPromptHistoryNavigationState(): IPromptHistoryNavigationState {
  return { selectedIndex: null, draft: '' };
}

export function navigatePromptHistory(
  value: string,
  history: readonly string[],
  state: IPromptHistoryNavigationState,
  action: TPromptHistoryInputAction,
): IPromptHistoryNavigationResult {
  if (history.length === 0) {
    return { value, cursorHint: value.length, state };
  }

  if (action === 'previous') {
    const selectedIndex =
      state.selectedIndex === null ? history.length - 1 : Math.max(0, state.selectedIndex - 1);
    const nextValue = history[selectedIndex] ?? value;
    return {
      value: nextValue,
      cursorHint: nextValue.length,
      state: { selectedIndex, draft: state.selectedIndex === null ? value : state.draft },
    };
  }

  if (state.selectedIndex === null) {
    return { value, cursorHint: value.length, state };
  }

  if (state.selectedIndex < history.length - 1) {
    const selectedIndex = state.selectedIndex + 1;
    const nextValue = history[selectedIndex] ?? value;
    return {
      value: nextValue,
      cursorHint: nextValue.length,
      state: { ...state, selectedIndex },
    };
  }

  return {
    value: state.draft,
    cursorHint: state.draft.length,
    state: createPromptHistoryNavigationState(),
  };
}

export function appendPromptHistory(history: readonly string[], value: string): string[] {
  const prompt = value.trim();
  if (prompt.length === 0) return [...history];
  if (history[history.length - 1] === prompt) return [...history];
  return [...history, prompt];
}

export function extractPromptHistory(entries: readonly IHistoryEntry[]): string[] {
  let prompts: string[] = [];
  for (const entry of entries) {
    if (entry.category !== 'chat' || entry.type !== 'user') continue;
    const data = entry.data as Record<string, TUniversalValue> | undefined;
    if (typeof data?.content !== 'string') continue;
    prompts = appendPromptHistory(prompts, data.content);
  }
  return prompts;
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
