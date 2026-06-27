/**
 * Contract tests for the type-only TUI command-interaction package (TEST-001).
 *
 * This package exports type contracts only (runtime type-guards live in the consuming
 * runtime package). These tests assert that the contracts compile to the expected shape
 * and that the discriminated union narrows by `onMissingArgs` — so a breaking change to the
 * contract fails here, not silently downstream.
 */
import { describe, it, expect } from 'vitest';
import type {
  ITuiPickerInteraction,
  ITuiConfirmInteraction,
  ITuiPickerItem,
  TAnyTuiCommandInteraction,
  TOnMissingArgsAction,
} from '../command-interaction';

describe('TUI command-interaction contracts', () => {
  it('ITuiPickerInteraction requires onMissingArgs="picker" and getItems()', () => {
    const items: ITuiPickerItem[] = [
      { label: 'A', value: 'a' },
      { label: 'B', value: 'b', description: 'second' },
    ];
    const picker: ITuiPickerInteraction = {
      onMissingArgs: 'picker',
      getItems: () => items,
    };
    expect(picker.onMissingArgs).toBe('picker');
    expect(picker.getItems()).toHaveLength(2);
    expect(picker.getItems()[1]?.description).toBe('second');
  });

  it('ITuiConfirmInteraction requires onMissingArgs="confirm" and a message', () => {
    const confirm: ITuiConfirmInteraction = {
      onMissingArgs: 'confirm',
      message: 'Proceed?',
    };
    expect(confirm.onMissingArgs).toBe('confirm');
    expect(confirm.message).toBe('Proceed?');
  });

  it('the union narrows by the onMissingArgs discriminant', () => {
    function describeInteraction(interaction: TAnyTuiCommandInteraction): string {
      // If the discriminant changes, this switch fails to narrow and the test will not compile.
      switch (interaction.onMissingArgs) {
        case 'picker':
          return `picker:${interaction.getItems().length}`;
        case 'confirm':
          return `confirm:${interaction.message}`;
        default: {
          const _exhaustive: never = interaction;
          return _exhaustive;
        }
      }
    }

    expect(describeInteraction({ onMissingArgs: 'picker', getItems: () => [] })).toBe('picker:0');
    expect(describeInteraction({ onMissingArgs: 'confirm', message: 'ok' })).toBe('confirm:ok');
  });

  it('TOnMissingArgsAction admits the documented actions', () => {
    const actions: TOnMissingArgsAction[] = ['picker', 'wizard', 'confirm'];
    expect(actions).toContain('wizard');
  });
});
