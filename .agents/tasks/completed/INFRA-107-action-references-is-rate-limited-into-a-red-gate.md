---
title: 'INFRA-107: action-references probes an anonymous endpoint, so a shared CI address turns it red'
status: done
created: 2026-08-19
completed: 2026-08-20
priority: high
urgency: now
area: scripts/harness
depends_on: []
---

# INFRA-107: verify an action manifest over the authenticated API, not an anonymous one

## Objective

`action-references` confirms that every pinned action SHA carries a real manifest. It reads that
manifest from `raw.githubusercontent.com` with an unauthenticated `fetch`. That endpoint is
rate-limited per source address, GitHub-hosted runners share their egress addresses, and the scan is
fail-closed by design — so when the address is over budget the gate goes red for a reason no change
to this repository can affect.

Observed on the pull request for INFRA-105, on two consecutive runs of the same unchanged workflow
files:

| run   | findings               |
| ----- | ---------------------- |
| first | 2, both `HTTP 429`     |
| rerun | **15**, all `HTTP 429` |

The rerun being worse is the shape that matters: a retry does not recover the budget, it spends more
of it. The scan's own message is right that "unreachable is a failure, not a skip" — the defect is
not the verdict, it is asking a question over a channel that cannot answer it.

## Measured, not assumed

| probe                                                                 | result                                                          |
| --------------------------------------------------------------------- | --------------------------------------------------------------- |
| authenticated `repos/{o}/{r}/contents/action.yml?ref={sha}` — present | `200`, manifest metadata returned                               |
| the same, absent path                                                 | clean `404 Not Found`                                           |
| authenticated core budget                                             | **4,982 / 5,000 per hour**                                      |
| anonymous `raw.githubusercontent.com`                                 | serves the file, and publishes **no** rate-limit headers at all |

So the authenticated endpoint gives exactly the two answers this scan needs — present and absent —
carries a budget large enough for a workflow tree of this size many times over, and unlike the
anonymous one it _reports_ what is left, which is the difference between a limit that can be
diagnosed and one that can only be suffered.

## Approach

Probe through `gh api`, the runner this harness already uses everywhere else, so the request is
authenticated by construction and `readWithBackoff` — which already reads `retry-after` and
`x-ratelimit-reset` and fails closed after a bounded wait — applies unchanged. A second network path
with its own retry rules would be a second place for this to go wrong.

A 404 must stay a NEGATIVE ANSWER and not an error: "this SHA has no manifest" is the finding the
scan exists to report, and collapsing it into the transport's error channel would turn a real finding
into an outage report.

## Plan

- [x] TC-01: a present manifest resolves through the authenticated probe.
- [x] TC-02: an absent manifest returns "no manifest" — a finding, not a thrown error.
- [x] TC-03: a rate-limited response is retried on the delay the API names and, past the bound, fails
      closed with a message saying it is a budget to wait out.
- [x] TC-04: a transport error that is NOT a 404 and NOT a rate limit still fails closed.
- [x] TC-05: the reusable-workflow reference form (whose subpath IS the manifest) still resolves.
- [x] TC-06: `pnpm harness:scan` and the harness unit tier are green.

## Test Plan

The probe takes its runner by injection, so every case above is driven against a stubbed runner
returning the exact status the real endpoint returns — including the two that cannot be produced on
demand against the live API, a 429 and a transport failure. Both directions for each: the answer is
asserted AND the failure is asserted, because a probe that can only succeed is one nobody has shown
can report a missing manifest.

## Progress

### 2026-08-19

Measured both endpoints before changing anything; the table above is that measurement. The live
probe then confirmed both directions against the real endpoint: `action.yml` at that SHA reads
`true`, `nope.yml` reads `false` — a value, not a thrown error.

One defect the first cut carried, and it is the same one this item is about, one layer down. A killed
runner reported `gh exited null`, which names neither the cause nor the remedy — the exact shape of a
failure that cannot be acted on. `describeExit` now distinguishes a spawn error, a signal, and a
missing status, and it earned its keep immediately: a flaky local connection produced `gh could not
run: spawnSync gh ETIMEDOUT`, which is a diagnosis rather than a mystery.

Red-proofed one at a time: treating a 404 as an error fails exactly the negative-answer case,
removing the rate-limit retry fails exactly two, and restoring the old exit message fails exactly
one.

NOT caused by this change, recorded so the next reader does not re-derive it: five hook tests
(`hook-command-parsing`, `branch-guard-aliases`) time out at ~10s each while the local connection is
dropping. Measured with this change STASHED, on `origin/develop` alone: the same tests fail the same
way.
