# A corpus that is too wide makes a guard pass quietly

## STATUS: measured 2026-08-23; the fix (positive corpus) is in the SEC-016 scan

In-repo mirror (memory-mirroring rule). Host mirror: `a-wide-corpus-makes-a-guard-pass-quietly`.

## The shape

A corpus that is too NARROW makes a guard fail loudly — someone investigates. A corpus that is too
WIDE makes it pass quietly.

Measured: a fire-site finder excluded `__tests__` but not `examples/`, so a demo script whose job was
to exercise the gate stood in as evidence the gate existed. **Deleting the entire production gate
left the scan green.**

## Why the direction matters

A missing finding gets investigated. An extra one raises the count, and a higher count reads as
healthier coverage rather than as contamination. The failure is inverted from the one people look for.

## How to apply

Define a guard's corpus by requiring product source **positively** — `packages|apps/*/src/`, minus
tests, examples, fixtures, dist — rather than by excluding known-bad trees. An exclusion list is a
denylist, and the set of things that are not product grows without you: a new sibling directory
should have to EARN inclusion rather than be included until someone notices.

Related: [[two-disagreeing-measurements-are-one-finding]], [[applied-check-must-read-the-code-line]]

## The direction of the danger is conditional, not absolute

Recorded because an earlier statement of this lesson made it absolute and that was wrong. A corpus
wider than the claim does not always conceal: it suppresses a **presence** proof (the extra corpus
supplies the thing being looked for, so a real absence reads as present), and it merely manufactures
work for an **absence** proof. Which way it fails depends on what the guard is trying to establish,
and this entry stated it as an absolute until now, and the qualification was briefly recorded in
[[two-disagreeing-measurements-are-one-finding]] instead — a correction filed against a neighbour
rather than against the fact it corrects. Issue #2227 still states the absolute form.
