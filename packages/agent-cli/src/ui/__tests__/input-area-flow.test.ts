import { describe, expect, it } from 'vitest';
import {
  createPasteLabelChange,
  getAutocompletePopupAction,
  getPendingPromptInputAction,
  moveAutocompleteSelection,
  resolveEnterCommandSelection,
  resolveTabCompletion,
  shouldSubmitInput,
} from '../flows/input-area-flow.js';
import type { ISlashCommand } from '../../commands/types.js';

const command = (name: string, subcommands?: ISlashCommand[]): ISlashCommand => ({
  name,
  description: `${name} command`,
  source: 'test',
  subcommands,
  execute: async () => {},
});

describe('input area flow', () => {
  it('Given autocomplete key info When mapped Then popup actions are produced', () => {
    expect(getAutocompletePopupAction({ upArrow: true })).toBe('previous');
    expect(getAutocompletePopupAction({ downArrow: true })).toBe('next');
    expect(getAutocompletePopupAction({ escape: true })).toBe('close');
    expect(getAutocompletePopupAction({ tab: true })).toBe('complete');
  });

  it('Given pending prompt key info When mapped Then cancel queue action is produced', () => {
    expect(getPendingPromptInputAction({ backspace: true })).toBe('cancelQueue');
    expect(getPendingPromptInputAction({ delete: true })).toBe('cancelQueue');
    expect(getPendingPromptInputAction({ downArrow: true })).toBeUndefined();
  });

  it('Given wrapping autocomplete When moving beyond bounds Then index wraps', () => {
    expect(moveAutocompleteSelection(0, 3, 'previous')).toBe(2);
    expect(moveAutocompleteSelection(2, 3, 'next')).toBe(0);
  });

  it('Given parent command input When tab completes subcommand Then child name is inserted', () => {
    const result = resolveTabCompletion('/plugin i', command('install'));

    expect(result).toEqual({ type: 'insert', value: '/plugin install ' });
  });

  it('Given command with subcommands When enter selects it Then command name is inserted', () => {
    const result = resolveEnterCommandSelection('/pl', command('plugin', [command('list')]));

    expect(result).toEqual({ type: 'insert', value: '/plugin ', selectedIndex: 0 });
  });

  it('Given leaf command When enter selects it Then submit value is emitted', () => {
    const result = resolveEnterCommandSelection('/he', command('help'));

    expect(result).toEqual({ type: 'submit', value: '/help' });
  });

  it('Given multiline paste When label change is created Then label is inserted at cursor', () => {
    const result = createPasteLabelChange('abef', 2, 7, 'c\nd\ne');

    expect(result).toEqual({
      value: 'ab[Pasted text #7 +3 lines]ef',
      cursorHint: 27,
      label: '[Pasted text #7 +3 lines]',
      lineCount: 3,
    });
  });

  it('Given blank prompt When checked Then submit is rejected', () => {
    expect(shouldSubmitInput('   ')).toBe(false);
    expect(shouldSubmitInput(' hello ')).toBe(true);
  });
});
