---
title: 'ARCH-046: workspace contribution inventory duplicates loader ownership'
status: todo
created: 2026-08-22
priority: high
urgency: now
area: packages/agent-framework, packages/agent-cli
depends_on: []
---

# ARCH-046: workspace contribution inventory duplicates loader ownership

Registered as GitHub issue https://github.com/woojubb/robota/issues/2140.

## Problem

The pre-trust contribution inventory maintains a separate hand-written path list rather than deriving
categories from contribution owners. It already omits active project skills, agents, memory, logs, and
checkpoints, so the consent prompt can under-report what granting trust enables. Adding the five paths
alone would preserve the design that guarantees future omissions.

This blocks `SECURITY-001`: informed consent requires the fixed content-blind inventory and the loaders
to share ownership of contribution categories.

## Existing Evidence

- `.robota/skills`, `.agents/agents`, `.robota/memory`, `.robota/logs`, and
  `.robota/checkpoints` are active inputs but absent from the inventory.
- The inventory reports `.agents/memory`, which is not the runtime project-memory owner.
- No owner registry or mechanical coverage connects loader changes to inventory changes.

## Directions Considered

- Establish an owner-controlled contribution-source registry or equivalent SSOT from which loaders and
  the content-blind inventory derive categories.
- Preserve pre-trust no-follow/no-content inspection.
- Reject another synchronized path list or a test that merely copies the same duplicate list.

## Completion Criteria

- [ ] Every active project contribution family has one owner declaration consumed by both loading and
      inventory projection.
- [ ] Adding a project contribution source without inventory coverage fails mechanically.
- [ ] Pre-trust inspection remains fixed-depth, no-follow, and content-blind.
- [ ] Trust prompt, status, diagnose, package docs, and architecture maps use the same categories.

## Test Plan

- Registry ownership and exhaustiveness tests across all contribution loaders.
- Adversarial inventory tests for symlinks, deep trees, missing paths, and unreadable entries.
- Framework/CLI build, typecheck, test, harness scan, and trust lifecycle scenario.

## User Execution Test Scenarios

### Scenario: trust inventory reports every enabled project contribution family

- Prerequisites: build the CLI; create an isolated Git project with one canary entry in each declared
  contribution family and with no trust grant.
- Exact command: run `robota trust status`, then `robota trust --yes`, then `robota diagnose`, using an
  isolated user home.
- Expected observable result: status reports every family without reading canary content; after the
  grant, diagnose reports the same categories and their trusted provenance.
- Cleanup: run `robota trust revoke` and remove the isolated project and user home.
- Evidence:
