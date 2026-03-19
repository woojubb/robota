# Korean IME Input — Last Character Dropped on Enter

## Problem

When typing Korean in the CLI input and pressing Enter, the last composing character is dropped. For example, typing "안녕하세요" and pressing Enter submits "안녕하세".

## Root Cause

Ink uses terminal raw mode which has no IME composition events (compositionstart/compositionend). When Enter is pressed during Korean character composition, ink-text-input fires onSubmit with the pre-composition value.

This is a known limitation in Claude Code as well:

- https://github.com/anthropics/claude-code/issues/3045
- https://github.com/anthropics/claude-code/issues/22732

## Failed Approaches

- setTimeout delay (0ms, 50ms, 100ms): insufficient or breaks normal typing
- IME composition heuristic tracking via onChange timer: breaks non-IME input (period cuts last Korean character)

## Potential Solutions

1. **Ink cursor marker patch** (Claude Code PR #17127): Patch Ink rendering to control terminal cursor position for IME candidate windows
2. **Custom TextInput** without ink-text-input: Build a Korean-aware input component using raw stdin directly
3. **Space-then-Enter workaround**: Document that users should add a space before Enter when composing Korean

## Priority

Medium — affects Korean users. Workaround: add space or period before Enter to commit the composition.
