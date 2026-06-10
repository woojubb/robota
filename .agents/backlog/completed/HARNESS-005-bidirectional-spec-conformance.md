---
title: 'HARNESS-005: Spec-conformance loop must check SPEC→code direction explicitly'
status: done
created: 2026-06-11
completed: 2026-06-11
priority: medium
urgency: soon
area: .agents/skills
depends_on: []
---

# HARNESS-005: Spec-conformance loop must check SPEC→code direction explicitly

## Problem

agent-transport SPEC documented `allowedTools`/`deniedTools` on the TUI render options while the
code (`IRenderOptions`) lacked both fields — the spec was ahead of code and stayed ahead. The
conformance habit only catches code-ahead-of-spec drift.

## Proposed Change

Update the `spec-code-conformance` skill: the verification loop enumerates SPEC-declared fields/
exports/events and confirms each exists in code (SPEC→code), in addition to the existing
code→SPEC direction. Record both directions in conformance evidence.

## Test Plan

- Skill document update reviewed against the CLI-053 case as the worked example.
- Next conformance run on one package records both-direction evidence.

## User Execution Test Scenarios

Not applicable — skill documentation change.

## Evidence

- (2026-06-11) spec-code-conformance SKILL "Bidirectional Verification" section added with SPEC→code direction and the CLI-053 worked example.
