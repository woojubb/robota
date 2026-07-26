---
id: INFRA-059
title: Nothing checks that a workflow's `uses:` references resolve — one has been dead for 8 months
status: todo
priority: medium
type: INFRA
created: 2026-07-26
---

# INFRA-059: a workflow can reference an action that does not exist, forever

## Problem

`deploy.yml` has referenced `vercel/action@v1` — **a repository that does not exist** — since it was
written. Every run dies at `Set up job` with `Unable to resolve action`. That went undetected for
eight months and 100+ runs (INFRA-058).

The class matters more than the instance. An unresolvable `uses:` fails _before any step runs_, so:

- there is no failing step in the log to read,
- `--log-failed` returns only the runner provisioner banner,
- and a job that is `if:`-gated or skipped reports the whole run **green**.

It is the quietest possible CI failure, and nothing in this repo would catch another one.

## Proposed check

`actionlint` in CI over `.github/workflows/*.yml`. It is the standard tool, it catches this plus
expression-syntax and context-typing errors, and it has no repo-specific configuration burden.

**This needs an owner decision because it is a new required check**, and because the resolvability
half needs network access at check time — which raises the question the harness cares about: a
network-dependent check that cannot reach GitHub must **fail**, not skip. A "could not determine →
exit 0" path here would reproduce the exact defect it is meant to catch. That argues for running it
as a CI job rather than folding it into `pnpm harness:scan`, which developers run offline.

## Scope note

INFRA-038 recorded `actionlint` being run **manually** against `ci.yml` during that migration
("actionlint clean on ci.yml"), and it found the `deploy.yml` `codecov-action@v3` warning at the
time. So the tool has already proven itself on this repo once — it simply was never wired in, and
the one-off run did not flag the unresolvable action because plain `actionlint` does not check
resolvability without network.

## Acceptance

- [ ] A CI job runs `actionlint` over every workflow.
- [ ] It is **proven red** against a deliberately reintroduced bad `uses:` reference before being
      believed — the same red-first standard DIST-002's gate was held to.
- [ ] Its network-failure path exits non-zero, and that path is exercised, not reasoned about.
