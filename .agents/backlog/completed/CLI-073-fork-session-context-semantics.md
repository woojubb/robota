---
title: 'CLI-073: --fork-session starts an empty model context — is that the intended fork semantics?'
status: done
created: 2026-06-12
priority: low
urgency: later
area: packages/agent-framework
depends_on: []
---

# CLI-073: Fork session context semantics (design question)

## Problem

Discovered while implementing CLI-063 (2026-06-12): the framework's fork implementation
(`interactive-session-restore.ts:85`) deliberately skips injecting the resumed session's
conversation messages when `forkSession: true`. A fork therefore gets a new session id and
a **fresh model context** — the model knows nothing from the forked-from session. This is
identical in TUI and (since CLI-063) print mode.

Help text says "Fork the current session into a new independent session", which most users
read as git-style branching: continue with the same context, diverge from there. A fork that
starts empty is indistinguishable from "new session" except for the display transcript
restored from history entries (TUI only).

**This is a SPEC violation, not just a design question**: `packages/agent-cli/docs/SPEC.md`
(Session Resolution Logic, `--fork-session` row) already promises "Creates a new session
(fresh UUID) but **restores context** from the resumed session." The code does not restore
conversation messages on fork. Per the spec-is-SSOT rule the default resolution is (a) —
make fork inject prior messages — unless the SPEC row itself is re-decided.

## Expected Behavior

Decide the contract first (spec-first): either (a) fork carries the conversation messages
into the new session (branch-with-context, matching the common mental model), or (b) the
current fresh-context behavior is intended and help/SPEC text must say so explicitly
("transcript is copied for display; the model starts fresh"). Option (a) changes
TUI-and-print behavior together in the framework restore path.

## Test Plan

- If (a): framework restore test — fork injects prior messages into the new session;
  original record untouched; new session id differs.
- If (b): help/SPEC content tests describing fresh-context fork.
- `pnpm --filter @robota-sdk/agent-framework test`

## User Execution Test Scenarios

- Prerequisite: configured provider.
- Steps: `robota -p "Remember 42"`; `robota -p "What number?" -r <id> --fork-session`.
- Expected observable result: per the approved contract — answer references 42 (a) or
  documentation clearly states forks start fresh (b).
- Evidence (2026-06-13, real binary + real Anthropic provider, isolated HOME —
  contract (a) implemented per spec-is-SSOT):

  ```
  $ robota -p "Remember the number 42. Reply only: noted."
  noted.
  $ robota -p "What number did I ask you to remember? Answer with just the number." \
      -r <id> --fork-session
  42            # fork answers from restored context
  session files: 2   # fresh UUID — source record content untouched
  ```

  CI tests: framework `fork-restores-context.test.ts` (3/3 — restore yields messages,
  source byte-identical at restore level, resume regression); agent-cli scripted e2e
  "CLI-073: --fork-session restores the prior conversation into a NEW session"
  (request carries source conversation, 2 session files, source content invariant);
  CLI-063 print-mode fork test updated to the SPEC-conform semantics.
