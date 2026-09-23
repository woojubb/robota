# Work Design Documents

`.agents/spec-docs/` contains historical work-item plans and any future detailed design that is genuinely
useful for a complex change. A design document is optional and is never a mandatory pair for a Task or issue.

## Prospective policy

- Keep the issue/request authoritative.
- Write a design document only when alternatives, cross-package contracts, security boundaries, destructive
  migration, or release risk need durable reasoning before implementation.
- Use one fixed path and update it in place. Do not move it through draft/backlog/todo/active/done folders or
  copy status into parent records.
- Package public contracts continue to live in `packages/*/docs/SPEC.md`; this directory does not replace
  them.
- No lifecycle transition, scenario-author dispatch, planning-only commit, or completion receipt is required.

Historical lifecycle folders and documents remain readable evidence. Their old status fields describe the
process used at the time; they do not activate legacy tooling or impose that lifecycle on current work.
