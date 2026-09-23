---
name: issue-to-backlog
description: Decide whether a GitHub issue itself is sufficient or needs one additional repository work record.
---

# Issue ownership without duplicate lifecycle

Read the full issue and current repository state.

- Keep the issue as the authoritative work record when it already states the problem, outcome, scope, and acceptance criteria. This is the default.
- Create one repository Task only when offline durability, multi-PR sequencing, or a cross-issue initiative cannot be represented clearly in the issue and PR.
- Create a design document only for a material architectural or public-contract decision. It is design evidence, not a second lifecycle tracker.
- Never require a separate registration comment, paired Task/spec, lifecycle file moves, parent-state copying, or planning-only commit for a small direct request.
- Record retained, superseded, or delivered dispositions on the authoritative issue when consolidating earlier work.

After this decision, continue through `user-request-gate` and its Entry boundary.
