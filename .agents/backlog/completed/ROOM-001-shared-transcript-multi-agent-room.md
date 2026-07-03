---
title: 'ROOM-001: shared-transcript multi-agent Room primitive with a turn-selection hook'
status: done
completed: 2026-07-03
created: 2026-07-03
priority: medium
urgency: later
area: packages/agent-core, packages/agent-session, packages/agent-framework
depends_on: []
---

# Room / shared-conversation multi-agent primitive

Gap analysis G3 (`.design/gap-analysis-realtime-voice-agent-app.md`, P0 in its roadmap) + the speech
feedback's realized workaround (§1, §4): their app is "1 room = N agents + 1 shared append-only
transcript" — a Director agent reads the transcript and picks the next speaker; each Persona agent
contributes to the same transcript. Robota's session model is one-agent-per-conversation, so they
built their own ConversationStore + adapter-owned loop and used robota only for the per-agent calls.

This is the opposite composition from the existing subagent model (isolation/parallel) — shared and
sequential — and would open the collaborative-agents use-case class (debates, panels, simulations,
multi-persona rooms). Read the source doc with its own caveat: robota is a composable library; this
is a NEW block, not a repurposing of the coding assistant.

## What (problem + intent — full design is its own GATE-WRITE pass)

1. A **Room** primitive: N agent instances subscribing to / appending to ONE shared append-only
   transcript (history append-only rule applies), each with its own identity/persona/model.
2. A **turn-selection hook**: pluggable "who speaks next" policy — a Director agent (the speech
   pattern), round-robin, or app callback. The speech adapter-loop (decide → run persona → re-inject)
   is the reference workload; CORE-011's terminal-tool decision pattern is the natural Director
   implementation.
3. Reuse, don't fork: per-agent execution stays `Robota`; the room owns transcript fan-in/fan-out
   and turn scheduling. Relationship to `agent-session`'s single-agent session to be decided at
   design time (sibling primitive, not a rewrite).

Product-direction note: expands robota's addressable use-cases beyond single-agent apps — confirm
scope/priority at GATE-APPROVAL before design.

## Test Plan

- Unit: transcript fan-in ordering (no interleaving mid-message; depends on CORE-012 semantics),
  turn hook invocation order, agent join/leave.
- Functional: 3 scripted agents + scripted director complete a deterministic 6-turn exchange on one
  shared transcript.

## User Execution Test Scenarios

- Prereq: consumer script assembling a room with 2 personas + 1 director (scripted or real provider).
- Steps: run a 3-round exchange; dump the shared transcript.
- Expected: one coherent transcript with correctly attributed speakers in director-chosen order.
- Evidence: **PASS (live, 2026-07-03).** GATE-APPROVAL: 사용자 승인 "설계+최소 코어 구현";
  placement re-proposed per user direction (new agent-room package felt duplicative) and
  re-confirmed as `packages/agent-session/src/room/` — agent-session now owns BOTH conversation
  primitives (SPEC Scope rewritten first, spec-first). Design confirmed then implemented:
  `Room` (shared transcript = core `ConversationStore`, append-only, speaker attribution via
  `metadata.speaker`; `join`/`leave` with unique-name rules; `say()` for external turns;
  sequential `run` loop with `maxTurns` safety cap, abort signal, unknown-speaker throw, one
  run at a time) + `ITurnSelector` with `createRoundRobinSelector` (own scheduled counter —
  external turns don't consume rounds), `createCallbackSelector`, `createDirectorSelector`
  (decision via CORE-015 structured output constrained to members+END — supersedes the
  CORE-011 tool workaround the backlog referenced, per CORE-015's own spec). Composition:
  members pair with `retainHistory:false` (CORE-014); transcript re-rendered per turn (the
  speech project's hand-rolled pattern made first-class). Unit/functional: 7 tests incl. the
  deterministic 3-agent 6-turn round-robin exchange with fan-in ordering asserted per turn
  ("saw N turns"), selector view growth, cap, attribution on store messages — agent-session
  83/83 green; repo typecheck + 43 scans + doc-examples (53 blocks, incl. new README Room
  example) green. Docs: SPEC "Room Contract" section, README Room section, llms.txt
  capability line. Live User Execution (real Anthropic haiku): 2 personas + 1 director,
  director-ordered debate — 4 coherent alternating turns (optimist/skeptic), both spoke,
  END honored, store attribution intact. Follow-ons (unfiled by design, listed as non-goals):
  transport fan-out, transcript persistence, mid-run join, parallel rooms.
