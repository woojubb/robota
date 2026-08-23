---
title: 'SEC-019: model and tool output can inject terminal control sequences'
issue: https://github.com/woojubb/robota/issues/2022
status: done
completed: 2026-08-23
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

## What a terminal actually receives, measured

The first version of this record asserted that Ink passes control sequences through. That is false,
and it was measured rather than reasoned about — rendered through real Ink into a stream that claims
to be a tty:

|                          |                                                                                     |
| ------------------------ | ----------------------------------------------------------------------------------- |
| **stripped by Ink**      | OSC 52 clipboard, OSC 0 title, CSI erase / cursor / alt-screen, DCS, APC, 8-bit CSI |
| **reaches the terminal** | SGR colour, OSC 8 hyperlink, a bare carriage return                                 |

So the live attack through `<Text>` is narrower than first stated and entirely real: a link whose
visible text and target differ, and a `\r` that overwrites the line the transcript just printed.
`useTerminalTitle` writes to stdout directly and is subject to none of Ink's filtering.

The sanitizer covers the whole class anyway, and the measurement is the argument FOR that: Ink's
removal is incidental — it falls out of slicing text for layout, it is in no contract of Ink's, and a
dependency upgrade returns the class without a line changing here.

A bare CR was therefore a defect in the sanitizer itself, not in the code it guards. `\r\n` is
normalized to a newline first, so a document written on Windows keeps its line structure and loses
only the overwrite primitive.

## User Execution Test Scenarios

**Scenario 1 — a hostile session name cannot act on the terminal through the window title.**

This is the sink no audit of the renderer would have found: the session name is interpolated INTO an
OSC sequence rather than rendered as content, and `useTerminalTitle` writes it to stdout without
passing through Ink at all. It is also the one scenario that is safe to hand a user, because the
payload's negative case sets a window title rather than writing their clipboard.

Prerequisites: a POSIX shell with `script`, a configured provider profile in `~/.robota/settings.json`
(any profile — no request is made), and a seeded session record. No network and no API key are used.

```
mkdir -p ~/.robota/sessions
node -e 'const fs=require("fs"),E="\x1b",B="\x07",n=new Date().toISOString();
fs.writeFileSync(process.env.HOME+"/.robota/sessions/sec019demo.json",JSON.stringify({
  id:"sec019demo",name:"demo"+B+E+"]52;c;UFdOQ0xJUA=="+B+"tail",cwd:process.cwd(),
  createdAt:n,updatedAt:n,messages:[]},null,2))'
script -q -c "robota --resume sec019demo" /tmp/sec019.raw < /dev/null
grep -c $'\x1b]52' /tmp/sec019.raw
```

The name carries a BEL — which would terminate the title's own OSC early — followed by an OSC 52
clipboard write.

Expected observable result: the capture contains the title writes and no clipboard sequence. On the
vulnerable build the name is interpolated verbatim, so the BEL closes the title and the OSC 52 that
follows is delivered to the terminal as a command.

**Evidence — executed 2026-08-23 against the merged build, captured in a real pty:**

```
name written:  "demo\u0007\u001b]52;c;UFdOQ0xJUA==\u0007tail"

window-title writes observed in the byte stream:
  "\u001b]0;Robota\u0007"
  "\u001b]0;Robota — demotail\u0007"

clipboard payload UFdOQ0xJUA== present : false
OSC 52 introducer present              : false
```

The title is one well-formed sequence, the BEL and the clipboard write are gone, and the name's safe
characters survive as `demotail`. Observed matches expected.

**Scenario 2 — a poisoned transcript, NOT executed, and why.**

Seeding an assistant message containing an OSC 8 link and a bare CR and resuming the session was
attempted. `--resume` restores the conversation into context but the run captured did not re-render
the transcript, so the assistant text never reached the frame — which means a "no payload found"
result would have been evidence of nothing at all. Recorded as attempted-and-inconclusive rather than
counted, because a scenario that does not exercise the path is green for the same reason a correct
one is. The rendering path is covered instead by `sec-019-tool-label-render.test.ts(x)`, which drives
the real components through real Ink into a captured tty stream and requires an unsanitized render to
leak.
