---
status: in-progress
type: SCREEN
tags: [screen]
lane: L2
---

# SCREEN-2670: Queue screen-reader frames with a pre-write cursor park

Paired with `.agents/tasks/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md`. Arising from [issue #2670](https://github.com/woojubb/robota/issues/2670).

> **On the title.** "cursor park" is the framing the issue mapping gave this Task ID, and both
> filenames are its address — cited by the merged mapping commit and by the umbrella issue, so they
> are not renamed here. The mechanism this spec decides on parks in TIME and writes no cursor
> sequence at all (§ Decision). Where the two disagree, § Decision is what ships.

## Problem

`CLI-2004` § Decision verdict (i) adopted TWO pacing waits for screen-reader mode. One shipped — the
startup quiet period. The other, the pre-write park, did not, and `ROBOTA_SCREEN_READER_PREPARK_MS`
is not read anywhere.

**Reproduction.** Run the TUI in screen-reader mode with a reader attached
(`ROBOTA_SCREEN_READER=1 pnpm exec robota`) and submit a prompt. Every changed frame is written by
Ink's own loop, synchronously and — in this mode specifically — with the render throttle
DISABLED (`ink.js:193-199`), so commits are not even spaced by a frame interval. A reader that computes what to speak by differencing
successive terminal snapshots gets frames back to back with no separation, and a changed line that
shares a prefix with the line it replaced is announced as a mid-line patch rather than as a new line.

**Why it was deferred rather than botched.** `src/screen-reader-pacing.ts` states it: "there is no
honest place to put it: every transcript line is written by Ink's own frame loop, which writes
synchronously. Wrapping that write with a delay means either blocking the event loop or reordering
frames. Rather than ship a documented tunable that silently does nothing, the variable is not read at
all." The same refusal is recorded in `docs/SPEC.md` § Known limitations and in the spec's § Solution 12. This item is that deferred half, taken on its own terms — and the thing it must not do is ship
the variable again without the write path that makes it real.

## Prior Art Research

| #   | Source                                                                                                                                                                                                             | Type          |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ------------- |
| R1  | Claude Code — [Use Claude Code with a screen reader](https://code.claude.com/docs/en/accessibility)                                                                                                                | Product doc   |
| R2  | Claude Code — [environment variables](https://code.claude.com/docs/en/env-vars)                                                                                                                                    | Product doc   |
| R3  | Gemini CLI — [configuration / CLI options](https://google-gemini.github.io/gemini-cli/docs/get-started/configuration.html)                                                                                         | Product doc   |
| R4  | Ink — [readme: screen-reader support, `render` options](https://github.com/vadimdemedes/ink/blob/master/readme.md)                                                                                                 | Library doc   |
| R5  | NVDA 2026.1.1 User Guide — Advanced settings (Diff algorithm, Windows Console support), Object Presentation, Braille ([nvaccess.org](https://download.nvaccess.org/documentation/userGuide.html))                  | AT vendor doc |
| R6  | Apple — [macOS accessibility in Terminal](https://support.apple.com/guide/terminal/trml1020/mac)                                                                                                                   | AT vendor doc |
| R7  | Freedom Scientific — JAWS Screen Echo ([doccenter.freedomscientific.com](https://doccenter.freedomscientific.com/doccenter/doccenter/rs11f929e9c511/2015-02-10_teacherstrainers-l3/02_ChangingSettingsInJAWS.htm)) | AT vendor doc |
| R8  | GNOME Orca — [introduction / flat review](https://help.gnome.org/users/orca/stable/introduction.html.en)                                                                                                           | AT vendor doc |

**One product documents this mechanism, and it matches the proposal exactly.** R1: "Before Claude
Code writes a new or changed line … it moves the cursor to the start of the line and waits 50
milliseconds." R2 names `CLAUDE_AX_PREPARK_MS`, default `50`, `0` to write immediately, capped at
`5000` — the same knob, default and bound verdict (i) adopted. R1 carries two companions: the park
applies only to CHANGED content, and **the input echo is exempt** — "Characters you type or delete at
the end of the input line appear immediately." Gemini CLI documents `--screen-reader` with no timing
or cursor semantics at all (R3). Ink's own screen-reader support is output SHAPING — an ARIA subset —
and documents no timing hook (R4).

**No assistive-technology vendor documents the caret as a re-announcement trigger, and the spec does
not claim it does.** What the vendors document is DIFFING. NVDA determines new terminal text by
differencing rendered snapshots (R5, "Diff algorithm"), and its line-based algorithm is documented to
misbehave on mid-line edits: "when inserting or deleting a character in the middle of a line, the text
after the caret will be read out"; its character-based algorithm can make reading "choppy or
inconsistent". Apple documents only that VoiceOver can speak Terminal text (R6); JAWS exposes Screen
Echo as a user-side gate (R7); Orca documents flat review (R8). None describes an application-side
protocol.

So the rationale this spec adopts is the one the evidence supports: **write each changed frame whole,
from column zero, separated in time, so a diff-based reader computes a line-granular delta** — not
"moving the caret makes the reader re-read." Two facts of this renderer make that shape available for
free: Ink's `incrementalRendering` defaults to `false` and this repository passes no override, so
every dynamic write IS a full redraw rather than a mid-line patch. (Round 2 listed a second fact
here — `maxFps` defaulting to 30 — which is NOT available in this mode: `ink.js:193` makes
screen-reader mode `unthrottled`, so the 30 fps default never applies to the runs this spec is
about. The full-redraw fact stands on its own and is the one the shape rests on.)

**No external convention exists for the delay magnitude.** The millisecond values in AT documentation
are AT-side and tunable by the reader's user — NVDA's "Caret move timeout" is how long NVDA waits, not
guidance to applications (R5). The only application-side numbers are Claude Code's own, asserted
without derivation (R2). This package has already ruled on that question once, for the adjacent knob:
`ROBOTA_SCREEN_READER_STARTUP_QUIET_MS` is `900`, not the reference's `3000`, because "the default is
measured against THIS render loop, not copied." The same rule is applied below.

**Hazards the vendor documentation names, each answered in § Decision.** A tethered braille display
follows the caret and NVDA interrupts speech while scrolling (R5) — parking before EVERY frame drags
it to line start, which is why the input-echo exemption is adopted rather than treated as a nicety,
and why `0` is a real bypass. Contiguous spans over 1,000 characters may not be reported accurately on
NVDA's UIA path (R5) — pacing cannot be the only thing carrying a long tool output. Typed characters
that are not displayed, such as passwords, are reported on that path (R5) — masked input must never
be routed through a paced write. And a park in front of an UNCHANGED frame is silent rather than
duplicative, which follows from the diff model rather than from any vendor statement.

## Architecture Review

### Affected Scope

- `packages/agent-ui-terminal` — the render call site, a new owned stdout proxy, the pacing resolver,
  and this package's SPEC.

### Alternatives Considered

1. Sleep synchronously before each write, inside the existing write path.
   - Pro: a few lines; no new object; the ordering question does not arise.
   - Con: blocks the event loop for the whole park. Keystrokes, timers, the stream that is producing
     the assistant's reply and the countdown all stop. This is the option `screen-reader-pacing.ts`
     already refused by name, and refusing it again is not new information.
2. Patch or fork Ink's frame loop so the delay lives where the frame is composed.
   - Pro: exact knowledge of what changed — the park could be applied per changed LINE rather than
     per frame.
   - Con: forking a dependency's render loop for one behaviour, and owning that fork across Ink
     upgrades, when Ink already publishes the seam this needs. The precision is also not usable:
     `incrementalRendering` is off, so a frame IS the unit that gets written.
3. **An owned stdout proxy with a bounded FIFO queue in front of the real stream, passed to Ink's
   documented `stdout` render option.**
   - Pro: uses the extension point Ink declares (`stdout?: NodeJS.WriteStream`, `render.d.ts:62`),
     and is the exact counterpart of the `stdin` proxy this same call site already owns
     (`render.tsx:377`, `attention/focus-input-filter.ts:122`). Frames stay in order because the
     queue is the only writer. Nothing blocks.
   - Con: the proxy must reproduce every member Ink touches on a `WriteStream`, and a queue between
     Ink and the terminal is a new place for output to be lost on teardown.
4. Keep the limitation and close the item as wontfix.
   - Pro: zero risk to a mode that otherwise works.
   - Con: verdict (i) stays half-shipped, and the gap is in an ACCESSIBILITY feature — the users who
     need it are the ones who cannot route around it.

### Decision

**Alternative 3** as the direction — own the write path through Ink's documented `stdout` option —
with the mechanism rewritten after review round 1 against what Ink actually writes.

**Delivery mode:** `single`

One pull request: every seam in § Solution lands together, because the echo exemption is part of the park's own contract (§ Decision, "On the split") and shipping the park without it would delay every keystroke for the users of an accessibility mode.

**The unit is a COMMIT, not a chunk.** In screen-reader mode Ink issues up to four separate
`stdout.write()` calls for one commit (`ink.js:371-412`): the synchronized-output begin, an
`erase + staticOutput` when `<Static>` has new children — which this package does have
(`AppPresentation.tsx:29`) — the `erase + wrappedOutput` frame, and the synchronized-output end.
They are emitted in one straight-line synchronous run. A park per CHUNK would pay the interval three
times per frame, split the synchronized-output window, and leave an erased region on screen for the
whole interval between `erase + staticOutput` and the frame — a diff-based reader would then snapshot
the torn state, which is worse for the exact user this exists for. So the queue batches the chunks
emitted in one synchronous run, parks ONCE in front of the batch, and releases the batch contiguously.

**No carriage return is injected.** `ansiEscapes.eraseLines(n)` terminates with `cursorLeft`
(`ESC[G`), so for every frame after the first the cursor is already at column zero when the frame's
first byte lands. The rationale this spec adopts is time separation, not caret position — an injected
CR would buy nothing the frame does not already carry, while being exactly the out-of-band cursor
write CLI-062 invariant I3 forbids. Dropping it removes that conflict at zero cost.

**The echo signal comes from the render layer, which owns it.** A composer keystroke is known where
the keystroke is handled, not in a byte stream. Deriving it back out of ANSI-styled, hard-wrapped
frame text would be a proxy for a fact the App already has, and it would be wrong three ways that
were measured in review: the trailing lines of a frame are the STATUS BAR, not the composer
(`AppPresentation.tsx:123-145` renders `SessionStatusBar` after `InputArea`); the composer's height
is not fixed (`InputArea.tsx:247-309` conditionally renders the autocomplete, the history overlay, a
pending-prompt block and the key-hint footer, and the input hard-wraps); and a transcript line does
not ride the frame at all — it arrives as Ink's separate `<Static>` chunk. So the signal comes from
the App, and there is no `isEchoOnlyChange` predicate.

**That signal is scoped to one turn of the event loop, not to "the next batch".** Review round 2
raised that a fire-and-forget token does not correlate to a commit: a token with no commit behind it
un-parks whatever arrives next, and several tokens in one window leave a surplus that un-parks later
transcript batches. The objection is right. The mechanism it was argued from is not — it rests on
Ink's render throttle, and THIS mode is the one mode that has none: `ink.js:193-199` sets
`unthrottled = options.debug || isScreenReaderEnabled`, so `renderThrottleMs` is 0 and
`rootNode.onRender` is the raw callback rather than a throttled one. One React commit is one
`onRender` is one batch, with no window in which a keystroke and a streaming token could collapse
into a shared batch.

The correlation requirement survives the loss of its stated cause, so it is met directly — by a
BOOLEAN with three properties the spec fixes here, because round 3 showed that leaving any of them to
the implementation gives opposite behaviours.

**Consumed at batch FORMATION, carried on the batch.** The flag is read when a batch OPENS and
stamped onto it; the release path then reads the batch, never live state. Reading it at release would
break the mechanism in the one flow it exists for: with no throttle a streaming reply commits per
token with nothing spacing the commits, so the queue is saturated for the whole reply — which is
exactly when a user types a follow-up, a flow this composer supports (`InputArea.tsx:268-278` renders
the queued-prompt block). A keystroke batch waiting behind a parked batch would lose the flag before
it was ever considered.

**Armed only by keys that mutate composer TEXT.** Submit runs through the same key path
(`CjkTextInput.tsx:192`, `action === 'submit' || action === 'execute'` → `key.return`, with
`onSubmit` fired from that handler at `:82,106`), and submitting appends the user's prompt line to
the transcript. Arming on every composer key would therefore exempt the first transcript line of
EVERY turn — the per-turn norm, not a corner, and precisely the content the park exists to pace. So
submit, execute, history navigation and slash-command execution do not arm; text insertion and
deletion do. A second mechanism reinforces this and is named here so a change to it cannot widen the
residual silently: CLI-061's deferred submit (`CjkTextInput.tsx:95-98`) means Enter does not submit
synchronously — it schedules a timer so a trailing IME character arriving in the NEXT stdin event is
folded in — so an IME character that armed the flag has already expired by the time the submit commit
is written. The arming rule does not depend on that, but the two together are why the IME sequence is
closed rather than merely unlikely. The single-chunk case (a pasted `"hello\n"`, or a tty read
delivering `ab\r`, where submit resolves without the defer path) is the mixed-commit residual named
below, not a separate hole.

**Expiry, and what happens when it wins.** The batch closes on `process.nextTick` and the flag
expires on `setImmediate`, so the nextTick queue always drains before the check phase and a batch
opened in the armed turn always closes first. If a commit nonetheless lands in a later macrotask than
the expiry, the flag is already gone and the batch is PARKED: the exemption MISSES, which costs one
interval of latency, and it can never mis-release a transcript batch. Failing toward parking is the
right direction, but "silently never fires" is this item's own failure mode, so it is not left to
argument — TC-03 proves the exemption fires through the real render path rather than against a fake,
and TC-09 proves it end-to-end in a PTY.

**Why not an epoch counter.** A counter over non-composer changes does carry one thing the boolean
cannot: it would tell a commit holding composer changes ALONE from one holding a composer change AND
something else, closing the mixed-commit residual that the scoping rule above narrows but does not
eliminate. That residual is accepted because it is bounded to one transcript line and fails by
un-parking rather than by delaying a keystroke. The expiry is required in either shape and is what
fixes the stale arm, so the boolean is the smaller mechanism for the same guarantee — not a mechanism
that knows as much.

**Dropping is never silent.** The queue coalesces only SUPERSEDED FRAME batches. A chunk that carries
a write callback, and the empty-string barrier Ink writes to settle `waitUntilExit()` and
`waitUntilRenderFlush()` (`ink.js:588`, `ink.js:647`), are never coalesced away — and every dropped
chunk's callback is still settled. Without this the exit promise never resolves and the TUI hangs, or
the final frame of a session is the one that gets lost.

**A batch with nothing readable in it is not worth a park.** Ink's empty-string barrier arrives in
its own synchronous run, and the OSC 133 marks are emitted from a passive effect — after the commit's
writes — so each forms a batch of its own. Parking them buys a reader nothing and costs the interval
every time: four marks a turn at the 250 ms the PTY scenario uses is a second of injected latency per
turn, and the barrier pays it on the way out. So a batch carrying no printable content adds no park
of its own. It still queues BEHIND anything already pending, so FIFO order — and with it the
positional guarantee the marks need — is untouched; only the dead delay is removed.

**The OSC 133 turn marks join the owned writer.** `terminal-marks.ts:55` writes to `process.stdout`
directly, from a `useEffect` during the session (`hooks/useScreenReaderTurnSignals.ts:62-76`). OSC 133
marks are POSITIONAL by protocol — the terminal records the line the mark arrives on, which is what
makes prompt-to-prompt navigation work. A mark that lands between a parked batch and its release
would be recorded on the wrong line, silently degrading a screen-reader navigation feature CLI-2004
shipped for these same users. They are correct today and become wrong only because this change
introduces a queue, so they are this change's to fix.

**The default is provisional and labelled as such.** The park's purpose is to let a diff-based
reader's snapshot fall between two commits, so the governing timescale is the READER's sampling
cadence — which no vendor documents (§ Prior Art finding 3) and which this harness cannot measure,
because no screen reader is reachable from it. Round 1 derived the value from "half a frame of
margin" and round 2 from "the smallest round value above the frame interval". Both were a free
parameter wearing a derivation, and the second is not even available: screen-reader mode runs Ink
UNTHROTTLED (`ink.js:193-199`), so there is no frame interval to sit above and no floor to round up
from. Nothing in this loop selects a number.

The default is therefore **50 ms, taken provisionally to MATCH the sole product precedent (R2)** —
which is a weaker claim than a derivation, and the true one. It is recorded as PROVISIONAL, with
"measure the park against a real reader and re-derive the default" named as an open item in this
package's SPEC. CLI-2004 verdict (i) adopted "R1's caps with Robota-measured defaults", and the
measurement that made the adjacent knob 900 instead of the reference's 3000 is exactly what is
unavailable here — which is what the label records rather than papers over. The bound is **5000 ms**, matching the precedent,
which verdict (i) adopted explicitly. `0` is honoured exactly and disables the park.

**Reachability.** Every seam is live. `render()` is called once (`render.tsx:351`) and already
receives a proxy through the sibling `stdin` option; `resolvePacing` is already called at startup and
already returns a resolved object the render path reads; `docs/SPEC.md` § Pacing already has the
table this adds a row to, and § Known limitations already has the paragraph this replaces.

**Capability preservation.** Mode off ⇒ no proxy is constructed and `stdout` is not passed at all, so
Ink defaults to `process.stdout` and keys its instance map by that same object (`ink.js:565`) exactly
as today; TC-05 pins the absence rather than an output snapshot, because a snapshot cannot tell a
transparent proxy from the real stream. CLI-062 invariant I3 is preserved LITERALLY, not in
substance: this change writes no cursor sequence of its own.

**Adversarial pass.** Teardown: Ink flushes its final throttled frame only while it believes the
stream is writable (`ink.js:118`), so the proxy reads `writable`/`destroyed`/`writableEnded` through
from the real stream, and `render.tsx` awaits the queue's drain before the terminal is restored.
Backpressure: `write` returns the underlying boolean and `writableLength` reads through, so Ink's
`hasWritableState` probe sees the real stream. Identity: the proxy is one stable object for the
session, because Ink uses it as a Map key. Resize: `on`/`off` delegate, or Ink never learns the new
size. Masked input: this package renders no masked field today; that is recorded as a note with the
rule attached (a masked field must not be routed through a paced write, R5) rather than as a
completion criterion, because a repo scan asserting an absence can only measure its own vocabulary.

**Independent review record.** `proposal-reviewer`, four rounds against the live source (2026-09-19 → 2026-09-20): rounds 1–3 `REVIEW VERDICT: REVISE` (7, 6, 6 findings), round 4 `REVIEW VERDICT: ENDORSE`, `ACTIONABLE FINDINGS: 0`. Ledger: `.agents/loop-runs/backlog-execution-orchestrator.jsonl` run `r20260919193659`, `roundFindings: [7, 6, 6, 0]`, closed `converged`. Round 2's finding 1 rested on a misread of Ink's throttle that round 3 withdrew; the correlation requirement it pointed at survived for a different reason and is what § Decision records.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — the `stdin` proxy at the same `render()` call site
      (`attention/focus-input-filter.ts`, `TInkStdinSurface` + `asInkStdin()`) is the precedent this
      mirrors; `screen-reader-pacing.ts` already owns resolver shape, clamping and refusal reporting;
      all five non-Ink stdout writers were read. Four (`screen-reader-announcement.ts`,
      `attention-bell.ts`, `use-terminal-title.ts`, `terminal-focus-reporting.ts`) are pre-Ink or
      position-neutral and stay as they are; `terminal-marks.ts` is NOT position-neutral and DOES
      join the queue, for the reason § Decision gives.
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료
- [x] New-surface placement: **N/A** — no new package, app, presentation or interface surface, and
      no layer or product-family reclassification. One module inside the package that already owns
      the render call.

## Fallback & Degradation Declaration

- Screen-reader mode off: no proxy is constructed and `stdout` is not passed to `render()` at all;
  Ink defaults to `process.stdout` and the output is byte-identical to today's.
- The first batch of a session is released without a park: there is no earlier commit for a reader to separate it from.
- `ROBOTA_SCREEN_READER_PREPARK_MS=0`: the park is disabled exactly. Batches are released in order
  with no delay. This is the documented bypass for a braille user who does not want commits paced.
- An unparseable or negative value: refused with a note on stderr and the default stands — the
  existing `resolveDuration` discipline, never a silent substitution.
- A value above the bound: clamped AND reported.
- Commits arriving faster than the park drains: the queue keeps the newest pending FRAME batch and
  drops the superseded one, because a superseded full redraw has no reader value and an unbounded
  queue is a memory leak on a fast stream. A batch carrying a write callback, and Ink's empty-string
  barrier writes, are never coalesced away, and every dropped chunk's callback is still settled.
- A batch with no printable content in it (the barrier, an OSC 133 mark, a bare control sequence) is
  released without a park of its own, still in queue order.

## Solution

1. `packages/agent-ui-terminal/src/screen-reader-pacing.ts`: add `PREPARK_ENV =
'ROBOTA_SCREEN_READER_PREPARK_MS'`, `DEFAULT_PREPARK_MS = 50` and `PREPARK_MS_MAX = 5000`, and
   return `preparkMs` from `resolvePacing` beside `startupQuietMs`, through the same
   `resolveDuration` discipline. Replace the header paragraph that explains the park's absence with
   what it now does, the line-granularity rationale, and the PROVISIONAL label on the default.
2. `packages/agent-ui-terminal/src/screen-reader-stdout.ts` (new): `createParkedStdout({ stdout,
preparkMs })` returning the proxy, an `armEchoRelease()` port and `flush()`. A `TInkStdoutSurface`
   type names exactly the members Ink 7.1.1 touches — `write`, `columns`, `rows`, `isTTY`, `on`,
   `off`, `destroyed`, `writable`, `writableEnded`, `writableLength` — and `asInkStdout()` narrows
   through it, mirroring `asInkStdin()`. `_writableState` is satisfied transitively by
   `writableLength`, which is stated in the type's docblock rather than left to chance.
3. `screen-reader-stdout.ts`: the batching rule. Chunks written in one synchronous run form one
   batch; the batch is parked once and released contiguously. A batch adds no park of its own when it
   is the first of the session, when `preparkMs` is 0, when it carries no printable content, or when
   it was STAMPED with the echo flag as it opened — and an unparked batch still leaves in queue
   order, behind anything already pending. The flag is read at batch formation and carried on the
   batch, never re-read at release, so a keystroke batch queued behind a parked one keeps its
   exemption. A batch opens on the first write of a synchronous run and closes on `process.nextTick`;
   `armEchoRelease()` sets the flag and schedules a `setImmediate` that clears it whether or not a
   batch consumed it. nextTick drains before the check phase, so a batch opened in the armed turn
   always closes before the expiry; if a commit lands later than the expiry the batch is simply
   parked, which is a missed exemption and never a mis-release. Callback-bearing and empty-string barrier chunks
   are never coalesced, and a dropped chunk's callback is settled with the result the release would
   have given it.
4. `packages/agent-ui-terminal/src/terminal-marks.ts` and `src/hooks/useScreenReaderTurnSignals.ts`:
   take the sink to write to rather than reaching for `process.stdout`, so the OSC 133 marks travel
   through the same ordered writer and are recorded on the line they belong to.
5. `packages/agent-ui-terminal/src/screen-reader-pacing-context.tsx` (new),
   `src/CjkTextInput.tsx` and `src/render.tsx`: publish the `armEchoRelease` port through a CONTEXT
   from `render.tsx`, mirroring
   `screen-reader-context.tsx` — "no component takes the mode as a prop from its parent — it reads it
   here — so a missed prop cannot silently leave one component in the wrong mode". A live writer
   handle is the same kind of fact, and a context is also what keeps it out of the prop chain it
   would otherwise have to travel: `IAppViewModel.input` → `AppView` → `AppPresentation` →
   `PromptAndStatus`, through a file that declares itself a pure presentation tree receiving no
   channel, session, registry or mutable state (`AppPresentation.tsx:147`). The composer's key
   handler lives in `CjkTextInput.tsx`, which is where the port is read and where the
   text-mutating-keys-only rule is applied — the same handler that returns `key.return` for
   `submit`/`execute` (`:192`) must NOT arm on that branch. Outside a provider the port is a no-op,
   so every existing test renders unchanged.
6. `packages/agent-ui-terminal/src/render.tsx`: construct the proxy only when `screenReader` is true
   and `preparkMs > 0`, pass `stdout: parked.asInkStdout()` beside the existing `stdin`, give
   `terminal-marks` the same sink, and await `parked.flush()` inside the existing `finally` before
   the terminal is restored.
7. `packages/agent-ui-terminal/docs/SPEC.md`: add the row to § Pacing, REPLACE the "The pre-write
   park is not shipped" paragraph under Known limitations with what shipped and its rationale, and
   record the open item — measure the park against a real reader and re-derive the default.
8. `packages/agent-cli/src/utils/cli-help.ts` and `packages/agent-cli/README.md`: document the
   variable where the startup-quiet one is already documented.

## Affected Files

- `packages/agent-ui-terminal/src/screen-reader-pacing.ts`
- `packages/agent-ui-terminal/src/screen-reader-stdout.ts` (new)
- `packages/agent-ui-terminal/src/render.tsx`
- `packages/agent-ui-terminal/src/terminal-marks.ts`
- `packages/agent-ui-terminal/src/hooks/useScreenReaderTurnSignals.ts`
- `packages/agent-ui-terminal/src/screen-reader-pacing-context.tsx` (new)
- `packages/agent-ui-terminal/src/CjkTextInput.tsx`
- `packages/agent-ui-terminal/docs/SPEC.md`
- `packages/agent-ui-terminal/src/__tests__/screen-reader-pacing.test.ts`
- `packages/agent-ui-terminal/src/__tests__/screen-reader-stdout.test.ts` (new)
- `packages/agent-ui-terminal/src/__tests__/pty/screen-2670-prepark.ptytest.ts` (new)
- `packages/agent-cli/src/utils/cli-help.ts`, `packages/agent-cli/README.md`

## Completion Criteria

- [ ] TC-01: `resolvePacing` returns `preparkMs` — absent ⇒ 50; `0` ⇒ 0 exactly; non-numeric or
      negative ⇒ 50 WITH a note naming the variable; above 5000 ⇒ 5000 WITH a note; mode off ⇒ 0
      regardless of the variable, as `startupQuietMs` already behaves.
- [ ] TC-02: the unit is a COMMIT — after a first batch has primed the proxy (the first batch of a session is released unparked, TC-11), the chunks Ink emits in one synchronous run leave the proxy
      contiguously, with the interval BEFORE the batch and none inside it. Proven against a real
      screen-reader-mode commit, so a synchronized-output pair and a `<Static>` erase are never split
      by the park.
- [ ] TC-03: the echo release — its SCOPE, its FORMATION point, and its EXPIRY. Scope: a
      text-mutating key arms the flag and a `submit`/`execute` key does NOT, so the commit that
      appends the user's own prompt line to the transcript is parked like any other. Formation: a
      batch stamped while the flag was armed keeps its exemption even when it is released later from
      behind a parked batch, which is the saturated-queue case a release-time read would break.
      Expiry: arming N times in one turn releases at most one batch, and a flag armed with no batch
      behind it is cleared, so a batch arriving in a LATER turn is still parked.
- [ ] TC-10: the exemption actually FIRES through the real render path — a keystroke driven into the
      composed render tree, not a hand-armed flag, produces an unparked batch, AND the next
      non-composer commit in the same test is parked. Both halves in one test: the positive alone
      would pass against a proxy that stamps everything, which is the opposite defect. "The exemption
      silently never fires" is this item's own failure mode applied to its own tunable, so it is
      proven rather than argued.
- [ ] TC-04: ordering, callbacks and backpressure — batches emerge in submission order under
      interleaved parked and unparked releases; every `write` callback fires exactly once, after the
      underlying write, and with the underlying error when the real stream fails; a SUPERSEDED
      batch's callbacks still settle; an empty-string barrier is never coalesced away; `write`
      returns the underlying boolean and `writableLength` reads through; and a batch with no
      printable content in it adds no park while still leaving in queue order behind a pending one.
- [ ] TC-05: with the mode OFF, `render()` is called with no `stdout` key at all — asserted on the
      options object, which is stronger than identity and equally cheap, because Ink defaults to
      `process.stdout` and keys its instance map by that object.
- [ ] TC-06: dimensions, resize and teardown — `columns`/`rows`/`isTTY` read through; a `resize`
      listener registered by Ink reaches the real stream; the proxy is one stable object for the
      session; `flush()` resolves only after the queue is empty, and the last frame of a session
      survives teardown.
- [ ] TC-07: the OSC 133 turn marks travel through the owned writer and are ordered with the batch
      they belong to, rather than reaching `process.stdout` while a batch is parked — and, being
      control-only, they are not themselves delayed by the interval.
- [ ] TC-11: the first batch of a session is released with no park, so startup output is not delayed by an interval that separates nothing; the second batch IS parked.
- [ ] TC-08: engineering verification — build, test and typecheck for the affected packages exit 0;
      `pnpm harness:scan` is green; the lint-warning ceiling holds.
- [ ] TC-09: the built binary in a PTY — with the mode on and a long interval, each transcript commit
      is preceded by the delay, the chunks WITHIN a commit are contiguous with no interval between
      the synchronized-output begin and its frame, a composer keystroke's echo is not delayed, and
      every frame chunk, mark and cursor-control sequence stays in order. With the interval 0 no
      delay is injected; with the mode off the byte stream is identical to the pre-change binary. The
      existing screen-reader, scrollback, fallback-render, terminal-capability and IME PTY suites stay
      green, CLI-062's cursor order included.

## Test Plan

| TC-ID | Test Type                 | Tool / Approach                                                           | Notes                                                            |
| ----- | ------------------------- | ------------------------------------------------------------------------- | ---------------------------------------------------------------- |
| TC-01 | Unit                      | Vitest over `resolvePacing` with an injected env and warn sink            | The existing resolver's table, one row wider                     |
| TC-02 | Unit / fake timers        | Vitest replaying a captured screen-reader commit through the proxy        | Contiguity within the batch is the assertion                     |
| TC-03 | Unit / fake timers        | Vitest over the key handler's arming rule AND the proxy's flag directly   | Submit/execute must not arm; formation stamping; expiry          |
| TC-10 | Integration / ink-testing | Vitest driving a keystroke through the composed tree into the proxy       | Proves the exemption fires rather than silently never firing     |
| TC-04 | Unit / fake timers        | Vitest with an underlying stream that fails on demand                     | Order, callbacks, errors, backpressure, dropped-batch settlement |
| TC-05 | Unit                      | Vitest asserting `stdout` is absent from the options handed to `render()` | An output snapshot cannot tell a transparent proxy apart         |
| TC-06 | Unit                      | Vitest over the delegating members, identity and `flush()`                | The teardown case is the one that loses a frame                  |
| TC-07 | Unit                      | Vitest over the mark sink under a parked batch                            | Positional by protocol, so order is the contract                 |
| TC-11 | Unit / fake timers        | Vitest over a fresh proxy: first batch unparked, second parked            | The priming TC-02 relies on                                      |
| TC-08 | Engineering verification  | package build/test/typecheck, `pnpm harness:scan`, `pnpm lint`            |                                                                  |
| TC-09 | Process / PTY             | Agent-controlled PTY over the built CLI with the mode on                  | The user execution scenario                                      |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: a transcript commit is paced before it is written, and a keystroke is not

- executability: agent-executable
- product surface: robota-tui
- surface rationale: shipped-entrypoint=robota
- prerequisites: affected packages are built (`pnpm build:deps`); no live credential and no external service are required — the turn is replayed from a session-log fixture through `--session-log`, the mechanism the SCREEN-006 and SCREEN-2002 scenarios already use. An isolated temporary HOME holds the fixture provider profile; the run is a 100x32 xterm-256color PTY with screen-reader mode on (`ROBOTA_SCREEN_READER=1`) and a park interval large enough to be unambiguous against the frame cadence (`ROBOTA_SCREEN_READER_PREPARK_MS=250`), driven by `src/__tests__/pty/screen-2670-prepark.ptytest.ts`
- command: `pnpm exec robota --name prepark-scenario`
- observable type: ui-state
- observable rationale: source=rendered-product-ui
- expected observable: visible=after submitting a prompt, the RAW byte stream shows each transcript COMMIT preceded by at least the configured interval, while the chunks within one commit are contiguous — the synchronized-output begin is immediately followed by its frame with no interval between them, and a `<Static>` erase is immediately followed by the frame it erased for; typing a character into the composer produces its echo with no preceding delay, so the input line is never held; the OSC 133 turn marks appear in order with the commit they belong to rather than inside a parked gap, and are not themselves delayed; the same run with `ROBOTA_SCREEN_READER_PREPARK_MS=0` injects no delay at all, and a run with the mode OFF is byte-identical to the pre-change binary
- cleanup: exit the Robota process normally with Ctrl+C and confirm it exited, then remove only the isolated HOME and project directories
- evidence: pending

## Tasks

- [ ] `.agents/tasks/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md` — todo

## Evidence Log

### [GATE-WRITE] — ❌ FAIL | 2026-09-20

**Status remains:** draft
**Failed criteria:**

- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …) — items without TC-N prefix = FAIL: 1 item(s) without a `TC-NN:` prefix: "TC-03b: the exemption actually FIRES through the r"
  **Required action:** prefix every criterion with TC-NN:
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 10 rows vs 9 TC criteria; rows without a criterion: TC-03b
  **Required action:** one row per TC-NN, same ids

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `f05926ecac6d` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/draft/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md` blob `6587f3e56a2f` (untracked)

### [GATE-WRITE] — 🔴 NON-COMPLIANCE | 2026-09-20

**Status remains:** draft
**Violation:** a recorded gate verdict was rewritten after the evaluator wrote it. The `### [GATE-WRITE] — ❌ FAIL | 2026-09-20` entry above quotes the unprefixed item as `"TC-10: the exemption actually FIRES through the r"` (49 characters). `gate-operations.mjs:712` writes exactly `missing[0].text.slice(0, 50)` — 50 characters — and a `TC-10:` item passes the `tcIdOf` check it was recorded as failing, so `gate.mjs` cannot have produced that line from that text. The only 50-character string that becomes this 49-character one under the `TC-03b → TC-10` rename is `"TC-03b: the exemption actually FIRES through the r"`: the rename was applied across the file, including the Evidence Log, and the prior FAIL entry now asserts a finding the mechanical evaluator never made. Its `**Judged at:**` blob `6587f3e56a2f` cannot be re-derived (the document is untracked), so the altered entry is unverifiable as well as internally contradictory. The Evidence Log is the surface every later gate reads; an entry edited after the fact is not evidence.
**Required action:** restore the prior FAIL entry's quoted text to what `gate.mjs` wrote (`"TC-03b: the exemption actually FIRES through the r"`) — or, if the original bytes cannot be recovered, append a dated correction note under that entry stating that the `TC-03b → TC-10` rename touched the record, and never edit the recorded lines themselves again. Then close the coverage gap below and re-run GATE-WRITE.

**Semantic criteria as judged in this run (recorded so the re-run does not repeat the work; one is a FAIL in its own right):**

- GATE-WRITE — Contains a concrete symptom: PASS. § Problem names the unshipped half of CLI-2004 verdict (i) and the unread variable; verified — `ROBOTA_SCREEN_READER_PREPARK_MS` has zero references under `packages/agent-ui-terminal/src` and `packages/agent-cli/src`; the quoted refusal is at `screen-reader-pacing.ts:10-14` verbatim; the Known-limitations paragraph is at `docs/SPEC.md:603-607`. The wrong behaviour is stated observably (frames back to back; a prefix-sharing changed line announced as a mid-line patch).
- GATE-WRITE — Contains a reproduction condition: PASS. `ROBOTA_SCREEN_READER=1 pnpm exec robota`, submit a prompt, reader attached. The mechanism it rests on is verified against ink 7.1.1: `ink.js:193` is `const unthrottled = options.debug || this.isScreenReaderEnabled`, `:199` sets `renderThrottleMs` to 0.
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS. R1/R2 supply the 50 ms default, the 5000 ms bound, `0` as exact bypass and the input-echo exemption, each cited where the Decision adopts it; R5's diff-algorithm finding is the stated basis for the line-granular rationale AND for the explicit refusal of the "caret triggers re-announcement" claim; R5's braille and masked-input hazards produce the `0` bypass and the masked-input rule; the "measured, not copied" precedent is verified at `screen-reader-pacing.ts:29` (`DEFAULT_STARTUP_QUIET_MS = 900`). Nothing in the Decision is asserted without a finding behind it.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS. Alternative 3's own cons (reproduce every `WriteStream` member Ink touches; a queue is a new place to lose output on teardown) are answered member by member in "Adversarial pass"; per-COMMIT vs per-chunk is decided on the torn-snapshot cost; no-CR is decided against CLI-062 invariant I3; boolean vs epoch counter names the mixed-commit residual it accepts and why.
- GATE-WRITE — New-surface placement (conditional): N/A, justified. Every affected source file is inside the existing `packages/agent-ui-terminal`; the two new modules mirror in-package siblings (`focus-input-filter.ts` — verified `render.tsx:377` already passes `stdin: stdin.asInkStdin()`; `screen-reader-context.tsx`). No package, app, presentation/interface surface or product-family boundary is introduced.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: **FAIL**. § Solution 3 declares four conditions under which a batch adds no park: first of the session, `preparkMs` 0, no printable content, echo-stamped. Three have criteria (TC-09/TC-01, TC-04, TC-03/TC-10). "The first batch of the session adds no park" has none, and it appears nowhere in § Decision or § Fallback either. The gap is load-bearing: TC-02 replays "a captured screen-reader commit through the proxy" and asserts "the interval BEFORE the batch" — in a unit test that commit IS the first batch through a fresh proxy, which § Solution 3 says gets no park, so TC-02's expected outcome depends on priming it does not state. Required: a TC that pins the first-of-session behaviour (and states whether it is a rule at all), and TC-02 amended to say the batch under test is not the first.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS, with two observations that are not failures. All ten state observable outcomes; TC-08's "is green" / "the lint-warning ceiling holds" resolve to the exit-0 commands in its Test Plan row. Observation 1: TC-10's last two sentences are rationale, not assertions. Observation 2: TC-03's Scope half asserts key-level behaviour ("a `submit`/`execute` key does NOT arm") while its Test Plan tool is "arming the flag directly", which cannot exercise that half; TC-10 drives the positive keystroke but not the submit path. The criterion exists, so this is a Test Plan mismatch to fix alongside, not a criterion-form failure.
- Also recorded, not failing: § Solution 7-8 (SPEC.md § Pacing row, Known-limitations replacement, open item; `cli-help.ts`; README) carry no TC. SCREEN-2002, this initiative's sibling through every gate, has none either, so this is accepted practice here; CLI-2004 used an `rg`-form TC-14 for the same purpose and that form is available.

**Judged by:** `backlog-gate-guard` (semantic criteria; mechanical set judged by `gate.mjs` this run: 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN)
**Judged at:** HEAD `f05926ecac6d` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/draft/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md` blob `ce8ad610ec5f` (untracked)

### [GATE-WRITE] — ✅ PASS | 2026-09-20

**Status upgrade:** draft → review-ready

- GATE-WRITE — Ordering: PASS — GATE-WRITE is the entry gate (catalogue § Prior-gate map: no prior status gate), so no prior-gate PASS is required; the document is `status: draft` and sits in `.agents/spec-docs/draft/`, and `scan-doc-folder-status-agreement.mjs` re-run by the guardian reports `violations=0 result=PASS`.
- GATE-WRITE — Evidence-integrity re-check of the prior `❌ FAIL | 2026-09-20` entry (the ground of the `🔴 NON-COMPLIANCE` entry above): RESOLVED. Derived independently: the pre-rename item text `"TC-03b: the exemption actually FIRES through the real render path — …"` sliced by `gate-operations.mjs:712` (`missing[0].text.slice(0, 50)`) is `"TC-03b: the exemption actually FIRES through the r"` (50 chars), and the restored line matches it byte-for-byte; `tcIdOf` is `/^(TC-\d{2,}):/` (`gate-operations.mjs:306`), which rejects `TC-03b:`, so the evaluator would genuinely have failed that item; the rows line matches `gate-operations.mjs:761`'s template exactly (`10 rows vs 9 TC criteria; rows without a criterion: TC-03b` — `missing` empty because `TC-03b` was not in `tcIds`). Corroborated against an independent copy: the first guardian's own read of the file before the rename (session transcript, subagent `agent-a96133a4c6d39c`, file lines 459–471) reproduces the FAIL entry line-for-line as it now stands, `**Judged at:** … blob \`6587f3e56a2f\` (untracked)`included, and the evaluator's own stdout in the main session carries the same`10 rows vs 9 TC criteria; rows without a criterion: TC-03b`. Nothing else in the FAIL entry or in the NON-COMPLIANCE entry differs from those copies.
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): PASS. § Problem names the unshipped half of CLI-2004 verdict (i) and the unread variable; verified this run — `rg PREPARK packages/agent-ui-terminal/src packages/agent-cli/src packages/agent-cli/README.md` returns zero matches; the quoted refusal is `screen-reader-pacing.ts:9-14` verbatim ("THE PRE-WRITE PARK IS NOT SHIPPED … the variable is not read at all"); the Known-limitations paragraph is `docs/SPEC.md:603-607`. The wrong behaviour is stated observably: frames written back to back with no separation, and a prefix-sharing changed line announced as a mid-line patch.
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): PASS. `ROBOTA_SCREEN_READER=1 pnpm exec robota`, submit a prompt, reader attached. The mechanism it rests on is verified against the resolved ink 7.1.1 (`node_modules/.pnpm/ink@7.1.1_…/build/ink.js`): `:193` `const unthrottled = options.debug || this.isScreenReaderEnabled;`, `:199` `this.renderThrottleMs = unthrottled ? 0 : renderThrottleMs;`.
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): PASS. R1/R2 supply the 50 ms default (labelled provisional, matching the sole precedent), the 5000 ms bound, `0` as exact bypass and the input-echo exemption, each cited at the point § Decision adopts it; R5's diff-algorithm finding is the stated basis for the line-granular rationale and for refusing the "caret triggers re-announcement" claim; R5's braille and masked-input hazards produce the `0` bypass and the masked-input rule; the "measured, not copied" precedent is verified at `screen-reader-pacing.ts:29` (`DEFAULT_STARTUP_QUIET_MS = 900`). Alternative 3's seam is verified: `render.tsx:377` already passes `stdin: stdin.asInkStdin()` to `render()`, and ink 7.1.1 issues its per-commit writes as separate `stdout.write` calls (`ink.js:371-412`, six call sites) as § Decision describes.
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS. Alternative 3's own cons (reproduce every `WriteStream` member Ink touches; a queue is a new place to lose output on teardown) are answered member by member in "Adversarial pass" — `writable`/`destroyed`/`writableEnded` read-through verified against `ink.js:118`'s `canWriteToStdout` probe, stable identity against `ink.js:565`'s `instances.delete(this.options.stdout)`; per-COMMIT vs per-chunk is decided on the torn-snapshot cost; no-CR is decided against CLI-062 invariant I3; boolean vs epoch counter names the mixed-commit residual it accepts and why; the provisional default names what it cannot measure rather than deriving a number.
- GATE-WRITE — New-surface placement (conditional): N/A, justified. Every affected source file is inside the existing `packages/agent-ui-terminal` (plus doc lines in `packages/agent-cli`); the two new modules mirror in-package siblings (`attention/focus-input-filter.ts` via the `stdin` proxy at `render.tsx:377`; `screen-reader-context.tsx`). No package, app, presentation/interface surface or product-family boundary is introduced, and the checklist records the N/A with its reason.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS. The gap the prior run failed on is closed: § Solution 3's four no-park conditions each have a criterion — first-of-session → TC-11 (new; "first batch released with no park … the second batch IS parked"), `preparkMs` 0 → TC-01 and TC-09, no printable content → TC-04 and TC-07, echo-stamped → TC-03 and TC-10 — and § Fallback now states the first-of-session rule. TC-02's dependency on priming is now explicit ("after a first batch has primed the proxy … TC-11"). Remaining mapping: § Solution 1 → TC-01; 2 → TC-04/TC-06; 3 (formation, expiry, coalescing, callback settlement) → TC-03/TC-04; 4 → TC-07; 5 (context port, key-handler arming rule incl. submit/execute non-arming) → TC-03/TC-10, with "outside a provider the port is a no-op" covered by TC-08's existing suites; 6 → TC-05 (mode off), TC-06 (`flush()`/teardown), TC-09 (PTY). § Solution 7–8 (SPEC.md § Pacing row, Known-limitations replacement, open item; `cli-help.ts`; README) carry no TC — recorded, not failing: the sibling SCREEN-2002 passed this gate on 2026-09-19 with its § Solution 7 (SPEC.md rewrite) uncovered by any TC, so a doc-only Solution item without a TC is this repository's accepted reading of "feature or sub-item".
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): PASS. All eleven state observable outcomes; TC-11 ("released with no park … the second batch IS parked") and the amended TC-02 are observable; TC-08's "is green" / "the lint-warning ceiling holds" resolve to the exit-0 commands in its Test Plan row. The prior run's Test Plan mismatch is closed: the TC-03 row now reads "Vitest over the key handler's arming rule AND the proxy's flag directly" with Notes "Submit/execute must not arm; formation stamping; expiry", which exercises the submit/execute non-arming half of TC-03's Scope. Observation, not failing: TC-10's last two sentences remain rationale rather than assertion; the assertion ("produces an unparked batch, AND the next non-composer commit in the same test is parked") is present.
- GATE-WRITE — Mechanical set (20 criteria) judged by `gate.mjs judge --gate GATE-WRITE --lane L2 --dry-run` this run: 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN (the seven above); 11 criteria all `TC-NN:` prefixed, 11 Test Plan rows = 11 TC criteria, no banned phrase, `## Prior Art Research` substantiated per `scan-spec-research`, 5/5 checklist items `[x]`, 4 alternatives each with Pro and Con, `## Tasks` present, no `## Status`/`## Classification` body sections.
- GATE-WRITE — Orchestrator ledger: `.agents/loop-runs/backlog-execution-orchestrator.jsonl` row `r20260919193659` is closed `terminal: converged`, `roundFindings: [7,6,6,0]`, `closed: 2026-09-20T03:05:26.190Z`, `ref` = this item's Task — recorded as context, not a criterion.

**Judged by:** `backlog-gate-guard` (semantic criteria and the evidence-integrity re-check; mechanical set judged by `gate.mjs` this run: 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN)
**Judged at:** HEAD `f05926ecac6d` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/draft/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md` blob `5aa892ec0d9a` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-2670 스펙을 승인합니다"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 86825b8d456d (review 8ca74f6f, type/tags f6ab8bb9)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-20, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (86825b8d456d) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `f05926ecac6d` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/backlog/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md` blob `2550e954dfe3` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-20

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "SCREEN-2670 스펙을 승인합니다"
**Given:** 2026-09-20, this conversation
**Review fingerprint:** 86825b8d456d (review 8ca74f6f, type/tags f6ab8bb9)

- GATE-APPROVAL — Ordering: PASS — the prior gate `[GATE-WRITE] — ✅ PASS | 2026-09-20` is recorded on this document and carries `**Status upgrade:** draft → review-ready`; the document's current `status: review-ready` equals that entry's `Y`, which is what the prior-gate map's declared `recorded-pass` re-run rule for this row requires. The two earlier GATE-WRITE entries (`❌ FAIL` and `🔴 NON-COMPLIANCE`, both 2026-09-20) precede the PASS in the log, and the PASS entry records the NON-COMPLIANCE ground as RESOLVED with an independent derivation; the PASS is also the LAST GATE-WRITE entry, so the plain last-entry rule would agree. The file sits in `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` maps `review-ready` to; `scan-doc-folder-status-agreement.mjs` re-run by the guardian: `violations=0 result=PASS`.
- GATE-APPROVAL — User has provided explicit approval in the current conversation (mechanical): PASS — route `DIRECT`, `**Instruction (verbatim):** "SCREEN-2670 스펙을 승인합니다"`, `**Given:** 2026-09-20, this conversation`, written by `gate.mjs approve --route DIRECT --instruction "SCREEN-2670 스펙을 승인합니다"`; guardian re-ran rather than cited — `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc .agents/spec-docs/backlog/SCREEN-2670-…md --dry-run` → "9 criteria judged — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN", "no entry written". The entry parses for the scan that owns the form: `node scripts/harness/scan-standing-delegation-evidence.mjs` → exit 0, "393 approved spec document(s); 126 DIRECT, 49 CLASS".
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the recorded instruction names this item's ID (`SCREEN-2670`) and the word `스펙`, and uses `승인` (a catalogue-listed Route DIRECT form: "승인"). The ID resolves to exactly one spec document — `ls .agents/spec-docs/*/ | grep 2670` returns this file plus `HARNESS-2670-…` and `AGREEMENT-2670-…`, neither of which is `SCREEN-2670`, so the statement cannot be read as approving a different item. Per the dispatch, the user selected it 2026-09-20 in this conversation as the option, labelled exactly with this text, to a question that named this spec and its GATE-APPROVAL DIRECT route; the guardian cannot read the conversation itself, so the conversation-locality fact rests on the mechanical criterion above (`**Given:** … this conversation`, recorded by `gate.mjs approve` in-session) and this criterion judges the statement's form and target, which are on the record. It is not a clarifying-question answer ("C"/"ㅇㅇ"/"응"), not silence, not approval of another item, and not a standing class instruction. Same form as the sibling precedent `.agents/spec-docs/active/SCREEN-2002-…md` § `[GATE-APPROVAL]` (2026-09-19): "SCREEN-2002 스펙을 승인합니다".
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no class is cited anywhere in the approval entry.
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A as a Route CLASS condition — route DIRECT; the instruction, its date and the conversation are nonetheless recorded in the fields of both the mechanical entry above and this one.
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT; no class evidence condition is claimed, so there is nothing to measure.
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A — route DIRECT; no registered class (`LANE-L0-L1`, `BACKLOG-ZERO-MIGRATION`) is invoked, the document declares `lane: L2`, and the approval's authority rests entirely on the instruction naming THIS item (`SCREEN-2670`), which the DIRECT semantic criterion above judges — the same disposition the SCREEN-2002 precedent recorded.
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS — the guardian recomputed `reviewFingerprint()` from `scripts/harness/gate-operations.mjs:897` over the current document text and obtained `86825b8d456d (review 8ca74f6f, type/tags f6ab8bb9)`, identical to the `**Review fingerprint:**` the mechanical entry recorded at approval; the dry run reports the same equality. `type: SCREEN` / `tags: [screen]` and the whole Architecture Review (Affected Scope, 4 Alternatives, Decision, 5/5 Checklist) are the design the owner approved.
- GATE-APPROVAL — Independent architecture validation (conditional): N/A — the condition is not triggered, verified against the tree rather than taken from the spec's claim. § Affected Files lists 12 paths: 10 under `packages/agent-ui-terminal/` (4 of them new: `src/screen-reader-stdout.ts`, `src/screen-reader-pacing-context.tsx`, `src/__tests__/screen-reader-stdout.test.ts`, `src/__tests__/pty/screen-2670-prepark.ptytest.ts`) and 2 documentation paths under `packages/agent-cli/` (`src/utils/cli-help.ts`, `README.md`); both packages exist in `packages/` and no new directory is added there. Each new module has one plausible home and a same-package sibling it mirrors: the stdout proxy is the counterpart of the `stdin` proxy already handed to the same `render()` call (`render.tsx:377` passes `stdin: stdin.asInkStdin()`; `attention/focus-input-filter.ts:57` declares `TInkStdinSurface`), and the pacing context mirrors the existing `src/screen-reader-context.tsx`; `terminal-marks.ts:52-55` currently defaults to `process.stdout.write`, which is the in-package writer the change re-routes. No package, app, presentation/interface surface or product-family boundary is introduced and no layer is reclassified, so no `proposal-reviewer` placement verdict and no `architecture-audit-fanout` structure-channel result is required by this criterion. Recorded as context, not as a criterion: the dispatch stated the ENDORSE is "in the spec's § Decision"; § Decision references "review round 1", "Review round 2" and "round 3" but records no verdict string — `ENDORSE`/`proposal-reviewer` occur nowhere in this spec or in the paired Task. The ledger `.agents/loop-runs/backlog-execution-orchestrator.jsonl` row `r20260919193659` (`ref` = this item's Task) corroborates the review independently of prose: `roundFindings: [7,6,6,0]`, `terminal: converged`, `closed: 2026-09-20T03:05:26.190Z` — four rounds, the last with zero findings.
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation started before this gate ran): not met — `packages/agent-ui-terminal/src/screen-reader-stdout.ts`, `src/screen-reader-pacing-context.tsx`, `src/__tests__/screen-reader-stdout.test.ts` and `src/__tests__/pty/screen-2670-prepark.ptytest.ts` do not exist; `rg "PREPARK|createParkedStdout|armEchoRelease|asInkStdout|screen-reader-stdout"` over `packages/agent-ui-terminal/src`, `packages/agent-cli/src`, `packages/agent-cli/README.md` and `packages/agent-ui-terminal/docs/SPEC.md` returns only the pre-existing Known-limitations line `docs/SPEC.md:607`; `screen-reader-pacing.ts:9-14` still carries "THE PRE-WRITE PARK IS NOT SHIPPED"; `git status --porcelain` carries no path outside `.agents/` (this spec untracked, the SCREEN-2002 spec/Task, the AGREEMENT-2670 spec/Task, the orchestrator ledger, one evals scenario and the two auto-generated lessons files). The paired Task is tracked and unmodified (`bcb280c49`).
- GATE-APPROVAL — Semantic evaluation: all 3 pending guardian criteria resolved — 1 PASS (approval directed at this spec) and 2 N/A with their reasons stated (inside-the-class, independent architecture validation); 0 FAIL.

**Judged by:** `backlog-gate-guard` (semantic) + `gate.mjs` (mechanical)
**Judged at:** HEAD `f05926ecac6d25ddca74c58aaf6eead8b4dff219` · base `origin/develop@f05926ecac6d25ddca74c58aaf6eead8b4dff219` · document `.agents/spec-docs/backlog/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md` blob `52a7553d6b7c8aaa46e7e448ef024615d00878b9` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-20

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-20; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (11)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 204 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 4 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->
```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md",
  "specPath": ".agents/spec-docs/todo/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/loop-runs/backlog-execution-orchestrator.jsonl",
    ".agents/loop-runs/user-execution-scenario.jsonl",
    ".agents/spec-docs/todo/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md",
    ".agents/tasks/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md"
  ]
}
```
<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `f05926ecac6d` · base `origin/develop@f05926ecac6d` · document `.agents/spec-docs/todo/SCREEN-2670-queue-screen-reader-frames-with-a-pre-write-cursor-park.md` blob `b9d821033149` (untracked)
