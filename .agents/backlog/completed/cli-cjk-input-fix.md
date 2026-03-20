# CJK Input Fix for CLI

## Problem

Korean input in macOS Terminal.app has issues:

- Space after Korean characters causes cursor misalignment
- Characters may shift or duplicate on space key
- Works fine in iTerm2 but broken in Terminal.app

## Root Cause

ink-text-input calculates cursor position using `string.length`, but CJK characters (Korean, Chinese, Japanese) occupy 2 terminal columns per character. This causes cursor position to be off by N columns where N = number of CJK characters.

Example: "한글" is 2 characters but 4 columns wide. Cursor position calculated as 2 but should be 4.

## Solution

Use `string-width` library for display width calculation instead of `string.length`:

```typescript
import stringWidth from 'string-width';
const width = stringWidth('한글'); // 4 (not 2)
```

Options:

1. **Fork/patch ink-text-input** — replace internal width calculations with string-width
2. **Custom TextInput component** — build our own that uses string-width from the start
3. **Upstream PR to ink-text-input** — contribute the fix

## Additional Issues (from research)

### IME Composition Visibility

- Characters invisible during IME composition in raw mode
- Claude Code fixed this (issue #22732) with heuristic composition detection
- Requires: composition buffer, preedit rendering, composition end detection

### IME Candidate Window Position

- Claude Code fixed (PR #17127) with CURSOR_MARKER system
- Requires patching Ink's render pipeline to control real cursor position

## References

- https://github.com/anthropics/claude-code/issues/22732 (composition invisible)
- https://github.com/anthropics/claude-code/issues/19207 (cursor position)
- https://github.com/alacritty/alacritty/issues/8079 (space double insert)
- https://github.com/manaflow-ai/cmux/pull/125 (CJK IME fix)
- https://github.com/vadimdemedes/ink (string-width recommendation)

## Priority

High for Korean users. Workaround: use iTerm2 or Ghostty instead of Terminal.app.
