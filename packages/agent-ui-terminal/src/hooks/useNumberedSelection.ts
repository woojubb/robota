/**
 * CLI-2004 — the typed-number input wiring shared by every numbered menu.
 *
 * The reducer lives in `flows/selection-flow.ts` (one owner of "what is selected"); this hook is the
 * Ink adapter around it, so six components get the same behaviour without six copies of the same
 * `useInput` block. Inactive when the mode is off, so the arrow-key handlers keep the terminal.
 */

import { useInput } from 'ink';
import { useCallback, useRef, useState } from 'react';

import {
  applyNumericSelection,
  createNumericSelectionState,
  type INumericSelectionState,
} from '../flows/selection-flow.js';

export interface IUseNumberedSelectionInputs {
  /** Screen-reader mode. Off ⇒ the hook reads nothing. */
  enabled: boolean;
  itemCount: number;
  cancellable?: boolean;
  /** A checklist: a number toggles a row, the menu stays open, and an empty Enter commits. */
  multi?: boolean;
  /** Keep a single-row selection open so the user can select another row later. */
  repeatable?: boolean;
  onSelect: (index: number) => void;
  onCancel?: () => void;
  /** Required with `multi` — what an empty Enter commits. */
  onConfirm?: () => void;
}

export interface INumberedSelection {
  buffer: string;
  invalid: boolean;
  clear: () => void;
}

/** Read a typed selection for a numbered list. */
export function useNumberedSelection(inputs: IUseNumberedSelectionInputs): INumberedSelection {
  const [state, setState] = useState<INumericSelectionState>(createNumericSelectionState);
  const stateRef = useRef(state);
  const { enabled, itemCount, cancellable, multi, repeatable, onSelect, onCancel, onConfirm } =
    inputs;

  const clear = useCallback((): void => {
    const empty = createNumericSelectionState();
    stateRef.current = empty;
    setState(empty);
  }, []);

  const handle = useCallback(
    (input: string, key: Parameters<typeof applyNumericSelection>[2]): boolean => {
      const result = applyNumericSelection(stateRef.current, input, key, {
        itemCount,
        ...(cancellable === true ? { cancellable: true } : {}),
        ...(multi === true ? { multi: true } : {}),
        ...(repeatable === true ? { repeatable: true } : {}),
      });
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'select') onSelect(result.effect.index);
      else if (result.effect.type === 'cancel') onCancel?.();
      else if (result.effect.type === 'confirm') onConfirm?.();
      return result.effect.type !== 'none';
    },
    [itemCount, cancellable, multi, repeatable, onSelect, onCancel, onConfirm],
  );

  useInput(
    (input, key) => {
      // Pasted or fast-typed input can arrive as one chunk ("2\r"): Ink then reports it as plain
      // text with no return key. Replay it as the keystrokes it contains so the Enter is not lost,
      // but only up to the first keystroke that acts: the menu's callbacks see the state of the
      // current render, so acting twice within one chunk could decide on stale state.
      if (key.return !== true && /[\r\n]/u.test(input)) {
        const plainKey = { ...key, return: false };
        for (const part of input.split(/(\r\n|\r|\n)/u)) {
          if (part === '') continue;
          const acted = /^(\r\n|\r|\n)$/u.test(part)
            ? handle('', { ...plainKey, return: true })
            : handle(part, plainKey);
          if (acted) break;
        }
        return;
      }
      handle(input, key);
    },
    { isActive: enabled },
  );

  return { buffer: state.buffer, invalid: state.invalid, clear };
}
