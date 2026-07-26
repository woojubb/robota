---
id: HARNESS-055
title: 'HARNESS-055: two workflow action references resolve through a branch head, not a tag'
status: todo
priority: low
urgency: later
type: INFRA
area: .github/workflows
created: 2026-07-27
depends_on: [INFRA-059]
---

## Problem

`scan-action-references --live` (INFRA-059) resolves every workflow `uses:` reference against the
remote. Two of them resolve through a **branch head** rather than a tag:

```
note: 2 reference(s) resolve through a branch head, not a tag — a moving pointer that still
resolves (HARNESS-055).
```

A branch head resolves today and points somewhere else tomorrow, with no change to this repository
and no signal that anything moved. That is weaker than the tag references beside it, which at least
move only when someone republishes the tag.

INFRA-059 reports this as a **note, not a failure**, deliberately. The reference does resolve, the
workflow does run, and failing on it would fire on correct configuration — a guard that flags
working setups gets suppressed, and a suppressed guard costs more than what it catches.

## Why it is filed rather than fixed

Pinning is not free and the right target is not obvious from inside the scan:

- Pinning to a tag keeps the reference readable but still moves when the tag is republished.
- Pinning to a commit SHA is the only genuinely immovable form, and it makes every upgrade a manual
  edit — which in practice means the pin rots and the action never gets updated.

Which of those is right depends on how much the repository trusts each publisher, and that is a
judgement, not a rule the scan can derive.

## Proposed direction

Decide per reference, and record the decision where the reference lives:

- For actions published by an owner this repository already trusts with a token, a tag is enough —
  say so in a comment beside the `uses:` line so the note stops reading as an unresolved question.
- For anything else, pin to a SHA and pair it with whatever keeps pins current (Dependabot already
  updates SHA-pinned actions).

## Done when

- Both branch-head references are either pinned or carry a stated reason for staying as they are.
- `scan-action-references --live` emits no unexplained branch-head note — either because none
  remain, or because the remaining ones are declared.
- The declaration carries anti-rot: a declared exception whose reference no longer exists fails, so
  the list cannot outlive what it excuses.
