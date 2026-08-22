---
name: architecture-audit-fanout
description: Thin coverage orchestration for four independent architecture dimensions. It shards targets, dispatches structure/design/runtime/gate auditors in parallel, records and parses their exact coverage signals, and redispatches only uncovered target-by-criterion cells. It never performs conformance, synthesis, verification, depth, reconciliation, or finding judgement.
loop: over=finding-set; escape=no-progress; bound=3 rounds
---

# Architecture Audit Fanout — pipeline only

This skill owns coverage routing and nothing else. All audit criteria, severity, evidence, containment,
and finding judgement live in the four agents it dispatches:

- `architecture-structure-auditor`
- `architecture-design-auditor`
- `architecture-runtime-auditor`
- `architecture-gate-auditor`

`architecture-conformance-auditor` is deliberately not a fanout dimension. The caller dispatches that
doc↔code audit as a separate channel. This skill also never merges, deduplicates, promotes, rejects, verifies,
depth-triages, or reconciles a finding; in particular, fanout must never absorb synthesis judgement.

## Pipeline

1. Open an `architecture-audit-fanout` ledger run. From the caller's target list, criterion lists, and shard
   plan, establish every expected target×criterion cell for each dimension as a stable, delimiter-free cell
   ID. The ledger manifest—not the auditor's reported denominator—is the coverage SSOT.
2. Before dispatch, record one expectation per dimension/shard using phase `audit`, the exact agent name,
   subject `<dimension>:<k>/<n>`, token `AUDIT-DIM-COMPLETE`, and the comma-separated assigned cell IDs.
3. Dispatch all dimension/shard assignments together so they execute in parallel and remain mutually blind.
   Each receives only its target shard, its full dimension checklist, and any uncovered-cell subset for a
   retry. Do not expose sibling reports.
4. Record exactly one returned terminal line for each expectation. Accept only:

   `AUDIT-DIM-COMPLETE: dim=<structure|design|runtime|gate> shard=<k>/<n> blocker=<n> high=<n> medium=<n> low=<n> coverage=<covered>/<total> uncovered=<cells|none>`

   A missing, duplicate, malformed, wrong-agent, wrong-dimension, or wrong-shard observation leaves that
   assignment uncovered; it never becomes an implicit clean result. The floor requires reported `total` to
   equal the manifest size and `covered + uncovered IDs` to equal that total.

5. Record the round's uncovered-cell count. If every expected cell is covered and every shard returned one
   valid observation, close `converged` and return the four raw report sets plus the nested run ID. Otherwise,
   redispatch only the exact prior uncovered-cell set; never rerun confirmed cells and never alter a report's findings.
6. If the same uncovered-cell set recurs unchanged, stop immediately as no-progress and escalate with the
   exact cells. The round cap is three; it is a secondary safety bound, not the only stopping condition. If
   cells remain after round three despite progress, close `bound-reached` and escalate them.

The skill's loop ledger is separate from the caller's outer architecture-refresh ledger. Use the canonical
ledger commands rather than editing JSONL directly:

```bash
node scripts/harness/loop-run.mjs open --loop architecture-audit-fanout
node scripts/harness/loop-run.mjs expect --loop architecture-audit-fanout --run <id> --phase audit --agent <agent> --subject <dimension:k/n> --token AUDIT-DIM-COMPLETE --cells <cell-id,cell-id>
node scripts/harness/loop-run.mjs observe --loop architecture-audit-fanout --run <id> --phase audit --agent <agent> --subject <dimension:k/n> --signal '<terminal-line>'
node scripts/harness/loop-run.mjs round --loop architecture-audit-fanout --run <id> --findings <uncovered-cell-count>
node scripts/harness/loop-run.mjs close --loop architecture-audit-fanout --run <id> --terminal <converged|no-progress|bound-reached|halted-for-user|abandoned>
```

That is the whole skill. It returns coverage and raw reports; only the caller may send them to synthesis.
