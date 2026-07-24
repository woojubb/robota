---
title: 'INFRA-047: migrate dependency-review deny-licenses → allow-licenses before the v6 bump'
status: todo
created: 2026-07-25
priority: low
urgency: later
area: .github/workflows/dependency-review.yml
depends_on: []
---

# INFRA-047: license-gate input migration

## Problem

`dependency-review-action` deprecates `deny-licenses` for possible removal in v6 (noted in-file when v5
landed, #1313). The deny list is LOAD-BEARING for the dual-license policy (blocks GPL/AGPL ingress).

## What

Build the equivalent `allow-licenses` list (inventory current dependency licenses; allow-list is stricter —
verify no currently-green license falls outside), switch inputs, delete the in-file deprecation note.
Gate: do NOT accept a Dependabot v6 bump before this lands.

## Test Plan

A test PR introducing a GPL dev-dep is BLOCKED under the new input (then closed).
