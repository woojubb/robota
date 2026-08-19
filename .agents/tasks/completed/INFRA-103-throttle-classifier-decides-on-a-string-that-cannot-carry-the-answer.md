---
title: 'INFRA-103: a GitHub outage read as a repository defect — three wrong diagnoses before anyone checked whether GitHub was up (one residual unexplained)'
status: done
created: 2026-08-17
completed: 2026-08-17
priority: high
urgency: soon
area: scripts/harness, .github/workflows
depends_on: []
---

# INFRA-103: the answer was a status page, and it was asked last

Registered as [issue #1846](https://github.com/woojubb/robota/issues/1846).

On 2026-08-17, three pull requests in a row (#1843, #1845, #1848) were blocked by `review-gate` with
`labels-unavailable`. The read that failed was `GET /repos/{o}/{r}/issues/{n}/labels`, answering
`Validation Failed (HTTP 422)` — a status that endpoint has nothing to produce, since there is no
request body and no filter to validate.

## The cause

**A GitHub incident**, on the evidence available. Opened 13:40 UTC, impact critical, roughly **20%
error rates on web and API traffic**, with API Requests, Actions, Issues and Pull Requests all
degraded. The first failure here was at 13:30; every run at 13:15 and earlier passed.

No change in this repository was involved, and nothing here needed fixing. The incident does not
account for the failure's PERSISTENCE, which is set out below rather than smoothed over.

## Why this is recorded as a task rather than closed as noise

Because of how long it took, and because the shape is one that will recur. An outage does not arrive
labelled; it arrives as your own tooling failing in a way that looks specific to you. Every step
below was a reasonable-sounding inference from real evidence, and every one was wrong.

| #   | Diagnosis                                                          | What killed it                                                                                                                     |
| --- | ------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------- |
| 1   | A throttle, hidden because `gh` does not surface the response body | `gh` DOES surface it — `Validation Failed` is GitHub's own `message` field                                                         |
| 2   | The job lacks `issues: read` while reading an Issues-API endpoint  | The same permissions and workflow revision succeeded fifteen minutes earlier                                                       |
| 3   | The reader's `--slurp`/`per_page` flags are the difference         | Inferred from ONE job where the plain call passed and this one failed — one sample, during an outage. **Not disproven**; see below |

Diagnosis 2 was one command from being committed. What stopped it was checking the last passing run
rather than the failing one.

## What the incident does NOT explain, kept open rather than tidied away

The incident reports "approximately 20% error rates". The failure here is **not 20% and not random**:

- In CI it has failed on **every** run from 13:30 onward — six consecutive `review-gate` runs across
  three PRs, over roughly an hour.
- From a developer machine the identical call succeeded **six times out of six** in that same window.
- At 13:19, in CI, with `CODE_CHANGED: true`, the same reader read the same endpoint and the gate
  reported `PASS (clean)`.

A uniform 20% error rate does not produce that. Two possibilities remain, and this item is closed
without choosing between them because neither is actionable from inside the repository:

1. The incident is not uniform — a specific backend or path is failing much harder than the headline
   aggregate, and the Actions token's route hits it.
2. Something about this call shape genuinely fails under the CI token, and the incident is a
   coincidence that merely started at the same minute.

The one observation that would separate them is the one still unexplained: inside a SINGLE job, the
plain `gh api --paginate` read of the labels succeeded while this reader's call failed seconds later.
That is one sample and it was taken during an outage, so it proves nothing on its own — but it is
also not dismissible, and calling it a coin toss (as an earlier draft of this file did) was reading
the evidence to fit the conclusion. If the failure outlives the incident, start there.

## What was nearly shipped, and must still not be

**Adding `422` to `isRateLimited`.** It would have turned a permanently malformed request into three
attempts with sixty-second sleeps — a hang, reported at the end as a rate limit that never existed —
and it would have been shipped on the strength of an outage. `isRateLimited` declining to retry a 422
that was not a rate limit is the behaviour working, not the bug.

## What DID come out of it, and is worth keeping

The error message could not answer "which flags, which `gh`", and answering that by hand is what cost
the time. [#1848](https://github.com/woojubb/robota/pull/1848) adds both to the failure path only.
That lands as an ordinary improvement — **not** as a fix, because there was no defect.

Note for whoever reads that change: `review-gate` executes its decision modules from
`github.event.pull_request.base.sha` by design, so a diagnostic added in a PR does not run on that
PR. It takes effect once merged.

## The lesson, stated as the check to run first

**When a read that has always worked starts failing, and it still works from a developer machine,
ask whether the service is healthy BEFORE asking what changed in the repository.** It costs one
request. Here it was asked after three hypotheses, two near-commits and several hours, and it
answered immediately.

## Test Plan

None. There is no behaviour in this repository to pin — the cause was external, and the one code
change that came out of it carries its own tests in #1848.

## User Execution Test Scenarios

Not applicable: nothing user-facing changed. The verification that mattered was reading
`githubstatus.com`, which is what closed this.
