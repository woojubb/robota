---
name: backlog-writer
description: Author an optional detailed work design when the canonical request needs durable alternatives or risk analysis.
invocable: true
---

# Work Design Authoring

Use only when a complex change benefits from durable design reasoning. The canonical issue/request remains
authoritative; do not create a paired Task or gate lifecycle.

Write one fixed-path document under `.agents/spec-docs/` with only the sections the decision needs:

- problem and scope;
- constraints and affected contracts;
- alternatives and recommendation;
- migration, security, permission, or destructive-operation risks when applicable;
- completion criteria and meaningful verification.

Research is proportional. Cite external standards or product behavior when they materially decide the design;
do not dispatch research merely to fill a section or conclude N/A. Package public contracts still belong in
`packages/*/docs/SPEC.md`.

The document is reviewed as part of the entry decision and updated in place. Do not move it between
lifecycle folders, create a planning-only commit, or copy status into parent records.
