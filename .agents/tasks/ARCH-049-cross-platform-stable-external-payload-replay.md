---
title: 'ARCH-049: Cross-platform stable external-payload replay'
status: todo
created: 2026-08-23
priority: high
urgency: now
area: packages/agent-session Node session-log filesystem authority boundary
depends_on: []
---

Registered as GitHub issue https://github.com/woojubb/robota/issues/2153.

## Problem

The Node session-log source can hold a stable descriptor-rooted authority while resolving external
payloads only on Linux. On macOS and Windows it rejects every external payload read, so the public
Node replay adapter cannot preserve externalized session payloads across all supported host families.
Restoring pathname validation followed by pathname reads would make replay available again only by
reintroducing the replacement race that ARCH-042 removed.

This was discovered during the ARCH-042 local review. It is not solved there because the missing
capability is a cross-platform stable-handle filesystem boundary, not a local validation branch in
one session-log adapter.

## Directions Considered

- Provide platform-specific implementations behind one stable external-payload read contract.
- Move the stable-handle primitive to an owner that can serve every Node filesystem authority
  consumer without coupling session replay to one operating system.
- Define an alternative supported-host capability only if it preserves the same authority and
  pathname-replacement invariants.

The design choice remains open and must enter the spec gate before implementation.

## Completion Criteria

- Externalized payload replay through the public Node adapter works on Linux, macOS, and Windows.
- Each supported-host implementation holds stable root and target authority across validation and
  reading, or provides an equivalently strong primitive.
- Parent-directory and final-target replacement cannot redirect a read outside the log payload root.
- Platform behavior is covered by native-host tests rather than platform-name mocks alone.

## Test Plan

- Add deterministic parent-directory and final-target replacement tests for each implementation.
- Run native Linux, macOS, and Windows public replay scenarios in CI.
- Run the agent-session unit suite, package build/typecheck, and repository verification gates.
- Run containment-label and work-item scans while ARCH-042 references this Task.

## User Execution Test Scenarios

### Public Node replay preserves external payloads on every supported host

- Prerequisites: a built local SDK on Linux, macOS, or Windows and a session log containing an
  externalized payload sidecar.
- Steps: invoke the documented public Node replay factory with that log and execute the recorded
  provider turn.
- Expected result: the replayed response contains the original external payload bytes, while a
  replacement fixture cannot redirect the read outside the payload root.
- Cleanup: remove the temporary log, sidecar directory, and replacement fixture.
- Evidence: pending implementation.
