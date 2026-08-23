---
status: approved
type: SECURITY
tags: [security]
---

# SEC-019: model and tool output can inject terminal control sequences

Paired with `.agents/tasks/SEC-019-untrusted-text-can-act-on-the-terminal.md`.
Converted from [issue #2022](https://github.com/woojubb/robota/issues/2022).

## Problem

See the paired Task for the enumerated sinks. In short: Ink passes terminal control sequences through,
and seven paths carry untrusted text to it.

## Prior Art Research

Waived: the design question is which boundary in this repository owns terminal encoding, and the
repository has answered the analogous question twice this week — SEC-006/SEC-017 for shell syntax
(`build-invocation.ts`, `plugin git execution`) and SEC-018 for path components. The shared conclusion
is the one applied here: **remove the interpreter's syntax from untrusted values at one boundary, with
an allowlist, rather than escaping at each sink**. Recorded rather than left empty, per
[research.md](../../rules/research.md).

## Architecture Review

**Alternatives.**

1. **Escape at each `<Text>` site.** Rejected: seven sinks today and no mechanism keeping a new one
   from being added unguarded — which is precisely the defect SEC-018 hit five times.
2. **Filter the RENDERED output.** Rejected on a property, not a preference: the renderer adds ANSI,
   so filtering its output strips the repository's own colours and diff framing. Asserted directly by
   a test that renders a coloured diff and requires ANSI to survive — that test goes red if anyone
   moves the call.
3. **Denylist the known-dangerous sequences (OSC 52, OSC 8, …).** Rejected: the set belongs to the
   terminal emulator and grows without us. An allowlist over the control range is complete by
   construction and gets percent-encoded and 8-bit C1 forms for free.
4. **Allowlist encoder at the enumerated boundaries.** Chosen.

**Enumeration first.** The sink list was built by enumerating what reaches a terminal, not by following
the issue's evidence links. That found `App.tsx`'s window-title write — a value interpolated INTO an
OSC sequence, not rendered as content, and invisible to anyone auditing `renderMarkdown` call sites.
SEC-018's five rounds are the reason this step was done explicitly.

**Capability preservation.** Tab, newline and carriage return survive; ordinary Unicode is untouched,
including CJK, emoji and typographic punctuation. The goal is to remove what the TERMINAL acts on, not
to restrict what a document may say.

**Streaming.** The stateful sanitizer exists and the TUI does not currently need it — the state manager
accumulates deltas before rendering. That is stated in the module rather than left for a reader to
infer, because "we have a stateful sanitizer" and "the streaming path is stateful" are different
claims and only the first is true here.

## Completion Criteria

- **TC-01** Every enumerated sink sanitizes; the list is enumerated rather than sampled.
- **TC-02** OSC 52/8/0, CSI cursor and erase, DCS/APC/PM, bare ESC/BEL and 8-bit C1 are neutralized.
- **TC-03** Sanitization cannot be bypassed via code fence, link target, diff block or carriage return.
- **TC-04** Every split point of a sequence across streaming chunks is covered.
- **TC-05** Internally generated ANSI still renders.
- **TC-06** Ordinary Unicode and tab/newline/CR are preserved.
- **TC-07** Three mutants die; suite green restored.
- **TC-08** Baseline regeneration reports exactly what it absorbed.

## Test Plan

See the paired Task. TC-05 is the one that fails if the encoder is ever moved to the output, and TC-04
is the acceptance test the issue names explicitly.

## Evidence Log

| Claim                                                        | Verified at                                                                                                                                                                                                                                                                                                                 |
| ------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GATE-APPROVAL                                                | Standing owner instruction, current conversation: decide by the repository's rules, escalate only what they cannot settle. A filed P1 security issue with stated acceptance criteria and two in-repo precedents (SEC-017, SEC-018) for the design. No product-direction or published-contract-removal decision is involved. |
| Ink passes control sequences through                         | the sinks render `{value}` directly into `<Text>` with no encoder                                                                                                                                                                                                                                                           |
| The window title interpolates an untrusted name into an OSC  | `App.tsx` pre-change: ``process.stdout.write(`\x1b]0;${title}\x07`)`` where `title` embeds `sessionName`                                                                                                                                                                                                                    |
| The error block does not inherit the renderer's sanitization | `ErrorEntryBlock` renders `message.content` into `<Text>` without `renderMarkdown`                                                                                                                                                                                                                                          |
| The stream path accumulates before rendering                 | `tui-state-manager`: `this.streamBuf += delta; this.streamingText = this.streamBuf`                                                                                                                                                                                                                                         |
| Every split point is covered                                 | the streaming suite parametrizes over all `PAYLOAD.length - 1` boundaries                                                                                                                                                                                                                                                   |
| Mutants die                                                  | encoder → identity: 39 red; streaming holds nothing: 15 red; renderer stops sanitizing: 3 red; restored 43 green                                                                                                                                                                                                            |
| The baseline absorbed one entry                              | `App.tsx` 605 → 602; no other line changed                                                                                                                                                                                                                                                                                  |

## User Execution Test Scenarios

**Not applicable.** Executing one means rendering a document containing OSC 52 in a real terminal. On
the fixed build nothing happens; demonstrating it WAS exploitable requires running the vulnerable code,
and a scenario whose negative case overwrites the user's clipboard or rewrites their screen is not one
to hand a user. The property is asserted at the encoder, where the payload is observable as data with
nothing written to a terminal — which is how the issue's own reproduction was done.
