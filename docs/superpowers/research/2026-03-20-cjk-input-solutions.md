# CJK Input Solutions for Ink CLI — Research

## Problem

Korean input in macOS Terminal.app has cursor misalignment on space, character duplication, and composition visibility issues. ink-text-input uses `string.length` instead of display width for CJK characters.

## Solution Candidates

### Candidate 1: string-width + useCursor (Ink Built-in)

Replace `string.length` with `string-width` for cursor position calculation. Ink provides `useCursor` hook for real cursor positioning.

```tsx
import stringWidth from 'string-width';
import { useCursor } from 'ink';

const cursorX = stringWidth(prompt + text); // '한글' → 4, not 2
setCursorPosition({ x: cursorX, y: cursorY });
```

- **Effort**: Low — patch ink-text-input or build custom component
- **Solves**: Cursor misalignment, space key issues
- **Doesn't solve**: IME composition visibility

Source: https://github.com/vadimdemedes/ink (useCursor docs)

### Candidate 2: CURSOR_MARKER (Ink 0.17.0+)

Ink supports `enableImeCursor` option and `CURSOR_MARKER` for real cursor alignment with IME.

```tsx
import { render, CURSOR_MARKER } from 'ink';
render(<App />, { enableImeCursor: true });
// In render: {text}{CURSOR_MARKER}
```

- **Effort**: Low — upgrade Ink, add option
- **Solves**: IME candidate window position
- **Requires**: Ink 0.17.0+ (check if our version supports it)

Source: https://github.com/anthropics/claude-code/issues/19207

### Candidate 3: Custom TextInput with Composition Buffer

Build custom text input component with separate composition state:

```typescript
interface CompositionState {
  text: string; // committed text
  composition: string; // in-progress IME text (underlined)
  compositionCaret: number;
}
```

- **Effort**: High — full custom input component
- **Solves**: All CJK issues (composition visibility, cursor, width)
- **Reference**: cmux PR #125, SDL2 pattern

Source: https://github.com/manaflow-ai/cmux/pull/125

### Candidate 4: Intl.Segmenter for Word Navigation

Use `Intl.Segmenter` API for CJK word boundary detection (Option+Arrow keys).

```typescript
const segmenter = new Intl.Segmenter('ko', { granularity: 'word' });
```

- **Effort**: Low — add to key handler
- **Solves**: Word navigation in CJK text
- **Requires**: Node.js 16+

Source: https://github.com/google-gemini/gemini-cli/pull/14475

## Recommended Approach (Incremental)

**Phase 1** (Quick fix): Candidate 1 — Add `string-width` to ink-text-input cursor calculation

- Fixes the most visible issue (space key cursor jump)
- Minimal code change

**Phase 2** (IME support): Candidate 2 — Enable CURSOR_MARKER

- Fixes IME candidate window position
- Requires Ink version check

**Phase 3** (Full solution): Candidate 3 — Custom TextInput

- Replaces ink-text-input entirely
- Handles composition buffer, width calculation, IME positioning
- Most work but solves everything

## Useful Libraries

| Package        | Purpose                                 |
| -------------- | --------------------------------------- |
| string-width   | Visual width calculation (CJK = 2 cols) |
| cjk-length     | Alternative CJK width calculator        |
| zenkaku-string | Wide-aware string slicing               |
| terminal-kit   | Cursor movement API                     |

## Terminal Compatibility

| Terminal           | Korean Input    | IME Window     | Notes                  |
| ------------------ | --------------- | -------------- | ---------------------- |
| macOS Terminal.app | Broken (cursor) | Wrong position | Most users affected    |
| iTerm2             | Works           | Wrong position | Better but not perfect |
| Ghostty            | Works           | Works (1.1.0+) | Best CJK support       |

## References

- https://github.com/anthropics/claude-code/issues/19207
- https://github.com/anthropics/claude-code/issues/22732
- https://github.com/manaflow-ai/cmux/pull/125
- https://github.com/google-gemini/gemini-cli/pull/14475
- https://sebastian.graphics/blog/sdl2-cjk.html
- https://github.com/vadimdemedes/ink
- https://github.com/vadimdemedes/ink-text-input
