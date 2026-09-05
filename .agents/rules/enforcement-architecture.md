# Enforcement Architecture (worker / guardian / orchestrator)

How the harness makes a step actually happen — not "the model should," but a mechanism that fails loudly when
it doesn't. Every enforced process in this repo follows one shape. Parent: [process.md](process.md).

The live registry of every orchestrator/worker/guardian pipeline (at a glance, auditable, mechanically kept
current) is [.agents/specs/orchestration-map.md](../specs/orchestration-map.md).

## The three roles — strict division of labor

- **Orchestrator** — manages the PIPELINE ONLY. Runs stages in order; on a verdict it routes forward, or
  **rewinds** to an earlier stage. It performs no domain work and makes no quality judgment of its own — it
  routes purely on the verdict handed to it (and on machine-readable state such as a spec's `status:`
  frontmatter). Exemplar: `backlog-pipeline`.
- **Worker** — PRODUCES ONLY. One job (e.g. "write the spec", "research prior art"). Does not inspect its own
  output, does not judge, does not fix. Exemplars: `backlog-writer`, the `prior-art-researcher` agent.
- **Guardian** — JUDGES ONLY. Inspects a worker's output and returns a **structured, machine-actionable
  verdict** (e.g. `PASS | FAIL | NON-COMPLIANCE`) plus what is missing. It does not do the work and does not fix
  it. Exemplar: `backlog-gate-guard`.

A skill/agent that both produces and judges, or that judges and also routes, violates this rule. Split it.

## An orchestration skill stays thin

An orchestration skill may coordinate other skills as a pipeline, but it must stay thin:

- It may select and sequence skills.
- It may enforce gates, PR order, and verification checkpoints.
- It may record status and handoff points.
- It must not duplicate the detailed procedures of invoked skills.
- It must not absorb detailed behavior owned by the skills **or packages** it invokes.
- It must not redefine mandatory rules.
- It must delegate package-specific, testing, branch, writing, architecture, and verification work
  to the relevant owner skills.

[`harness-composition-design.md`](../specs/harness-composition-design.md) owns the artifact-kind
boundaries these bullets apply — which content is a rule, an orchestration skill, an agent, or a fact
catalogue.

This governs how skills are WRITTEN, not how a backlog item is executed, which is why it lives here.
The `or packages` clause belongs with it because it constrains skills; package-ownership statements
belong with the packages, in
[`.agents/project-structure.md`](../project-structure.md) § Implementation Owner Boundaries.

## Reliability comes from (verdict + a script), not from skill-tree depth

`.agents/skills/` are agent-invoked prose, not auto-firing, so **nesting skills more deeply does not make a
step more likely to run** (see [`.agents/memory/harness-mechanical-not-skilltree.md`]). Enforcement is real only
where **(a guardian emits a machine token) + (a `scripts/harness` scan or `.claude/hooks/` check reads it)**.
Therefore:

- **Every guardian MUST be backed by a mechanical floor** — a `pnpm harness:scan` FAIL condition or a hook — so
  the machine signal, not the model's discretion, is the floor. A prose-only guardian ("should check X") buys
  nothing; it is the failure mode this rule exists to prevent.
- **Never add a tier to gain reliability.** Depth buys no enforcement, so "make it a sub-skill so the step
  gets run" is always the wrong fix; the fix is a verdict plus a script.

**Nesting for responsibility separation is a different question, and it is sanctioned.** A phase of a
pipeline that is itself a pipeline SHOULD be its own orchestration skill — that is a composition decision
about who owns which ordering, governed by
[`harness-composition-design.md`](../specs/harness-composition-design.md), and it is expected rather than
exceptional. What this rule bans is nesting justified by _reliability_. The two are told apart by the
reason given: "a phase has its own ordering, or two callers would otherwise each carry a copy" is
responsibility separation; "wrapping it makes the agent more likely to do it" is the banned one.

## Loop-back is hybrid

On a guardian FAIL the orchestrator rewinds. Two shapes, both already in the repo, chosen by gate kind:

- **Auto-re-drive (completeness/quality gates)** — the orchestrator automatically re-runs the worker and
  re-checks, converging on a machine signal (the `architecture-refresh` shape: converge on
  `ACTIONABLE FINDINGS: 0`). Use for gates like prior-art research, spec completeness, and conformance,
  where "just make it complete" is unambiguous.

  **Two kinds of loop, and the bound that fits each.** What a round produces decides which bound can
  see it stuck, so the kind is declared rather than inferred.

  - **A loop over a FINDING SET** re-drives until the findings are gone. Its escape MUST be
    **no-progress detection**: if a round returns the same finding set unchanged, stop and escalate to
    the user. A max-iteration count is an OPTIONAL second bound and must never be the only one — a
    stuck loop and a productive one look identical to a counter and different to the finding set, so
    the counter is the weaker test.
  - **A loop over ATTEMPTS** retries one action that either succeeds or does not — re-cutting a base,
    re-running a phase, asking a person for a fresh credential. There is no finding set for a
    no-progress rule to compare, so a COUNT is the right bound and the only one available, and it MUST
    be stated as a number. Demanding an escape here would be a rule firing on a correct state.

  Every loop DECLARES its kind, in one line of its skill's frontmatter, so the population is
  established by a machine and not by a hand-kept list:

  ```yaml
  loop: over=finding-set; escape=no-progress; bound=2 rounds
  loop: over=attempt; bound=3 requests
  ```

  Enforced by `scan-loop-contract.mjs`, which reads that declaration, requires the skill's BODY to
  state the escape it declares — a declaration nothing implements is the dodge this repository has a
  separate floor about — and requires the orchestration map's Loop-back cell to agree with it.

  The PR-review loop runs with no count at all by owner directive; see
  [pr-finding-resolution-loop](../skills/pr-finding-resolution-loop/SKILL.md), which owns that decision and
  the evidence for it.

- **Halt-for-user (human-decision gates)** — the orchestrator stops and surfaces the verdict for the user to
  decide (the current GATE-APPROVAL shape). Use where a human sign-off is the point.

## A loop run is recorded

Run and round boundaries follow [execution-cadence.md](execution-cadence.md). A LOCAL edit or a
skill read is not a new run. Keep a running pipeline open across its related repair batch and
record the batch's actual result once; do not dispatch extra pipelines solely to create records.

A declaration says what a loop's escape IS. It cannot say whether the escape ever fired, and for as long
as nothing recorded a run, `escape=no-progress` was a claim no check could reach — the scan that requires
it reads only the tree, and a run is not in the tree.

**Every run of a loop-driving skill is recorded**, through
`node scripts/harness/loop-run.mjs`, into the skill's ledger under `.agents/loop-runs/` — one entry per
run, appended when it opens and sealed when it closes:

```bash
node scripts/harness/loop-run.mjs open  --loop <skill>
node scripts/harness/loop-run.mjs expect --loop <skill> --run <id> --phase <phase> --agent <agent> --subject <subject> --token <signal>
node scripts/harness/loop-run.mjs observe --loop <skill> --run <id> --phase <phase> --agent <agent> --subject <subject> --signal '<terminal-line>'
node scripts/harness/loop-run.mjs round --loop <skill> --run <id> --findings <n>
node scripts/harness/loop-run.mjs close --loop <skill> --run <id> --terminal <reason>
```

Three properties, and each exists because its absence collapses two states into one:

- **How a run ended comes from a CLOSED vocabulary** — `converged`, `no-progress`, `bound-reached`,
  `halted-for-user`, `abandoned` — never inferred by a reader. A terminal reason the skill's declaration
  cannot reach is refused: recording `no-progress` for a loop that declares no such escape is a record
  describing some other loop.
- **A run that stopped without reaching an ending is closed as `abandoned`**, not left open and not left
  out. Not-closed is a STATE, not an absence; this is § "Silence is not success" applied to the record
  itself, because a dropped run and a run that never started are otherwise the same silence.
- **The round count is not stored.** `roundFindings.length` is the count, everywhere. A second stored
  number is a second source, and two sources agree until the day the number is needed
  ([measurement-provenance.md](measurement-provenance.md) clause 1).

The ceiling, stated rather than implied: a run that is never opened leaves no line, and nothing that reads
this tree can see it. This rule makes a run recordable and its record coherent; it does not prove that
every run was recorded.

Enforced by: `scripts/harness/scan-loop-run-records.mjs`, registered as `loop-run-records`. It refuses a
ledger naming no loop-declaring skill, a line that does not parse, a terminal reason the declaration
cannot reach, and a run left open past seven days.

Pipelines whose guardians declare runtime signal contracts also record every expectation **before**
dispatch and exactly one matching observation afterward. Pipeline-owned scans validate the payload and
route metadata because the canonical ledger owns persistence while each pipeline owns the meaning of its
signals. For architecture audit, `architecture-refresh-signals` fails on silence, duplication,
misattribution, malformed counts, missing verifier pass-through, incomplete foundational reconciliation,
or an unresolved material disposition. A nested fanout is linked to its outer run with `loop-run.mjs link`;
that link is evidence of composition, not a replacement for either ledger.

A retired agent definition must also become unreachable from every live instruction that could still dispatch
it. The `retired-agent-references` scan enforces that retirement boundary while preserving only exact,
fingerprinted provenance records; deleting the definition alone is not completion.

## Applying it to a new enforced step

1. Name the **worker** (produces the artifact), the **guardian** (judges it, emits a verdict), and the
   **orchestrator** (routes on the verdict). Keep them separate.
2. Give the guardian a **mechanical floor** (a scan/hook) — not just a prose criterion.
3. Choose the **loop-back kind** (auto-re-drive vs halt) by whether the gate is completeness or human-decision.
4. Reuse the `backlog-pipeline` / `backlog-gate-guard` shape: an orchestrator that only routes, a worker
   that only produces, a guardian that only judges. Add a tier only when a phase owns its own ordering
   (see the nesting note above) — never to make a step more likely to run.

## Three questions a guard must answer

In this order. The first two were already asked here; the third is what four independent audits added.

1. **Can it fail?** — a check with no failing input is a check that has never been run.
   (`scan-main-required-checks`.)
2. **Does it check the right thing?** — a check that fires on the wrong subject is not a weaker check,
   it is a different one. (`.agents/memory/check-validity-two-axes.md`.)
3. **Is it REACHED — by the real invocation, in the real environment?**

A test that supplies the condition itself, an entry point nothing calls, and a matcher no real command
hits all pass 1 and 2 and fail 3. Each has been measured here:

- A guard anchored its match to the start of the command while every real command begins by changing
  directory first, so every invocation in a long session bypassed it silently.
- A guard gated itself on an environment variable exported by nothing but its own tests, so it exited
  on its first line in every real session while ten tests stayed green.
- An entry point named itself the CI-equivalent gate and was invoked by nothing.

So a guard lands with a case that RUNS it as a real invocation would, supplying only what a real
session supplies.

## Two more properties, measured

Both are about what a guard does when it is NOT blocking, which is almost all of the time, and
neither is visible in a suite of negative cases.

**4. Does it leave correct work alone, silently?** A guard that fires on a correct, desirable state
is a defect of the same severity as one that misses a violation. Measured over four days: an 88%
false-positive rate on the one-branch-at-a-time check (83 reported, 73 already merged), reflex-
overridden twice in one session by its own author; a promotion gate that read the debt being PAID as
a violation and blocked every promotion; a scan that blocked the release gate twice, once on a
message discussing its own false positive; two parser defects that refused the creation of the
branch their own fix lived on.

Silence is part of it, not a nicety. A guard that narrates on the happy path is one everyone learns
to scroll past, after which its refusals scroll past too — and a probe that measures the narration
is measuring a print rather than a verdict, which is how one reachability test stayed green over a
hook that decided nothing.

Floor: `guards-pass-silently.test.mjs`. Every hook that carries an operator-facing `Blocked:` line
must have at least one row stating an ordinary, correct invocation that passes with exit 0 and no
output. A hook that speaks by design declares it with a reason.

**5. Does it refuse what it cannot read?** "I could not verify" is not "I verified this is OK". An
empty count, an unset variable, an absent decoder, a non-matching `grep` under `set -e` — each has
produced a pass here, and the `.mjs` scans had a floor for it while the shell layer, where every
instance was, did not.

Floor: `guards-fail-closed.test.mjs`. A hook that judges refuses an unreadable payload; a hook that
only reminds or formats may stand down, because demanding a refusal from it would be property 4
violated. Which kind a hook is, is read from the hook itself.

### Silence is not success — the rule, for every layer

**Owner directive. This binds every skill, every hook, and every GitHub Action step, not only the
shell guards above.**

> When something goes wrong, do not complete quietly. Say what went wrong, and stop the flow.

Three states must stay distinguishable, and collapsing the third into the first is the defect:

1. **I checked, and it is fine.** → pass, silently (property 4).
2. **I checked, and it is not.** → refuse, naming what failed.
3. **I could not check.** → **refuse, naming what could not be read.** Never a pass, and never a
   refusal wearing the wrong reason.

**The price of getting this wrong has been measured.** A review action that could not mint a token
printed a skip line and exited 0: **100 of 100 green runs, 13–21 s each, reviewing nothing**. A
hundred pull requests merged past a check that reported success without asking anything, and nothing
announced either edge of the window.

Concretely, in each layer:

- **A hook** that cannot decode its payload, cannot resolve the repository, or cannot reach `gh`
  refuses with `Blocked:` and the reason. `branch-guard` and `merge-gate` do this in two independent
  places each — neutralising one leaves the other refusing, which is what defence in depth looks like
  when it is real.
- **An Action step** that cannot read what it judges must `::error::` and exit non-zero.
  `|| echo ""`, `|| echo 0` and `|| echo '[]'` turn "unreadable" into "empty", which reads exactly
  like a legitimate answer. Where a sentinel is used instead, it must be a DISTINCT one the consumer
  refuses on — `UNAVAILABLE`, not `[]`.
- **A skill** that cannot complete a step reports the step it could not complete and halts, rather
  than converging on a count it never earned.

**The reason must be the real one.** A push stopped for a reason that was not the reason costs the
next reader the whole debugging trail: they fix what the message named, re-run,
and get the same refusal. A guard that cannot read its input says so, in those words.

Floors: `guards-fail-closed.test.mjs` covers the hook layer, including a `gh` that cannot
authenticate — the token condition above. An Action step is not mechanically covered
yet; when one is added, its `|| echo` fallbacks are the first thing to read.

**6. When its enumeration is incomplete, which way does it fail?** A guard that decides by a LIST
of recognised inputs answers "not my business" to everything the list forgot — and that answer is
silent. A guard that decides by a list of EXCLUDED inputs answers "mine" instead, and a mistake
becomes a refusal someone sees, argues with, and fixes.

The two directions are not equally wrong. A silent pass is discovered by the incident it failed to
prevent; a wrong refusal is discovered by the next person who runs the command, and it has an
override. So **enumerate what is excluded, not what is recognised** — and where the domain has a
grammar rather than a vocabulary (command flags, URLs, versions), match the SHAPE and let the
exclusions carry the semantics.

Measured: one guard widened by an allowlist of flag tokens leaked three separate bypasses in a single
change — a flag the list omitted, the `=` form of a flag it contained, and bundled short options —
each of them a silent pass, each found by review rather than by the guard. Adding the missing tokens
would have been the fourth attempt at the same mistake. Inverting the direction ended it.

Floor: `guards-declare-their-failure-direction.test.mjs`. Every judging hook declares
`fail-direction: refuse|permit — <reason>`, so the direction is a statement someone made rather than
a property a reader has to reconstruct from the matcher. The floor checks the DECLARATION, not the
direction itself: which way a given regex fails is not decidable by a machine, and a check that
claimed to decide it would be the silent-pass shape this property is about, one level up.

The cost is real and must be paid explicitly: an exclusion list that forgets an entry refuses correct
work, so each entry earns its place and the refusals get their own cases. That cost is the point —
it is visible, and the alternative is not.

The two pull against each other on purpose. Property 5 alone produces a guard that refuses
everything; property 4 alone produces one that permits everything. A guard is correct only when both
hold, and each needs its own case. `hooks-have-execution-coverage` is the mechanical floor for question 3 in
`.claude/hooks/`: a hook no test executes fails it. Whether the environment a case supplies is one a
real session has remains judgement — state, beside the case, which signal it depends on and who sends
it.
