---
title: 'SELFHOST-008 P6: surface-wire the memory pipeline + agent-run end-to-end verification'
status: todo
created: 2026-07-18
priority: high
urgency: now
area: apps/agent-cli
depends_on: ['SELFHOST-008']
---

# Surface-wire the memory pipeline + agent-run end-to-end verification (SELFHOST-008 P6)

## Problem

SELFHOST-008 shipped the neutral memory **library** end-to-end — P2 auto-capture, P3 per-turn recall, P4 semantic
decorator — each unit/functional-tested with fake providers. **But no product surface enables any of it:** a `grep`
across `packages/agent-cli/src` + `apps/` finds ZERO references to `automaticMemory`, `recallMemory`, `memoryStore`, or
`createFileSystemMemoryStore`. All three capabilities are **adapter-gated OFF by default**, so when a user runs the real
`robota` agent, **nothing captures or recalls memory** — the pipeline is dark. The features were never verified by
actually running a real coding agent; they passed only library unit tests. This violates the agent-owned-verification
principle (memory `[gui-verification-agent-owned]`) and the capability-reachability done-gate
([backlog-execution.md](../rules/backlog-execution.md) → "Capability Reachability — no library-seam N/A dodge").

Owner directive (2026-07-18): _"the selfhost features you build must include, in the backlog plan, that YOU directly run
the agent, test end-to-end, and complete verification yourself."_

## Scope

1. **Surface-wire the memory pipeline into `agent-cli`** (opt-in, off by default until enabled):
   - Inject a `memoryStore` (the neutral `createFileSystemMemoryStore(cwd)` by default) into the interactive session.
   - Enable **P2 auto-capture** via a surface-owned `automaticMemory` policy (a CLI/config flag, e.g. `--memory` /
     `settings.json` `memory.capture`), default policy `approval_required` (queue) per the P2 design.
   - Enable **P3 per-turn recall** via a surface-owned `recallMemory` policy (budget from config).
   - Keep P4 semantic OFF unless a concrete adapter is supplied (that is P5). Keyword recall is the default here.
   - Neutrality: the surface owns the enable decision + policy + budget; `packages/` unchanged (HARNESS-029 stays green).
2. **AGENT-RUN end-to-end verification (the agent performs this itself, not the owner):**
   - Drive the real `robota` CLI with a real provider (keys per memory `[provider-keys-local-run]`), non-interactive
     (`-p` / print-mode, `--no-session-persistence` off so memory persists across sessions).
   - Scenario: **session A** — tell the agent a durable fact (e.g. "remember that this project deploys via `pnpm ship`");
     confirm capture (a `.robota/memory/` write or queued candidate). **Session B (fresh)** — ask a paraphrased question
     ("how do I release this project?") and confirm the captured fact is RECALLED into the turn (the `<recalled-memory>`
     block reaches the model / the answer reflects the fact).
   - Capture evidence: the CLI transcripts + the `.robota/memory/` artifacts + (if useful) a screenshot/Artifact page.
   - Add this as a saved scenario under `.agents/evals/scenarios/` and make the backing run agent-executable.

## Completion criteria (agent-run, not owner-run)

- TC: with memory enabled, a real `robota` run CAPTURES a durable fact to `<cwd>/.robota/memory/` (agent-run, evidence).
- TC: a fresh real `robota` run RECALLS that fact for a paraphrased query (agent-run — the recalled block is present /
  the answer reflects it), demonstrating P2+P3 live end-to-end through the CLI surface.
- TC: default-off preserved — without the flag, no capture/recall occurs (unchanged behavior).
- TC: neutrality — `pnpm harness:scan` green; no memory content/prompt/SDK added to `packages/`.

## Notes

This is the **agent-run verification that P2/P3/P4 should have carried**; it is filed at `priority: high / urgency: now`
because it makes already-merged work actually reachable + verified (ahead of P5's concrete backend and ahead of
SELFHOST-009). Follow the full spec-gate pipeline; the GATE-COMPLETE user-execution scenario MUST be the agent-run e2e
flow above (a surface flow the agent executes), not a unit test. See the capability-reachability done-gate clause.
