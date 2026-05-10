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
  | { type: 'select'; index: number };

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
