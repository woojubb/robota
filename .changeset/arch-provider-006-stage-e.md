---
'@robota-sdk/agent-core': patch
---

Provider DIP Stage E (ARCH-PROVIDER-006): repo-hygiene + policy cleanup. Codified the
Family Decomposition Rule in project-structure.md (split driver = consumer/third-party
opt-in installability / extension-point registration, not dep-weight). Removed dangling
tracked references to deleted packages (tsconfig project refs, eslint glob, changeset
config `fixed` + pending changeset files), pruned 37 dead `.changeset/pre.json` entries,
and removed 24 untracked husk directories. Closes ARL-15 — the provider dependency-
inversion arc (Stages A–E) is complete.
