# Audit Report: architecture-lessons.md

**File:** `.agents/specs/architecture-map/architecture-lessons.md`
**Lines:** 34
**Date audited:** 2026-05-18

---

## Stale References

| Line | Current text   | Correct text | Reason                                   |
| ---- | -------------- | ------------ | ---------------------------------------- |
| —    | _(none found)_ | —            | No explicit stale package names detected |

No occurrences of the renamed package names (`agent-sdk`, `agent-sessions`, `agent-web`,
`agent-command-*`, `agent-provider-*`, `agent-plugin-*`) appear in this file.

---

## Missing References

- The file mentions "the CLI package" (line 19) as the stable entrypoint for terminal product
  composition. This is an implicit reference to `agent-cli`, which is correct and still exists.
  No update required.
- The three audit entries (SYS-AUDIT-001, SYS-AUDIT-005, SYS-AUDIT-006) reference only PR numbers
  and commit hashes, not package names. These are stable identifiers that do not become stale with
  renames.
- The file does not enumerate specific packages by name, so it is not affected by the known renames:
  `agent-sdk → agent-framework`, `agent-sessions → agent-session`, `agent-web → agent-web-ui`,
  consolidation of `agent-command-*`, `agent-provider-*`, `agent-plugin-*`.

---

## Summary

`architecture-lessons.md` contains **no stale package name references**. The file is intentionally
high-level: it records resolved audit findings via PR/commit evidence without naming individual
packages. The single implicit reference to "the CLI package" (line 19) correctly describes
`agent-cli`, which has not been renamed.

**Action required:** None. File is clean with respect to package naming.
