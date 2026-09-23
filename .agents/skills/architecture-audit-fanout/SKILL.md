---
name: architecture-audit-fanout
description: Run parallel structure, design, runtime, and gate audits when broad architecture coverage is required.
loop: over=uncovered-cells; escape=no-progress; bound=3 rounds
---

# Architecture Audit Fanout

Use only when broad architecture coverage is justified. For a focused change, use the relevant direct
review instead of this fanout.

## Flow

1. Build an in-memory target×criterion manifest for the structure, design, runtime, and gate dimensions.
2. Dispatch mutually blind read-only auditors in parallel. Each assignment receives its exact cells and
   returns one `AUDIT-DIM-COMPLETE` line plus findings.
3. Validate the returned dimension, shard, counts, and cell coverage immediately. Missing or malformed
   output is an explicit error, never an implicit clean result.
4. Retry only uncovered cells. Stop when coverage is complete, the same uncovered set repeats, or three
   rounds are reached.
5. Return the four raw report sets and uncovered cells to the caller. This skill does not synthesize,
   classify, repair, or persist a second lifecycle.

The command/agent execution result is the evidence. Do not write a per-skill ledger or proof-only commit.
