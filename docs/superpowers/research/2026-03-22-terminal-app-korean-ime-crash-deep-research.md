# Terminal.app Korean IME Crash — Deep Research

## Crash Pattern

```
Thread 0: (input method 875 com.apple.inputmethod.Korean)
EXC_BAD_ACCESS (SIGSEGV) at 0x0000000000000000
0  _platform_memmove + 444  (x1=0, null source pointer)
1  Terminal internal code
2  __55-[NSTextInputContext handleTSMEvent:completionHandler:]_block_invoke_6.420
...
16 -[IMKInputSession_Modern attributedSubstringFromRange:completionHandler:]
```

## Root Cause

Terminal.app's `NSTextInputClient` implementation bug:
1. Ink `setRawMode(true)` puts PTY in raw byte mode
2. Korean IME activates and begins composition
3. IME sends `attributedSubstringFromRange:` to Terminal.app
4. Terminal.app's text buffer is null/inconsistent (raw mode bypassed normal text storage)
5. `_platform_memmove(dest, NULL, size)` → SIGSEGV at address 0x0

This is a Terminal.app crash, not our process crash.

## Why No Public Fix Exists

- No Apple Feedback/radar found for this crash
- Terminal.app's NSTextInputClient lacks null guard in raw mode path
- Only Apple can fix this (Terminal.app native code)
- Claude Code has the same issue (issues #22732, #2620, #7804, #3045)

## Workarounds (Best to Worst)

### 1. Use Different Terminal Emulator

- **iTerm2**: Most reliable, widely used alternative
- **Ghostty v1.1+**: Rewrote NSTextInputClient implementation, more defensive

### 2. `claude-ime` PTY Wrapper

- Rust-based PTY wrapper that intercepts IME composition at PTY level
- Install: `npm install -g @agenon/claude-ime` or `cargo install claude-ime`
- Buffers incomplete hangul composition sequences
- Flushes only complete characters
- Prevents partial composition from reaching Terminal.app

### 3. Third-party Korean IME

- Switch from Apple default `com.apple.inputmethod.Korean` to:
  - Gureumkim (구름 입력기)
  - Hancom Keyboard
- May avoid the specific `attributedSubstringFromRange:` crash path

### 4. External Composition + Paste

- Type in any text editor, paste into CLI
- Universally reliable

### 5. File Apple Bug Report

- Submit at feedback.apple.com
- Attach full crash log with Thread 0 stack trace
- Key info: Terminal.app 2.15 (466), macOS 26.3, raw mode PTY

## Technical Limitations

| Approach | Why It Fails |
|---|---|
| Detect IME activation from Node.js | No POSIX signal, no FD event for IME state |
| Disable raw mode during composition | Crash happens before Node.js can detect composition start |
| Patch React Ink | Ink has no IME composition support by design |
| `setCursorPosition` fix | Removed, but crash still occurs — not the root cause |
| `uncaughtException` handler | Crash is in Terminal.app, not our process |
| SIGSEGV signal handler | Signal is in Terminal.app process, not ours |

## References

- [Claude Code #22732: Korean IME invisible composition](https://github.com/anthropics/claude-code/issues/22732)
- [Claude Code #3045: Patching React Ink for IME](https://github.com/anthropics/claude-code/issues/3045)
- [Claude Code #2620: IME Composition Failure](https://github.com/anthropics/claude-code/issues/2620)
- [Claude Code #7804: macOS Korean Input Method](https://github.com/anthropics/claude-code/issues/7804)
- [claude-ime on lib.rs](https://lib.rs/crates/claude-ime)
- [cmux NSTextInputClient fix PR #1410](https://github.com/manaflow-ai/cmux/pull/1410)
- [Ghostty IME Discussion #9213](https://github.com/ghostty-org/ghostty/discussions/9213)
