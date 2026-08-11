# A wait is not idle time — the scheduling cost the session was paying without naming it

## STATUS: owner directive 2026-08-05; rule landed in `.agents/rules/operational.md`

In-repo mirror (memory-mirroring rule). Host mirror: `wait-is-not-idle-time`.

## The directive

> 대기 시간이 있을때 다른 잔여 백로그를 선택해서 워크트리에서 병렬로 처리하면 좋다. 지금 순차적으로
> 하다보니 너무 오래걸린다.

The rule this became is owned by [`operational.md`](../rules/operational.md) §
"A Wait Is Not Idle Time"; the procedure by
[`worktree-parallel-orchestration`](../skills/worktree-parallel-orchestration/SKILL.md). **Neither is
restated here** — this file records the measurement, which the rule may not carry.

## What it cost, measured

A stretch of harness work ran four pull requests strictly one after another. A review round takes
eight to ten minutes of waiting, and each of the four took between three and six rounds. Over two
hours of the session was spent blocked — while **71 independent backlog items were open the whole
time**.

Nothing about that was a capacity limit. Every one of those waits was a round trip the agent could
not shorten and was not permitted to skip, and the agent chose to spend each of them doing nothing.

## Why it was invisible from inside

Each individual wait looks correct. The round loop must run to zero findings, the review is not
mine to hurry, and there is nothing to fix until it arrives — so every single decision to wait was
defensible on its own terms. The cost only appears when the waits are added up, which nothing in the
loop does.

That is the shape worth remembering: **a defensible local decision, repeated, becoming an indefensible
global one.** The owner saw the total before the agent did, from outside, by noticing elapsed time.

## The trap when applying it

"Independent" is stricter than the backlog's numbering suggests. Two harness items that both move an
adoption ratchet, edit the same registry, or touch the same rule document are ONE item — they will
collide at the baseline even when their subjects are unrelated. See
[`check-validity-two-axes.md`](check-validity-two-axes.md) for the neighbouring lesson about harness
changes overlapping more than they appear to.

## Two frictions the first parallel run actually hit

Recorded because both are silent, both cost a CI round trip, and neither is visible until the work is
already in a worktree.

**1. Committing from inside the worktree is refused; committing with `git -C` skips the hooks.**
`branch-guard` resolves the repository from `git -C <path>` before the project dir — but it reads the
command as TEXT, so `git -C "$WT" commit` hands it an unexpanded variable, falls back to the project
dir, and refuses the commit for being on whatever branch the MAIN checkout sits on. Passing the
literal path works. But a `git -C` commit run from outside the worktree does not fire the repository's
`lint-staged` pre-commit, so `prettier` never runs and the required `format-check` job goes red on
files the local flow would have fixed silently.

Until the shell-aware extraction lands (HARNESS-061), the working combination is: **literal path in
`git -C`, and run `prettier --write` over the changed files yourself before committing.**

**2. A fresh worktree has no `node_modules`.** Every scan and test fails in ways that look like real
findings — eleven scans "failed" on the first run purely for that. `pnpm install --frozen-lockfile
--ignore-scripts` first, in the background while something else proceeds, and remember that the
`dist`-dependent scans still need a build (CI's own `scans` job skips them for the same reason).
