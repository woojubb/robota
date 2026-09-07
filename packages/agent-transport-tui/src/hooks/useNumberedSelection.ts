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
  onSelect: (index: number) => void;
  onCancel?: () => void;
}

export interface INumberedSelection {
  buffer: string;
  invalid: boolean;
}

/** Read a typed selection for a numbered list. */
export function useNumberedSelection(inputs: IUseNumberedSelectionInputs): INumberedSelection {
  const [state, setState] = useState<INumericSelectionState>(createNumericSelectionState);
  const stateRef = useRef(state);
  const { enabled, itemCount, cancellable, onSelect, onCancel } = inputs;

  const handle = useCallback(
    (input: string, key: Parameters<typeof applyNumericSelection>[2]): void => {
      const result = applyNumericSelection(stateRef.current, input, key, {
        itemCount,
        ...(cancellable === true ? { cancellable: true } : {}),
      });
      stateRef.current = result.state;
      setState(result.state);
      if (result.effect.type === 'select') onSelect(result.effect.index);
      else if (result.effect.type === 'cancel') onCancel?.();
    },
    [itemCount, cancellable, onSelect, onCancel],
  );

  useInput(
    (input, key) => {
      handle(input, key);
    },
    { isActive: enabled },
  );

  return { buffer: state.buffer, invalid: state.invalid };
}
