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

## macOS Terminal.app Crash (SIGSEGV)

Terminal.app crashes with `EXC_BAD_ACCESS (SIGSEGV)` when using Korean IME with Ink raw mode:

- Thread: `(input method 875 com.apple.inputmethod.Korean)`
- Crash in: `_platform_memmove` → `[NSTextInputContext handleTSMEvent:]` → `attributedSubstringFromRange:`
- Cause: Terminal.app queries text buffer via IME, but raw mode has no text buffer → null pointer
- This is a **Terminal.app bug**, not fixable from our code
- Same issue exists in Claude Code (documented in issue #3045, #22732)

## Priority

High for Korean users. **Workaround: use iTerm2 or Ghostty instead of macOS Terminal.app.**
