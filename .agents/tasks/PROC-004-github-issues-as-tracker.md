---
title: 'PROC-004: GitHub Issues as the tracker, backlog files as the implementation document'
status: todo
priority: high
urgency: soon
type: PROC
area: .agents/tasks
created: 2026-07-31
depends_on: []
issue: https://github.com/woojubb/robota/issues/1538
---

# PROC-004 — split "what needs doing" from "how it will be done"

## Problem

`.agents/tasks/` is currently doing two jobs at once, and they have different readers.

- **Tracking** — what is open, what it depends on, what its priority is. Read by anyone deciding
  what to work on, including the owner, from anywhere.
- **Specification** — the measurement behind the item, the directions considered, the acceptance
  criteria. Read by whoever implements it, in a checkout.

Conflating them costs on both sides. Tracking lives in files that require a git clone to read and a
PR to update, so an item cannot be triaged from a phone, cannot be assigned, cannot be linked from a
PR by the host's own mechanics, and has no notification path. Specification, meanwhile, is squeezed
into frontmatter fields (`status`, `priority`, `urgency`, `depends_on`) that a tracker would own for
free, and every status change costs a commit — 3 of the last 30 PRs were nothing but status edits.

## Direction to evaluate

**GitHub Issues become the tracker; the backlog file becomes the implementation document for the
next stage.** An issue carries state, priority labels, assignment, dependencies and discussion. The
in-repo file carries the measurement, the design note, the alternatives and the acceptance criteria —
the part that belongs beside the code and benefits from review.

Interim, starting now: **every newly filed backlog item is also registered as a GitHub issue**, with
the issue URL written into the item's frontmatter. That builds the corpus this evaluation needs
without committing to the migration. First three: INFRA-073 (#1536), INFRA-072 (#1537), this item (#1538), and it makes the pairing concrete enough to judge.

## Questions this must answer before any migration

1. **Which fields move and which stay?** `status` is the single source of truth today and is
   grep-enforced by several scans (`doc-folder-status` among them). If state moves to the issue, every
   one of those floors needs a new subject, or the file keeps a mirrored status that can drift — and a
   mirrored status that can drift is worse than either arrangement alone.
2. **What happens to the enforcement that reads the files?** `backlog-execution`'s done gate, the
   gate-pipeline in `.agents/spec-docs/`, and the promotion audits all read frontmatter. Each needs to
   be pointed at the API or kept file-side deliberately.
3. **Does the repository still work offline / in a fork?** A clone whose tracker is unreachable must
   still be implementable. That argues for the file keeping enough to work from.
4. **Who writes which one, and when?** The obvious split is: the issue at filing, the file at the
   point the work is planned. That means not every issue has a file, which is a change in what
   "backlog item" means.
5. **What is the migration cost for the existing corpus?** Count the open items and decide whether
   they are migrated, left file-only, or closed.

## Done when

- The five questions above are answered with evidence, not preference.
- A decision is recorded: migrate, keep files, or the hybrid — with the enforcement consequences of
  the choice spelled out.
- If migrating: every floor that reads backlog frontmatter has a named new subject, and no field
  exists in two places without one of them being generated.
