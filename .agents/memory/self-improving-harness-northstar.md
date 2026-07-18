# Self-improving automated harness — north-star

Owner's standing goal (2026-07-16), the direction for all harness work:

> robota must ALWAYS run the correct development process inside an AUTOMATED harness, and the harness itself
> must SELF-IMPROVE so it continuously makes robota better and better (a compounding loop).

**Decoded into a control loop** (the architecture the goal implies):

- **SENSE** — measure whether the correct process actually fired (which skill/gate ran per request class).
  Today the repo has outcome metrics (`.agents/evals/local-metrics/`: reverts, corrections, sessions) but **no
  firing/routing-correctness signal**.
- **ENFORCE** — mechanical dispatch that guarantees the right process runs (blocking/evidence-checked hooks),
  not model-prose discretion. Today only ~2 of ~15 request classes have any mechanical dispatch, inject-only.
- **IMPROVE** — a closed compounding loop: SENSE + reverts/corrections → detect where the process failed or
  where robota could be better → institutionalize via `lesson-to-harness` → gated fix → re-measure. Each cycle
  the harness AND robota get better.

**Ordering:** you cannot claim "always correct" or "self-improving" without measurement — an unmeasured harness
change is unfalsifiable. SENSE lands first, then ENFORCE, then the IMPROVE loop closes on top.

**Vehicle:** epic `HARNESS-017` (`.agents/spec-docs/` — `type: INFRA`; HARNESS is the ID namespace, not a valid
`type:`). Phases P1 sense → P2 enforce → P3 route-only refactor → P4 mechanize prose gates → P5 close the loop.
Goes through robota's own spec-gate; GATE-APPROVAL runs independent proposal-reviewer.

Related: `harness-mechanical-not-skilltree.md`; existing self-sync loops the IMPROVE phase should absorb, not
duplicate (`documentation-refresh`, `architecture-refresh`).

_Mirror of session/host memory per `../rules/memory-mirroring.md`._
