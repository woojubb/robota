---
title: 'SELFHOST-011 P3/P4: evals-as-code follow-ups (optional metric helpers, dataset loader, dedicated package, in-session /eval)'
status: todo
created: 2026-07-19
priority: low
urgency: later
area: packages
depends_on: ['SELFHOST-011']
---

# Evals-as-code follow-ups — P3/P4 (SELFHOST-011)

SELFHOST-011 P1 (neutral `agent-framework/src/evals/` definition API + runner) and P2 (`robota eval` CLI
exit-code gate + example + agent-run verification) are DONE and closed the epic's core capability. These
consciously-deferred slices remain (mirrors the SELFHOST-003-P4 / SELFHOST-008-P5 / SELFHOST-010-P2 deferral
pattern — no neutral-library gap remains for v1):

## P3 — DONE (spec-docs/done/SELFHOST-011-P3-evals-helpers.md, 2026-07-19)

## P3 (original) — optional neutral metric helpers + dataset-file loader

- Ship **mechanism-only** neutral metric helpers (e.g. `exactMatch`, `jsonSchemaMatch`, `regexMatch`) — pure
  functions over `IExecutionResult`/`response`, **no domain content**. They must stay neutral: no opinionated
  metric set (that would be the Mastra-style erosion HARNESS-034 fences).
- A dataset-file loader: read cases from a `.jsonl`/`.json` dataset the consumer supplies (the metrics stay
  code). Keep the corpus consumer-side — no dataset content in `packages/`.
- A neutral SDK `formatEvalReport(report): string` in `agent-framework/src/evals/` (the CLI currently has a
  private formatter) so SDK consumers can render a report without re-implementing it.

## P4 — dedicated package + in-session command (deferred until warranted)

- Extract a dedicated `@robota-sdk/agent-evals` package **iff** a third-party-installable metric family
  emerges (as SELFHOST-003 defers its interface package). Until then the sibling-module placement in
  `agent-framework` is correct; a package adds publish/structure/SPEC ceremony for a non-family.
- An in-session `/eval` slash command (`agent-command` `ICommandModule`) if interactive eval runs are wanted;
  today `robota eval` is a top-level binary subcommand only.

## Notes

Follow the spec-gate for each slice. See the closed epic spec
[`.agents/spec-docs/done/SELFHOST-011-evals-as-code.md`](../spec-docs/done/SELFHOST-011-evals-as-code.md) (Solution
§ "Epic slices") and the TC-05 mechanical floor [`HARNESS-034`](./HARNESS-034-evals-content-neutrality-floor.md).
