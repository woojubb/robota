---
title: SDK/CLI Spec Conformance Audit
status: completed
priority: high
created: 2026-03-20
branch: refactor/sdk-cli-spec-conformance
packages:
  - agent-sdk
  - agent-cli
  - agent-sessions
---

# SDK/CLI Spec Conformance Audit

## Goal

agent-cli, agent-sdk, agent-sessions are recently created and have gone through multiple refactoring rounds. Review their SPEC.md documents for internal contradictions, cross-package inconsistencies, and spec-code gaps. Improve specs first, then align code to match.

## Progress

- [x] Phase 1: Spec Review — gap report produced
- [x] Phase 2: Spec Improvement — HIGH/MEDIUM issues fixed in all 3 SPECs
- [x] Phase 3: Code Alignment — 7 LOW items fixed

## Resolved (LOW)

| #   | Package  | Issue                                                          |
| --- | -------- | -------------------------------------------------------------- |
| 1   | sessions | `TSessionLogData` description inaccurate in Type Ownership     |
| 2   | sessions | `ISessionOptions.terminal` not in Extension Points             |
| 3   | sessions | FileSessionLogger/SilentSessionLogger not listed as test gaps  |
| 4   | sdk      | Dependency diagram missing direct edges (cli→core, sdk→core)   |
| 5   | cli      | Dependencies table missing `ink-text-input`, `marked-terminal` |
| 6   | cli      | Dependency diagram format inconsistent with sdk SPEC           |
| 7   | sdk      | permission-prompt.ts ownership internal contradiction          |
