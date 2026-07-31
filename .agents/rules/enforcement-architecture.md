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

Relocated from `backlog-execution.md` (HARNESS-049): the rule governs how skills are written, not how a
backlog item is executed. The `or packages` clause is that section's fourth Layering-Rule bullet, folded
in here because it constrains skills; the other three were package-ownership statements and moved to
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
  `ACTIONABLE FINDINGS: 0`). Bounded by a max-iteration count, then escalate to the user. Use for gates like
  prior-art research, spec completeness, and conformance, where "just make it complete" is unambiguous.
- **Halt-for-user (human-decision gates)** — the orchestrator stops and surfaces the verdict for the user to
  decide (the current GATE-APPROVAL shape). Use where a human sign-off is the point.

## Applying it to a new enforced step

1. Name the **worker** (produces the artifact), the **guardian** (judges it, emits a verdict), and the
   **orchestrator** (routes on the verdict). Keep them separate.
2. Give the guardian a **mechanical floor** (a scan/hook) — not just a prose criterion.
3. Choose the **loop-back kind** (auto-re-drive vs halt) by whether the gate is completeness or human-decision.
4. Reuse the `backlog-pipeline` / `backlog-gate-guard` shape: an orchestrator that only routes, a worker
   that only produces, a guardian that only judges. Add a tier only when a phase owns its own ordering
   (see the nesting note above) — never to make a step more likely to run.

## Three questions a guard must answer (PROC-003)

In this order. The first two were already asked here; the third is what four independent audits added.

1. **Can it fail?** — a check with no failing input is a check that has never been run.
   (`scan-main-required-checks`, INFRA-055.)
2. **Does it check the right thing?** — a check that fires on the wrong subject is not a weaker check,
   it is a different one. (`.agents/memory/check-validity-two-axes.md`.)
3. **Is it REACHED — by the real invocation, in the real environment?**

A test that supplies the condition itself, an entry point nothing calls, and a matcher no real command
hits all pass 1 and 2 and fail 3. Each has been measured here:

- `pre-push-check` matched with a `^` anchor while every command begins `cd <repo> && …`, so every push
  in a long session bypassed it silently (#1510).
- `worktree-cwd-guard` gated on `ROBOTA_AGENT_WORKTREE`, exported by nothing but its own tests, so it
  exited on its first line in every real session while ten tests stayed green (INFRA-068).
- `verify-like-ci` named itself the CI-equivalent entry point and was invoked by nothing (INFRA-069).

So a guard lands with a case that RUNS it as a real invocation would, supplying only what a real
session supplies.

## Two more properties, measured (2026-08-01)

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

The two pull against each other on purpose. Property 5 alone produces a guard that refuses
everything; property 4 alone produces one that permits everything. A guard is correct only when both
hold, and each needs its own case. `hooks-have-execution-coverage` is the mechanical floor for question 3 in
`.claude/hooks/`: a hook no test executes fails it. Whether the environment a case supplies is one a
real session has remains judgement — state, beside the case, which signal it depends on and who sends
it.
