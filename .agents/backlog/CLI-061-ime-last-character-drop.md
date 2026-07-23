---
title: 'CLI-061: watch Ink upstream for a Korean-IME composition fix, then upgrade + verify'
status: todo
created: 2026-06-10
priority: low
urgency: later
area: packages/agent-cli, packages/agent-transport-tui
depends_on: []
blocked_on: 'upstream ink (raw-mode composition / IME handling)'
---

# CLI-061: Korean IME last-character drop — track upstream Ink, do not patch locally

## Problem

When typing Korean via IME in the TUI input and pressing Enter, the last in-composition character can be
lost. Root cause: **Ink runs stdin in raw mode, which exposes no `compositionstart`/`compositionend` events**
(documented in `packages/agent-transport/src/tui/InputArea.tsx`). Byte-level jamo composition cannot be
reliably distinguished from a completed keystroke at our layer, so a local mitigation (deferring submit,
flushing pending bytes, timing heuristics) is fragile and risks double-submit / added latency on non-IME input.

**Decision (owner, 2026-07-23): do NOT patch this locally.** A robust fix belongs upstream in Ink's raw-mode
input handling. This item is re-scoped from "implement a fix" to **"watch Ink for a version that addresses it,
then upgrade and verify."**

## What (monitor → upgrade → verify)

Current Ink: **`^7.0.5`** (`packages/agent-cli`, `packages/agent-transport-tui`).

1. **Periodically check** for a newer Ink release (> the currently-pinned version) whose changelog / release
   notes mention IME / composition / CJK / raw-mode input handling. Sources: the Ink GitHub releases +
   CHANGELOG, and the open IME/CJK issues on the Ink repo.
2. **When a candidate version ships**, bump Ink in both packages, rebuild, and run the CJK verification below.
3. If verified fixed → close this item with evidence. If a candidate ships but does NOT fix it → record the
   checked version + result and keep watching.

## Test Plan

- On an Ink bump: `pnpm --filter @robota-sdk/agent-transport-tui --filter @robota-sdk/agent-cli build && test`
  (no TUI regression).
- Verify the CJK scenario below on the built binary.

## User Execution Test Scenarios

- Prerequisite: macOS/iTerm2 (or Terminal.app) with Korean IME; built CLI binary.
- Steps: run `robota`, type `안녕하세요`, press Enter immediately while the last syllable is still composing.
- Expected: the submitted user message shows the full `안녕하세요` including the final syllable.
- Evidence: (fill after an Ink bump that claims a fix — TUI capture of the complete submitted text).

## Notes

- This is a **blocked, watch-only** item — no local code change is planned unless the owner reverses the
  decision. It surfaces on each Ink dependency bump (Dependabot / manual) as the natural re-check trigger.
