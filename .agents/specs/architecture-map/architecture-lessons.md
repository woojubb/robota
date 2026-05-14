# Architecture Lessons and Audit

Resolved architecture audit findings and durable lessons.

Back to [System Architecture Map](../ARCHITECTURE-MAP.md).

> **Evidence policy**: An item may not be marked "resolved" without a verification artifact —
> a commit hash, PR number, or grep-output confirming the fix is in the codebase.

For governance and update policy, see [../../rules/documentation-sync.md](../../rules/documentation-sync.md).

## Architecture Audit

### SYS-AUDIT-001: No Repository-Wide Architecture Router Existed

Status: resolved — PR #313 (`2d6a4f569`).

The `architecture-map/` subtree and `ARCHITECTURE-MAP.md` entrypoint were introduced. The CLI
package map remains a stable entrypoint for terminal product composition.

### SYS-AUDIT-005: Docs Deploy Still Referenced GitHub Pages

Status: resolved — `INFRA-BL-006`, commit `f9e388fd7`.

Docs production deployment now points to Cloudflare Pages. `docs:deploy` is a manual Wrangler
direct upload helper; release workflow docs handling is build verification only.

### SYS-AUDIT-006: Capability Placement Was Too CLI-Centered

Status: resolved — PR #315 (`eb658beb4`).

`capability-placement.md` and a harness scan were introduced. Product shells may render, host, and
wire concrete adapters; reusable contracts live in lower owner packages first.
