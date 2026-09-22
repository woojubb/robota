---
title: 'HARNESS-2664: guardian-written gate evidence entries carry no attribution until archival, because no producer of semantic entries is instructed or forced to write Judged-by and the attribution scan reads only spec-docs/done'
issue: https://github.com/woojubb/robota/issues/2664
status: todo
created: 2026-09-22
priority: medium
urgency: soon
area: harness gate records and evidence attribution
depends_on: []
---

# HARNESS-2664: guardian-written gate evidence entries carry no attribution until archival, because no producer of semantic entries is instructed or forced to write Judged-by and the attribution scan reads only spec-docs/done

## Objective

Make gate-verdict attribution a property of the entry at the moment it is written, not something
reconstructed at archival. Today `**Judged by:**` is required of every Evidence Log entry once a spec
reaches `.agents/spec-docs/done/` (`scan-gate-verdict-attribution`, issue #2269), but the only producer
that writes it mechanically is `gate.mjs` (`gate-operations.mjs`). The producer of every SEMANTIC entry
— `backlog-gate-guard`, whose sole permitted write IS the evidence entry — has no instruction, template
line or floor for `**Judged by:**` / `Independent guardian:`, and the scan reads only `done/`, so an
active document accumulates unattributed entries across every semantic round and surfaces them all at
archival, where whoever archives writes the attribution after the fact — the opposite of what
issue #2269 asked for.

Measured three times in 24 hours: `38304fcaa` (MCP-001 Round C, 2026-09-21) added a `**Judged by:**`
line to an already-done spec; `5083c1b7f` (PROC-2664, 2026-09-22) — "the local review's one MUST: the
GATE-WRITE entry carried no Judged-by line"; MCP-002 (2026-09-22) archived with seven unattributed
`[GATE-WRITE]` entries, contained by adding the line at archival (`Contained — HARNESS-2664.`).

## Plan

- [ ] Give `backlog-gate-guard` (`.claude/agents/backlog-gate-guard.md`) an entry template whose
      `**Judged by:**` line is mandatory, naming the guardian and the criteria set it judged.
- [ ] Add the same line to every other producer of a semantic Evidence entry found by
      `rg -l "Evidence Log" .claude/agents .agents/skills`, or record why a producer writes none.
- [ ] Widen `scan-gate-verdict-attribution` (or add a sibling) to read `draft/`, `backlog/`, `todo/`
      and `active/` for entries dated after the change lands, so the defect is refused when it is
      written rather than when it is archived; keep the `done/` baseline cutoff intact.
- [ ] Red-proof: an entry appended by the guardian without the line fails the widened scan on an
      active document.
- [ ] Confirm the three measured records (`38304fcaa`, `5083c1b7f`, MCP-002) would have been refused at
      write time under the new floor.

## Evidence

- Depth verdict: `finding-depth-triager`, MCP-002 Round A review, 2026-09-22 — `DEPTH: FOUNDATIONAL`
  on `pr-review-reviewer`'s SHOULD "seven `[GATE-WRITE]` entries lack `**Judged by:**`".
- Containment: the seven lines added at archival in
  `.agents/spec-docs/done/MCP-002-build-the-shared-mcp-client-and-http-product-vertical-slice.md`,
  each marked `Contained — HARNESS-2664.`

## User Execution Test Scenarios

<!-- backlog-execution.md § User Execution Test Scenario Rule. Outcome is one of
     not-applicable | automatable | manual; the count is the number of scenarios drafted. Keep the
     not-applicable form ONLY with a product-surface reason (≥ 50 characters, not build/typecheck
     evidence); otherwise write the scenario a user can run and raise the count. -->

**Author verdict:** `SCENARIO DRAFTED: not-applicable | 0`

**Reason:** Harness-internal: the change alters an agent definition and a repository scan that gate authoring records; no product binary, SDK example or CLI surface an end user runs exposes an Evidence Log attribution line.
