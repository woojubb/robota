---
title: 'SEC-019: model and tool output can inject terminal control sequences'
issue: https://github.com/woojubb/robota/issues/2022
status: in-progress
created: 2026-08-23
priority: critical
urgency: now
area: packages/agent-transport-tui
depends_on: []
---

# SEC-019: model and tool output can inject terminal control sequences

## Problem

Untrusted text — model responses, tool output, file contents, plugin text — reaches Ink `<Text>`, and
**Ink passes control sequences through**. So a malicious repository, fetched document, plugin or model
response could act on the terminal independently of what the transcript appeared to say: OSC 52 writes
the clipboard, OSC 8 makes a link whose visible text and target differ, CSI moves the cursor or erases
what is on screen.

## The sinks, enumerated rather than sampled

SEC-018 cost five review rounds because its sink list came from a filed issue's evidence links rather
than from an enumeration. So this one started by enumerating:

| sink                                                                                   | what reaches it                                                                                            |
| -------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `renderMarkdown` — 3 call sites (`MessageList`, `StreamingIndicator`, `ToolDiffBlock`) | assistant content, streamed text, tool diff markdown                                                       |
| `MessageList` tool summary lines                                                       | `s.line`, `line` — tool stdout, rendered raw                                                               |
| `MessageList` tool name                                                                | `toolName` — raw                                                                                           |
| `MessageList` error block                                                              | provider errors, tool stderr, file contents — **does not go through the renderer**, so it inherits nothing |
| `ToolDiffBlock` file header                                                            | `summary.file` — a path from a tool result                                                                 |
| `App.tsx` window title                                                                 | **`sessionName` interpolated INTO an OSC sequence**                                                        |

The last one is not a rendering path at all and would have been missed by looking only at
`renderMarkdown` call sites: a name containing BEL terminates the OSC early and everything after it is
read by the terminal as its own command.

## Decision

One allowlist encoder, `sanitizeTerminalText`, applied at each enumerated sink.

**Allowlist, not denylist** — everything passes except the control range, where exactly tab, newline
and carriage return survive. A denylist of known-dangerous sequences is wrong for the reason it is
wrong for shell metacharacters: the set belongs to the terminal emulator and a list written today is
incomplete the next time one adds an escape. Percent-encoded and 8-bit C1 forms fall out for free.

**Sanitize the INPUT, never the output.** The renderer ADDS ANSI — colours, bold, diff framing — so
filtering its output would strip the repository's own presentation along with the attacker's. That
ordering is the whole design, and it is asserted directly: a test renders a diff block with colour on
and requires ANSI to survive.

**An unterminated sequence swallows what follows it**, which is what a real terminal does. Keeping the
tail would print the payload's own text as content — the deceptive half of OSC 8.

## Streaming

`createStreamingTerminalSanitizer` holds an incomplete escape back until the chunk that completes it
arrives. **The TUI does not currently need it** — `tui-state-manager` accumulates each delta into a
buffer and renders the buffer, so a split sequence is already joined before `renderMarkdown` sees it,
which is stated here rather than assumed. It is provided because a caller that sanitizes per chunk
needs it, and having only the stateless function available is how that caller would get it wrong.

## Plan

- [x] `sanitize-terminal-text.ts`: stateless encoder + stateful streaming sanitizer.
- [x] Applied at all seven enumerated sinks.
- [x] `useTerminalTitle` extracted — the one place the TUI writes an escape to stdout directly.

## Test Plan

- 15 real attacks from the issue's impact list — OSC 52 (both terminators), OSC 8, OSC 0, CSI cursor,
  CSI erase, CSI private mode, DCS, APC, PM, bare ESC, bare BEL, 8-bit C1 CSI and OSC, unterminated
  OSC — each asserted to leave **no byte a terminal interprets**, checked by codepoint rather than by
  pattern.
- Bypass attempts through a markdown **code fence**, a **link target**, and a **diff block with a
  carriage return** — the three places raw text is expected to survive verbatim.
- **Every split point** of a sequence across two streaming chunks, not a sampled one.
- Ordinary Unicode (CJK, emoji, accents, typographic quotes) untouched; tab/newline/CR preserved.
- Internally generated ANSI survives, which is the ordering assertion.
- **Three mutants killed, each confirmed applied before its result was read:** encoder made identity →
  **39 red**; streaming holds nothing back → **15 red**; `renderMarkdown` stops sanitizing → **3 red**;
  restored → **43 green**.
- `agent-transport-tui` 619 tests, lint clean, `pnpm harness:scan` 141 passed / 0 failed.

## Baseline regeneration, reported rather than passed silently

Extracting `useTerminalTitle` shrank `App.tsx` below its frozen size, which requires
`--write-baseline` in the same change. The regeneration absorbed **exactly one entry**:
`packages/agent-transport-tui/src/App.tsx` 605 → 602. No other line changed.

## User Execution Test Scenarios

**Not applicable, and the reason is the finding.** Executing one means rendering a document containing
OSC 52 in a real terminal. On the fixed build nothing happens — but demonstrating it WAS exploitable
means running the vulnerable code, and a scenario whose negative case overwrites the user's clipboard
or rewrites their screen is not one to hand a user. The property is asserted at the encoder, where the
payload is observable as data with nothing written to a terminal — which is also how the issue's own
reproduction was done.
