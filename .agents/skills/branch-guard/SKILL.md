---
name: branch-guard
description: Consult protected-branch commit and merge policy before operating on main, master, or develop.
---

# Branch Guard

[git-branch.md](../../rules/git-branch.md) owns branch, commit, push, merge, and cleanup policy.
Read only the section that matches the operation:

- creating or switching branches: "Branch Policy" and "Feature Branch Workflow"
- committing or pushing: "Git Operations" and "One-Branch-At-A-Time Rule"
- opening or updating a PR: "PR Batching" and "An open PR's diff is frozen except to resolve a finding"
- merging: "Pre-Merge Code-Review Gate" and "Merge Landing Verification"
- deleting or cleaning up branches: "Delete Merged Branches" and "Post-Merge Branch Cycle"
- using an override after a guard refusal: "Which Form An Override Takes"

The hooks enforce the policy. Treat a refusal as a request to inspect the named rule and current
repository state; do not duplicate or infer an exception in this skill.
