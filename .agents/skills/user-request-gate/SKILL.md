---
name: user-request-gate
description: Route a requested source change through one entry decision and one integrated completion decision.
invocable: true
---

# Two-boundary delivery

Use this skill for requested source, workflow, hook, or harness changes.

## Entry boundary

1. Use the user's request or canonical GitHub issue as the authoritative work record.
2. Read enough code and current external state to state the intended outcome, affected area, meaningful risks, and focused verification.
3. Ask for another decision only when scope expands materially, an external contract changes, new permission is required, a destructive action is needed, or a release is requested.
4. Begin implementation. A planning-only commit, lane declaration, Task/spec pair, gate receipt, reviewer dispatch, or scenario-author dispatch is not an entry prerequisite.

For a small direct request, the request itself plus the branch/PR is a stable work identity. Create a repository Task or design document only when it carries information the issue and code cannot own without ambiguity.

## Implementation

Use focused RED/GREEN evidence for observable behavior changes. Update a package contract before implementation when its public behavior or API changes. Keep ordinary corrections in the same coherent work unit; do not create continuation-only or receipt-only commits.

## Completion boundary

1. Verify focused tests, static checks, and any real user-visible scenario. Build locally only when
   the selected executable, reproducer, or check reads generated output; PR CI owns the normal clean
   affected build.
2. Obtain one independent final review of the meaningful final diff. Additional design review is justified by risk, not mandatory role count.
3. Publish one PR whose body links the authoritative work record and summarizes verification.
4. Require the selected CI decisions to pass, resolve actionable findings, merge, and confirm the issue is complete.

Historical gate records remain readable project history; no retired lifecycle executable is kept for them.
