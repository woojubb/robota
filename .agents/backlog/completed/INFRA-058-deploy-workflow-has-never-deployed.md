---
id: INFRA-058
title: deploy.yml has never deployed anything — decide whether it should exist
status: done
priority: medium
type: INFRA
created: 2026-07-26
completed: 2026-07-26
---

# INFRA-058: `deploy.yml` has never once deployed, in 100+ runs over 8 months

## The decision this needs

Delete `.github/workflows/deploy.yml`, or rebuild it deliberately. **This is filed rather than
executed because removing a deployment surface is the owner's call, not an auditor's.** The
recommendation is deletion, and the evidence is below.

## Why it fails

```
##[error]Unable to resolve action vercel/action, repository not found
```

The `vercel/action` repository does not exist. It never did — Vercel has never shipped a
first-party GitHub Action under that name. So the `build` job dies at **`Set up job`**, before a
single step runs. This is not a regression; it is the workflow's permanent state.

## Why nobody noticed

The failure is invisible from every angle someone would look from:

- The job dies at runner setup, so there is no failing _step_ to read — `--log-failed` returns only
  the provisioner banner.
- The two `success` runs in the workflow's entire history are runs where `build` was **skipped**
  (`test` passed, `build` never ran). A green tick on the run list means the deploy did not happen.
- It is `workflow_dispatch`-only, so it produces no signal on ordinary pushes.

## The purpose is gone, not just the mechanism

| Evidence                                                             | Measured 2026-07-26                                                             |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Successful deploys, all time                                         | **0** — the `build` job has never completed                                     |
| `VERCEL_TOKEN` / `VERCEL_ORG_ID` / `VERCEL_PROJECT_ID`, repo secrets | **absent** (only `CLAUDE_CODE_OAUTH_TOKEN`, `RELEASE_DEPLOY_KEY`, `VITE_GA_ID`) |
| Same, `staging` + `production` environment secrets                   | **0 secrets in each**                                                           |
| `staging.robota.io`                                                  | **does not resolve** (NXDOMAIN)                                                 |
| `robota.io`                                                          | **live, HTTP 200** — so something else already deploys it                       |
| GitHub deployment records                                            | one `production` entry, 2026-05-18 — created by the run that then died          |
| Any spec/doc naming `deploy.yml` as a deployment path                | **none**                                                                        |

So the site this workflow claims to deploy is already being served by another mechanism, and the
credentials this workflow would need have never existed anywhere. Even with the action reference
repaired, it could not run.

Fixing it in place would mean _choosing a deploy architecture_ — a second, competing publish path
for a site that is already published. That is why the action reference was deliberately left
untouched by the audit that found this.

## If deletion is chosen

`git rm .github/workflows/deploy.yml`. Nothing references it: no required status check, no ruleset,
no spec, no runbook. The `test` job it also contains (lint + `test:ci` for `@robota-sdk/agent-web`)
is worth confirming is covered by `ci.yml` before removing — that is the only part of the file that
has ever done useful work.

## If it should live

It needs, in this order: a real deploy mechanism (the official `vercel` CLI, or `amondnet/vercel-action`),
the three secrets provisioned, a `staging.robota.io` DNS record or a different staging target, and
an explicit `permissions:` block (it currently has none and inherits the repo default).
