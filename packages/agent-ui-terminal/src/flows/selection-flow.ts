export interface ISelectionFlowState {
  selectedIndex: number;
  scrollOffset: number;
  resolved: boolean;
}

export interface ISelectionInputKey {
  escape?: boolean;
  return?: boolean;
  upArrow?: boolean;
  downArrow?: boolean;
  leftArrow?: boolean;
  rightArrow?: boolean;
}

export type TSelectionInputAction = 'cancel' | 'select' | 'previous' | 'next';

export type TSelectionEffect =
  | { type: 'none' }
  | { type: 'cancel' }
  | { type: 'select'; index: number }
  // CLI-2004: a checklist toggles many times and then commits; only the numbered branch emits it.
  | { type: 'confirm' };

export interface ISelectionFlowOptions {
  itemCount: number;
  maxVisible?: number;
  wrap?: boolean;
  enabled?: boolean;
}

export function createSelectionFlowState(): ISelectionFlowState {
  return { selectedIndex: 0, scrollOffset: 0, resolved: false };
}

export function getVerticalSelectionInputAction(
  key: ISelectionInputKey,
): TSelectionInputAction | undefined {
  if (key.escape === true) return 'cancel';
  if (key.upArrow === true) return 'previous';
  if (key.downArrow === true) return 'next';
  if (key.return === true) return 'select';
  return undefined;
}

export function getDirectionalSelectionInputAction(
  key: ISelectionInputKey,
): TSelectionInputAction | undefined {
  if (key.escape === true) return 'cancel';
  if (key.leftArrow === true || key.upArrow === true) return 'previous';
  if (key.rightArrow === true || key.downArrow === true) return 'next';
  if (key.return === true) return 'select';
  return undefined;
}

/**
 * CLI-2004 — the typed-number branch of a selection.
 *
 * Screen-reader mode replaces arrow-key navigation with a numbered list and a typed answer, but the
 * SELECTION itself must stay owned by this module: two reducers deciding what "selected" means is
 * how a menu ends up resolving differently depending on how you drove it. `applyNumericSelection`
 * accumulates digits and resolves on Enter; everything downstream is the same `TSelectionEffect`.
 */
export interface INumericSelectionState {
  /** Digits typed so far, before Enter. */
  buffer: string;
  /** The last Enter was outside `1..itemCount` (or empty) — the caller re-prints the prompt. */
  invalid: boolean;
  resolved: boolean;
}

export interface INumericSelectionOptions {
  itemCount: number;
  /** Escape resolves as a cancel only when the menu offers one. */
  cancellable?: boolean;
  /**
   * A checklist: a number TOGGLES its row and the menu stays open, so Enter on an empty buffer is
   * the commit rather than an invalid entry. A single-choice menu resolves on the first number.
   */
  multi?: boolean;
}

export function createNumericSelectionState(): INumericSelectionState {
  return { buffer: '', invalid: false, resolved: false };
}

/**
 * Apply one keystroke to a numbered selection. Digits accumulate; Backspace edits; Enter resolves or
 * marks the entry invalid; Escape cancels when the menu is cancellable. A non-digit character is
 * ignored rather than treated as an answer — the invalid signal is reserved for a completed entry.
 */
export function applyNumericSelection(
  state: INumericSelectionState,
  input: string,
  key: ISelectionInputKey & { backspace?: boolean; delete?: boolean },
  options: INumericSelectionOptions,
): { state: INumericSelectionState; effect: TSelectionEffect } {
  if (state.resolved) return { state, effect: { type: 'none' } };
  if (key.escape === true && options.cancellable === true) {
    return { state: { ...state, resolved: true }, effect: { type: 'cancel' } };
  }
  if (key.backspace === true || key.delete === true) {
    return { state: { ...state, buffer: state.buffer.slice(0, -1) }, effect: { type: 'none' } };
  }
  if (key.return === true) {
    // A checklist commits on an empty Enter; a single-choice menu has nothing to commit, so the
    // same keystroke there is an entry that named no row.
    if (options.multi === true && state.buffer === '') {
      return { state: { ...state, invalid: false, resolved: true }, effect: { type: 'confirm' } };
    }
    const index = Number.parseInt(state.buffer, 10) - 1;
    if (!Number.isInteger(index) || index < 0 || index >= options.itemCount) {
      return { state: { ...state, buffer: '', invalid: true }, effect: { type: 'none' } };
    }
    return {
      // A toggle leaves the menu open — only a single-choice selection resolves it.
      state: { ...state, buffer: '', invalid: false, resolved: options.multi !== true },
      effect: { type: 'select', index },
    };
  }
  if (/^[0-9]+$/.test(input)) {
    return {
      state: { ...state, buffer: state.buffer + input, invalid: false },
      effect: { type: 'none' },
    };
  }
  return { state, effect: { type: 'none' } };
}

export function applySelectionInput(
  state: ISelectionFlowState,
  action: TSelectionInputAction,
  options: ISelectionFlowOptions,
): { state: ISelectionFlowState; effect: TSelectionEffect } {
  if (state.resolved) {
    return { state, effect: { type: 'none' } };
  }
  if (action === 'cancel') {
    return { state: { ...state, resolved: true }, effect: { type: 'cancel' } };
  }
  if (options.enabled === false || options.itemCount === 0) {
    return { state, effect: { type: 'none' } };
  }
  if (action === 'select') {
    const index = clampIndex(state.selectedIndex, options.itemCount);
    return {
      state: { ...state, selectedIndex: index, resolved: true },
      effect: { type: 'select', index },
    };
  }
  const selectedIndex = moveSelection(state.selectedIndex, action, options);
  const scrollOffset = resolveScrollOffset(selectedIndex, state.scrollOffset, options);
  return { state: { ...state, selectedIndex, scrollOffset }, effect: { type: 'none' } };
}

export function normalizeSelectionState(
  state: ISelectionFlowState,
  options: ISelectionFlowOptions,
): ISelectionFlowState {
  if (options.itemCount === 0) {
    return { ...state, selectedIndex: 0, scrollOffset: 0 };
  }
  const selectedIndex = clampIndex(state.selectedIndex, options.itemCount);
  const scrollOffset = resolveScrollOffset(selectedIndex, state.scrollOffset, options);
  if (selectedIndex === state.selectedIndex && scrollOffset === state.scrollOffset) {
    return state;
  }
  return {
    ...state,
    selectedIndex,
    scrollOffset,
  };
}

function moveSelection(
  selectedIndex: number,
  action: TSelectionInputAction,
  options: ISelectionFlowOptions,
): number {
  if (action === 'previous') {
    if (options.wrap === true && selectedIndex === 0) return options.itemCount - 1;
    return Math.max(0, selectedIndex - 1);
  }
  if (options.wrap === true && selectedIndex === options.itemCount - 1) return 0;
  return Math.min(options.itemCount - 1, selectedIndex + 1);
}

function resolveScrollOffset(
  selectedIndex: number,
  scrollOffset: number,
  options: ISelectionFlowOptions,
): number {
  const maxVisible = options.maxVisible ?? options.itemCount;
  if (maxVisible <= 0) return 0;
  if (selectedIndex < scrollOffset) return selectedIndex;
  if (selectedIndex >= scrollOffset + maxVisible) return selectedIndex - maxVisible + 1;
  return Math.max(0, scrollOffset);
}

function clampIndex(index: number, itemCount: number): number {
  return Math.min(Math.max(index, 0), itemCount - 1);
}
