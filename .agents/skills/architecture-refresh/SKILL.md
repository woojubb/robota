---
name: architecture-refresh
description: Thin orchestration for the recurring architecture audit→synthesis→verification→depth→reconciliation/apply→re-audit loop. It delegates four-dimension coverage to architecture-audit-fanout, keeps conformance separate, records every expected and observed guardian signal, and routes outcomes until every material finding is resolved. Every judgement lives in the agents.
loop: over=finding-set; escape=no-progress; bound=3 rounds
invocable: true
---

# Architecture Refresh — pipeline only

This skill sequences predefined roles and records their signals. It owns no architecture criteria, finding
truth, severity judgement, depth judgement, registry identity, or apply discipline. Those decisions live in
the agents and repository owners named below.

The nested `architecture-audit-fanout` skill dispatches the four mutually blind dimensional auditors:
`architecture-structure-auditor`, `architecture-design-auditor`, `architecture-runtime-auditor`, and
`architecture-gate-auditor`. The outer loop directly dispatches these additional agents:

- `architecture-conformance-auditor` — separate doc↔code audit channel; `ACTIONABLE FINDINGS`.
- `architecture-audit-synthesizer` — draft judgement and final mechanical verifier application; `SYNTH`.
- `finding-verifier` — isolated truth test for one selected finding; `VERIFY`.
- `finding-depth-triager` — LOCAL/FOUNDATIONAL/INVALID/UNDETERMINED guardian; `DEPTH`.
- `finding-reconciler` — sole registry matcher for an already-FOUNDATIONAL finding; `RECONCILE`.
- `architecture-fixer` — applies LOCAL doc-side findings or a requested document containment label.
- `architecture-implementer` — applies LOCAL code-side findings or a requested code containment label.

## Pipeline

1. **Open and audit.** Open the outer ledger. Start `architecture-audit-fanout` for four-dimension coverage
   and dispatch `architecture-conformance-auditor` separately over the same intended scope. Before the
   conformance dispatch, record its expectation under phase `conformance`; record its exact
   `ACTIONABLE FINDINGS: <n>` observation. Link the completed nested fanout run ID into the outer record.
   Conformance is never a fifth fanout dimension and does not satisfy a missing dimensional cell.
2. **Synthesize draft.** Before dispatch, record a `SYNTH` expectation for
   `architecture-audit-synthesizer`, phase `synthesize-draft`, subject `draft`. Give it the four raw
   dimensional reports and the separate conformance report. Record exactly one returned line:

   `SYNTH: stage=draft material=<n> blocker=<n> high=<n> medium=<n> low=<n> rejected=<n> unverified=<n>`

   Immediately record every material draft finding's stable ID and severity with `draft-finding`; the
   runtime floor requires that identity set to match the SYNTH counts and all later verification routes.

3. **Early convergence.** If fanout coverage is complete and draft `material=0`, retain low findings as the
   non-blocking report, record a zero round, and close `converged`. Do not dispatch verifier, final synthesis,
   depth, reconciler, or appliers for a zero-material draft.
4. **Verify material findings.** For each draft material finding selected for adversarial verification,
   record a phase `verify` expectation and dispatch one `finding-verifier` with only that finding—no sibling
   finding or synthesis narrative. Record exactly one line:

   `VERIFY: id=<id> outcome=<CONFIRMED|REFUTED|UNPROVABLE> severity-opinion=<unchanged|blocker|high|medium|low>`

   Route blocker/high findings and evidence-confirmed medium findings through the verifier. For every other
   material finding, record its ID explicitly with `pass-through`; missing verifier output is never treated
   as pass-through. Low findings remain reported but are outside the material verification routes.

5. **Synthesize final.** Record the phase `synthesize-final`, subject `final`, `SYNTH` expectation before
   dispatch. Give the synthesizer the draft, verifier outcomes, and explicit pass-through IDs; it applies
   them mechanically. Record exactly one returned line:

   `SYNTH: stage=final material=<n> blocker=<n> high=<n> medium=<n> low=<n> rejected=<n> unverified=<n>`

   Record every surviving material ID and severity with `final-finding`. The floor derives the expected
   final set mechanically from CONFIRMED/REFUTED/UNPROVABLE, severity-opinion, and pass-through records.

6. **Judge depth.** Before each dispatch, record a phase `depth`, agent `finding-depth-triager`, finding-ID
   subject, token `DEPTH` expectation. Dispatch `finding-depth-triager` for every surviving final material
   finding in identity-preserving single-finding mode and record its exact terminal
   `DEPTH: id=<id> outcome=<LOCAL|FOUNDATIONAL|INVALID|UNDETERMINED>` observation. Then take the route the verdict names:

   - `LOCAL` → use the finding's `side`: doc-side goes to `architecture-fixer`, code-side goes to
     `architecture-implementer`. Pass the verdict with the finding. On a verified correction, record
     disposition `corrected`.
   - `INVALID` → apply nothing and record disposition `invalid` with a source-site path and exact source
     fact so the floor can prove what the source actually does.
   - `UNDETERMINED` → close `halted-for-user` with the named missing evidence. A continuation opens a new run
     after that evidence exists; it is not LOCAL and cannot fall through to an applier.
   - `FOUNDATIONAL` → record the foundational ID, then continue to reconciliation. Never send it to an
     applier as an ordinary fix.

7. **Reconcile FOUNDATIONAL findings.** Only after the FOUNDATIONAL verdict, record a phase `reconcile`
   expectation and dispatch `finding-reconciler` once per finding. Record exactly one line:

   `RECONCILE: id=<id> outcome=<NEW|KNOWN|EXTENDS|UNSURE> target=<id|comma-separated-candidates|none>`

   Route every outcome exactly: NEW → file a new root item in `.agents/tasks/`, where
   [finding-depth.md](../../rules/finding-depth.md) says root items live; KNOWN → reuse the existing target without
   filing a duplicate; EXTENDS → update the target through the repository's normal item workflow with the new
   scope/evidence before reuse; UNSURE → halt and request a decision, naming the candidates. The reconciler
   never writes the registry. With a resolved root ID, choose the depth rule's disposition: labelled
   containment sends only the label instruction and ID to the side's applier and records `contained` with
   that target; re-plan records no resolved disposition, halts the loop, and reports the root item.
   Record the completed reconciliation route before disposition: NEW → `filed` with task path and exact
   filed evidence, KNOWN → `reused` with the existing target, EXTENDS → `updated` with task path and exact
   added evidence. UNSURE has no route record because it has not resolved a target.

8. **Re-audit.** Re-run the nested fanout on changed areas and the separate conformance channel in the next
   outer round. Repeat draft/final synthesis and routing. A contained claim returns contained, not as a new
   material finding. Record each round's final material count and the explicit disposition for every final
   material ID; corrected, contained under a resolvable root item, and recorded INVALID are the only resolved outcomes.
9. **Stop honestly.** Converge only when coverage is complete and every final material finding is resolved.
   Low findings remain in the report but do not keep the loop alive. If any prior final material finding set
   recurs, stop as no-progress and escalate. The outer loop is capped at three rounds; if distinct material
   sets remain after round three, close `bound-reached` and escalate. A re-plan or UNSURE route closes
   `halted-for-user`; an interrupted run closes `abandoned` rather than disappearing — and records a
   `checkpoint` naming the last phase it COMPLETED first, or the floor waives nothing. An audit-only run
   (not authorized to implement) stops after reconciliation: record `checkpoint --phase reconcile` and
   close `halted-for-user`; depth and reconciliation are then validated in full and only dispositions
   are waived. Every other terminal claims the whole loop and takes no checkpoint.

## Record the run

Before each dispatch, write its expected `(phase, agent, subject, token)` tuple; after it returns, record the
one exact terminal observation. Record pass-through, foundational, disposition, and nested-link metadata with
the canonical commands rather than editing JSONL directly:

```bash
node scripts/harness/loop-run.mjs open --loop architecture-refresh
node scripts/harness/loop-run.mjs expect --loop architecture-refresh --run <id> --phase <phase> --agent <agent> --subject <subject> --token <token>
node scripts/harness/loop-run.mjs observe --loop architecture-refresh --run <id> --phase <phase> --agent <agent> --subject <subject> --signal '<terminal-line>'
node scripts/harness/loop-run.mjs pass-through --loop architecture-refresh --run <id> --id <finding-id>
node scripts/harness/loop-run.mjs draft-finding --loop architecture-refresh --run <id> --id <finding-id> --severity <blocker|high|medium>
node scripts/harness/loop-run.mjs final-finding --loop architecture-refresh --run <id> --id <finding-id> --severity <blocker|high|medium>
node scripts/harness/loop-run.mjs foundational --loop architecture-refresh --run <id> --id <finding-id>
node scripts/harness/loop-run.mjs reconcile-route --loop architecture-refresh --run <id> --id <finding-id> --action <filed|reused|updated> --target <root-id> [--site <task-path>] [--evidence '<exact-task-evidence>']
node scripts/harness/loop-run.mjs disposition --loop architecture-refresh --run <id> --id <finding-id> --outcome corrected
node scripts/harness/loop-run.mjs disposition --loop architecture-refresh --run <id> --id <finding-id> --outcome contained --target <root-id> --site <claim-site-path> --evidence '<exact-claim-anchor>'
node scripts/harness/loop-run.mjs disposition --loop architecture-refresh --run <id> --id <finding-id> --outcome invalid --site <source-path> --evidence '<exact-source-fact>'
node scripts/harness/loop-run.mjs link --loop architecture-refresh --run <id> --nested-run <fanout-run-id>
node scripts/harness/loop-run.mjs checkpoint --loop architecture-refresh --run <id> --phase <opened|conformance|synthesize-draft|verify|synthesize-final|depth|reconcile|disposition>
node scripts/harness/loop-run.mjs round --loop architecture-refresh --run <id> --findings <final-material-count>
node scripts/harness/loop-run.mjs close --loop architecture-refresh --run <id> --terminal <converged|no-progress|bound-reached|halted-for-user|abandoned>
```

That is the whole skill. Landing follows the repository's normal gated flow after this loop returns.
