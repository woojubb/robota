---
title: 'INFRA-069: pre-push runs 0 of 81 scans for a source change, while `scans` is required'
status: done
completed: 2026-08-04
priority: high
urgency: soon
type: INFRA
area: scripts/harness, .husky
created: 2026-07-28
depends_on: [INFRA-066]
---

# INFRA-069 — the required `develop` gate has no local mirror

## Problem

`scans` is a **required** context on `protect-develop`. Measured: `harness:pre-push` never invokes
it — `grep -c "run-all-scans\|harness:scan" scripts/harness/pre-push.mjs` returns **0**. It runs
`harness:plan`, `harness:verify` and a CLI smoke, and that is all.

What the plan actually selects, measured through `createVerificationPlan`:

| Changed file                       | Repository checks selected                          |
| ---------------------------------- | --------------------------------------------------- |
| `packages/agent-core/src/index.ts` | **none**                                            |
| `package.json`                     | **none**                                            |
| `README.md`                        | `repository-review` — which has no executable check |
| `scripts/harness/**`               | 1 scan                                              |
| `.agents/rules/**`                 | 2 scans                                             |

So a package source change is pushed having run **zero** of the 81 scans that must pass on the PR.

The declared local mirror, `verify-like-ci`, is **invoked by nothing** — not `.husky/pre-push`, not
`pre-push.mjs`, not any workflow — and appears in 1 rule file and 0 skills, against `harness:scan`'s
11 rules and 13 skills. The thing people are told to run is not the thing that mirrors CI.

This is the same shape that cost two promotion round trips on `protect-main` (`INFRA-066`), sitting
unnoticed on `develop` the whole time.

## The cost was assumed, and the measurement dissolved the decision

This section used to say the item needed a decision about what the local gate should cost, on the
reasoning that a slow pre-push gets bypassed with `--no-verify`. Measured on 2026-08-04, on the
machine that runs it:

| Command                                                   | Wall clock                                  |
| --------------------------------------------------------- | ------------------------------------------- |
| `pnpm harness:scan -- --skip dist --skip build-contracts` | **6 s** (5 984 ms / 5 880 ms over two runs) |
| `pnpm harness:test`                                       | **54 s**                                    |
| both, the whole required `scans` job                      | **~60 s**                                   |
| one CI round trip that would have found the same thing    | **5–6 min**                                 |

At a minute there is no trade-off to make, so no subset had to be invented and there was nothing to
ask. The option list below it — dist-independent subset, path-selected scans, full-suite-with-opt-out
— was three ways to spend effort avoiding a cost that turned out not to exist. Worth keeping as the
shape of the mistake: the item spent more words deliberating the price than it took to measure it.

## Done when

- A package source change runs a defined, non-empty set of the required scans before push, and the
  set is stated where a reader will find it.
- The measured wall-clock cost of that set is recorded, so the choice is defensible rather than
  assumed.
- `verify-like-ci` is either invoked by something or stops being described as the CI-equivalent
  entry point — a name with no caller is what made this invisible.
- Proven RED: a change that would fail a required scan is blocked locally before it reaches CI.

## Resolution

`pre-push.mjs` runs the required `scans` context before every push, through an exported
`CI_SCANS_JOB_MIRROR` that carries the workflow's own flags (`--skip dist --skip build-contracts`).
The flags are not a detail: running MORE locally than CI does would refuse pushes CI accepts, which
is the guard property 4 violation that earns a gate a habitual `--no-verify`.

`pre-push-mirrors-ci-scans.test.mjs` READS the `scans` job out of `ci.yml` and requires the local
list to contain every command it runs. Read rather than restated — a hand-copied list agrees on the
day it is written and stops agreeing silently, which is exactly how `verify-like-ci` came to be
described as the CI-equivalent entry point while being invoked by nothing.

Red-proved in both drift directions: emptying the mirror fails on `the required scans job runs
pnpm harness:test and pre-push does not`; dropping the `--skip` flags fails naming the full command.

**Agent-run evidence for the done gate.** A broken link was planted in a live document, committed
(through the real hooks, no `--no-verify`), and the gate run as git invokes it:

```
$ echo "refs/heads/x $SHA refs/heads/x 000…0" | pnpm harness:pre-push
GATE EXIT = 1
 FAIL  scripts/harness/__tests__/scan-resolving-claims.test.mjs > finds the live tree at zero
 +     "kind": "link-names-nothing",
```

The push was refused locally, naming the violation, without a CI round trip. Standalone, the scan
step refuses the same change with `[link-names-nothing] … -> ./this-file-does-not-exist-infra-069.md`.

### One claim in the self-review was wrong, and the push disproved it

The recorded local review said `harness:test` here is "not a duplicate of the scope-selected package
tests `harness:verify` already runs". Then the real push printed `Tests 2672 passed` TWICE — once
under `harness:verify`, once under the mirror. For a change inside `scripts/harness` the scope
selection picks the harness suite, so the two overlap exactly and 54 s of the 119 s push was spent
running it a second time.

The claim is right for the case the item was filed about — a change under a package's `src` selects
that package's tests and never the harness suite — and wrong for the case I was actually pushing. It
is kept rather than quietly corrected because the shape recurs: a property checked against the
scenario in the argument rather than the one in front of me.

Left as measured, not fixed. Deduplicating means the local gate stops being a literal mirror of the
required job, and the mirror being literal is what the drift test enforces. 54 s on harness-scoped
pushes is the price; if it becomes the reason someone reaches for `--no-verify`, that is the signal
to revisit, and this paragraph is the record that it was a choice.

Not closed by this item: `verify-like-ci` still has no caller. It is no longer the ONLY declared
mirror — the gate now runs the required job directly — but the name-with-no-caller half of the
problem stands, and belongs with INFRA-066 where required-check runnability is owned.
