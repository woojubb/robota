# Learn — cheap local capture for mid-task findings

Issue-registration policy (2026-09): a finding noticed mid-task is recorded HERE, not filed as a
GitHub Issue and not turned into a Task. No network call, no `gh` invocation, no new backlog item —
append one record below and return to the work in flight. See
[find-to-issue](skills/find-to-issue/SKILL.md) for when to use this file, and
[learning-loop.md](rules/learning-loop.md) for how entries here are later worked as a batch, only
when the user explicitly asks for lesson processing.

## Entry format

Append under a stable ID. Five fields, no more: category, severity and a fix are not required here —
they are decided later, at lesson time, not by the person who noticed the thing.

```md
### LRN-<stable-id>

- observed-at: <ISO timestamp>
- observation: <one sentence>
- evidence: <file:line, command output, or URL — at least one>
- source: <current Task ID or session>
- related: <known Issue/Task/PR ID, omit if none>
```

Seeing the same thing again is not a new record — add a dated evidence line under the existing entry
instead. If you cannot find the existing ID with a quick search, record a new one anyway; reconciling
near-duplicates happens in batch, at lesson time.

## Records

<!-- Append new `### LRN-<id>` entries below this line. Nothing above it is a record. -->
