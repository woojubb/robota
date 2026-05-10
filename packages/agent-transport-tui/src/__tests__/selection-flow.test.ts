import { describe, expect, it } from 'vitest';
import {
  applySelectionInput,
  createSelectionFlowState,
  getDirectionalSelectionInputAction,
  getVerticalSelectionInputAction,
} from '../flows/selection-flow.js';

describe('selection flow', () => {
  it('Given first item selected When previous is applied Then selection stays bounded', () => {
    const result = applySelectionInput(createSelectionFlowState(), 'previous', { itemCount: 3 });

    expect(result.state.selectedIndex).toBe(0);
    expect(result.effect).toEqual({ type: 'none' });
  });

  it('Given last item selected When next is applied Then selection stays bounded', () => {
    const state = { selectedIndex: 2, scrollOffset: 0, resolved: false };

    const result = applySelectionInput(state, 'next', { itemCount: 3 });

    expect(result.state.selectedIndex).toBe(2);
  });

  it('Given wrapping selection When previous from first is applied Then it wraps to last', () => {
    const result = applySelectionInput(createSelectionFlowState(), 'previous', {
      itemCount: 3,
      wrap: true,
    });

    expect(result.state.selectedIndex).toBe(2);
  });

  it('Given max visible window When moving below viewport Then scroll offset follows', () => {
    const state = applySelectionInput(createSelectionFlowState(), 'next', {
      itemCount: 4,
      maxVisible: 2,
    }).state;

    const result = applySelectionInput(state, 'next', { itemCount: 4, maxVisible: 2 });

    expect(result.state).toMatchObject({ selectedIndex: 2, scrollOffset: 1 });
  });

  it('Given selected item When select is applied Then selected index is emitted once', () => {
    const state = { selectedIndex: 1, scrollOffset: 0, resolved: false };

    const selected = applySelectionInput(state, 'select', { itemCount: 3 });
    const ignored = applySelectionInput(selected.state, 'select', { itemCount: 3 });

    expect(selected.effect).toEqual({ type: 'select', index: 1 });
    expect(ignored.effect).toEqual({ type: 'none' });
  });

  it('Given raw key info When mapped Then vertical and directional actions are produced', () => {
    expect(getVerticalSelectionInputAction({ downArrow: true })).toBe('next');
    expect(getVerticalSelectionInputAction({ escape: true })).toBe('cancel');
    expect(getDirectionalSelectionInputAction({ leftArrow: true })).toBe('previous');
    expect(getDirectionalSelectionInputAction({ rightArrow: true })).toBe('next');
  });
});
