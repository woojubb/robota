/**
 * CJK-aware cursor geometry and motion.
 *
 * Display columns and character indices are different things when a character is two columns wide;
 * these functions are the translation between them, and the two cursor moves built on it.
 *
 * Extracted from `cjk-text-input-flow.ts` (CLI-2004) by responsibility — that module routes
 * keystrokes, this one measures and moves.
 */

import stringWidth from 'string-width';

import type { ICjkTextInputFlowState, TCjkTextInputEffect } from './cjk-text-input-flow.js';

interface ICjkMotionResult {
  state: ICjkTextInputFlowState;
  effect: TCjkTextInputEffect;
}

export function displayOffset(chars: string[], charIndex: number, width: number): number {
  let offset = 0;
  for (let i = 0; i < charIndex && i < chars.length; i++) {
    const w = stringWidth(chars[i]!);
    const col = offset % width;
    if (col + w > width) offset += width - col;
    offset += w;
  }
  return offset;
}

export function charIndexAtDisplayOffset(chars: string[], target: number, width: number): number {
  let offset = 0;
  for (let i = 0; i < chars.length; i++) {
    if (offset >= target) return i;
    const w = stringWidth(chars[i]!);
    const col = offset % width;
    if (col + w > width) offset += width - col;
    offset += w;
  }
  return chars.length;
}

export function moveCursorVertically(
  state: ICjkTextInputFlowState,
  direction: 'up' | 'down',
  availableWidth: number | undefined,
): ICjkMotionResult {
  if (!availableWidth || availableWidth <= 0) {
    return { state, effect: { type: 'none' } };
  }
  const chars = [...state.value];
  const offset = displayOffset(chars, state.cursor, availableWidth);
  const target = direction === 'up' ? offset - availableWidth : offset + availableWidth;
  if (target < 0) {
    return { state, effect: { type: 'none' } };
  }
  const cursor = charIndexAtDisplayOffset(chars, target, availableWidth);
  if (cursor === state.cursor) {
    return { state, effect: { type: 'none' } };
  }
  return { state: { ...state, cursor }, effect: { type: 'render' } };
}

export function moveCursorHorizontally(
  state: ICjkTextInputFlowState,
  direction: 'left' | 'right',
): ICjkMotionResult {
  if (direction === 'left' && state.cursor > 0) {
    return { state: { ...state, cursor: state.cursor - 1 }, effect: { type: 'render' } };
  }
  if (direction === 'right' && state.cursor < state.value.length) {
    return { state: { ...state, cursor: state.cursor + 1 }, effect: { type: 'render' } };
  }
  return { state, effect: { type: 'none' } };
}
