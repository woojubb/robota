import { describe, expect, it } from 'vitest';
import {
  applyConfirmPromptInput,
  getConfirmPromptInputAction,
} from '../flows/confirm-prompt-flow.js';
import {
  applyPermissionPromptInput,
  getPermissionPromptInputAction,
} from '../flows/permission-prompt-flow.js';
import { createSelectionFlowState } from '../flows/selection-flow.js';

describe('confirm prompt flow', () => {
  it('Given two options When y shortcut is mapped and applied Then first option is selected', () => {
    const action = getConfirmPromptInputAction('y', {}, 2);
    expect(action).toEqual({ type: 'shortcut', index: 0 });

    const result = applyConfirmPromptInput(createSelectionFlowState(), action!, 2);

    expect(result.effect).toEqual({ type: 'select', index: 0 });
  });

  it('Given more than two options When y or n is typed Then shortcuts are ignored', () => {
    expect(getConfirmPromptInputAction('y', {}, 3)).toBeUndefined();
    expect(getConfirmPromptInputAction('n', {}, 3)).toBeUndefined();
  });

  it('Given selection moved right When enter is applied Then current option is selected', () => {
    const moved = applyConfirmPromptInput(createSelectionFlowState(), 'next', 2).state;

    const result = applyConfirmPromptInput(moved, 'select', 2);

    expect(result.effect).toEqual({ type: 'select', index: 1 });
  });

  it('Given prompt is resolved When shortcut is applied Then no second selection is emitted', () => {
    const selected = applyConfirmPromptInput(createSelectionFlowState(), 'select', 2).state;

    const result = applyConfirmPromptInput(selected, { type: 'shortcut', index: 1 }, 2);

    expect(result.effect).toEqual({ type: 'none' });
  });
});

describe('permission prompt flow', () => {
  it('Given y shortcut When applied Then allow decision is emitted', () => {
    const action = getPermissionPromptInputAction('y', {});

    const result = applyPermissionPromptInput(createSelectionFlowState(), action!);

    expect(result.effect).toEqual({ type: 'resolve', decision: true });
  });

  it('Given a shortcut When applied Then allow-session decision is emitted', () => {
    const action = getPermissionPromptInputAction('a', {});

    const result = applyPermissionPromptInput(createSelectionFlowState(), action!);

    expect(result.effect).toEqual({ type: 'resolve', decision: 'allow-session' });
  });

  it('Given deny shortcuts When applied Then false decision is emitted', () => {
    expect(
      applyPermissionPromptInput(
        createSelectionFlowState(),
        getPermissionPromptInputAction('n', {})!,
      ).effect,
    ).toEqual({ type: 'resolve', decision: false });
    expect(
      applyPermissionPromptInput(
        createSelectionFlowState(),
        getPermissionPromptInputAction('3', {})!,
      ).effect,
    ).toEqual({ type: 'resolve', decision: false });
  });

  it('Given arrow navigation When enter is applied Then selected permission is resolved', () => {
    const moved = applyPermissionPromptInput(createSelectionFlowState(), 'next').state;

    const result = applyPermissionPromptInput(moved, 'select');

    expect(result.effect).toEqual({ type: 'resolve', decision: 'allow-session' });
  });

  it('Given permission is resolved When shortcut is applied Then no second decision is emitted', () => {
    const resolved = applyPermissionPromptInput(createSelectionFlowState(), 'select').state;

    const result = applyPermissionPromptInput(resolved, { type: 'shortcut', index: 2 });

    expect(result.effect).toEqual({ type: 'none' });
  });
});
