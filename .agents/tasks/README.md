# Tasks

A Task is an optional repository-local work record for work that genuinely needs durable coordination
beyond its canonical issue or request. Ordinary work does not require a Task, and a Task never requires a
paired spec document.

## Prospective policy

- Prefer the existing GitHub issue or direct request as the single authoritative record.
- Create one Task only when local cross-session coordination, a long-lived dependency, or a repository-only
  decision needs a durable home.
- Keep it at one fixed path under `.agents/tasks/`; update content in place. Do not move it through status
  directories or mirror state into a second document.
- Link the canonical issue and PR. Record scope, decisions, remaining work, and meaningful verification.
- Close the authoritative issue/request after verified delivery. Do not create a completion-only Task edit,
  receipt-only commit, or parent-state copy.

Suggested minimal form:

```markdown
# <ID>: <title>

Issue: <URL or request reference>
State: open | complete | superseded

## Scope

## Decisions

## Verification
```

IDs remain stable citations. Prefer the canonical issue or initiative identifier when a Task is actually
justified; choosing an ID does not enroll the work in a separate lifecycle.

## Historical records

Existing files under `completed/`, historical Task/spec pairs, and their citations remain readable evidence.
They are not templates for new work, are not silently rewritten, and do not require executable legacy gate
libraries. An active historical record finishes under the current entry/completion policy while preserving
its prior evidence in place.
