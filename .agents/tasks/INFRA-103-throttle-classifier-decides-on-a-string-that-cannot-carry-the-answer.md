---
title: 'INFRA-103: review-gate blocks on a 422 from a GET that cannot fail validation, and the cause is not yet established'
status: todo
created: 2026-08-17
priority: high
urgency: soon
area: scripts/harness, .github/workflows
depends_on: []
---

# INFRA-103: a 422 nobody can explain, blocking a fail-closed gate

Measured 2026-08-17 on two pull requests in a row (#1843, #1845). Both were blocked by `review-gate`
with `labels-unavailable`, and the cause was neither PR's contents.

**This item records a measurement and an open question. It does not prescribe a fix, because the
cause is not established** — and a harness item that names a fix for a cause it guessed is how the
next person inherits a confident wrong answer.

## What was observed

`scripts/harness/github-api.mjs` read the PR's labels and got:

```
repos/woojubb/robota/issues/1843/labels: `gh api` failed (exit 1): gh: Validation Failed (HTTP 422)
```

Four facts, each checked rather than assumed:

1. **A plain `GET .../issues/{n}/labels` has nothing to validate.** There is no request body and no
   filter parameter; `per_page=100` is within range.
2. **The identical command succeeds from a developer machine**, against the same endpoint and the
   same PR numbers, exit 0, returning `[[]]`.
3. **The same code passed fifteen minutes earlier.** Every `review-gate` run at 13:15 and before
   that day succeeded; every run from 13:30 on failed this way.
4. **The account was being throttled elsewhere in the same minutes.** The runner's own action
   download was told `429 (Too Many Requests)` on `codeload.github.com`, retried twice, and gave up.

## What is NOT established

That fact 4 explains facts 1–3. It is suggestive and it is not proof. `gh` prints the API's own
`message` field, so `Validation Failed` is what GitHub actually said — not a summary that swallowed a
throttle notice. A secondary rate limit normally says so in that field.

So one of these is true, and the item is open until someone knows which:

- GitHub answers some throttled reads with 422 and a generic message.
- Something about the request differs under `GITHUB_TOKEN` in a way that is genuinely invalid.
- Unrelated GitHub-side incident that happened to coincide.

## The correction this item exists to prevent

The first draft of this file asserted the throttle explanation and prescribed "capture the response
body so the classifier can see it". That was wrong twice over: the cause was not established, and
`gh` already surfaces the body's message, so the classifier is not blind — the message simply does
not say "rate limit", because GitHub did not say it.

**Do not add `422` to `isRateLimited`.** A 422 genuinely means "invalid request" on endpoints that
validate input. Treating every one as retryable turns a permanently malformed request into three
attempts with sixty-second sleeps between them — a hang, reported at the end as a rate limit that
never existed. That is being confidently wrong in the opposite direction, which is not an
improvement.

## What the gate did right, and must keep doing

`review-gate` refused to report a pass it could not compute, and said so on the PR. That is correct
and is not what this item is about. The cost is that its accurate message — _"the labels could not be
read, so the acknowledge override can be neither ruled in nor ruled out"_ — sends the reader looking
at labels, tokens and permissions, none of which turned out to be involved. Whatever the cause, the
gate should be able to say more than that the read failed.

## First step for whoever takes this

Reproduce with the response fully captured (`gh api -i`, or the REST call directly with the
`GITHUB_TOKEN`) so the status line, the `x-ratelimit-*` headers and the body are all visible at once.
Every option worth considering depends on knowing which of the three explanations holds, and none of
them can be chosen from what is currently in the log.

## Test Plan

Deferred until the cause is known. Writing a test now would pin the behaviour of a guess.

What is already true and should be preserved by any change: `readWithBackoff`'s `runner` seam is
injected, so all four response shapes (throttled-with-headers, throttled-without, genuinely invalid,
and no body at all) can be driven with no network and no real throttle.

## User Execution Test Scenarios

Not applicable yet — there is no delivered behaviour to demonstrate. When the cause is known, the
observable is a harness read that waits out a throttle instead of failing, and fails immediately on a
request that is actually malformed.
