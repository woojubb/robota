# Finding Disposition

Parent: [AGENTS.md](../../AGENTS.md)

The responsible author classifies a finding directly:

- **Local** — the cause and correction are inside the current scope; fix it here.
- **Foundational** — the root cause requires materially broader ownership; record it on the best existing issue and contain or defer it explicitly.
- **Invalid** — evidence disproves the finding; record the reason where the finding was raised.
- **Undetermined** — gather the missing evidence before deciding.

A dedicated depth-triage dispatch is optional, not mandatory. The classification exists to prevent symptom patches and silent drops, not to create another gate or artifact.

For a general foundational finding, the existing GitHub issue is the root record. A separate repository Task and `Contained — <ID>` label are not required. An author who chooses the optional Task-backed `--foundational` / `--disposition` local-review path must name a resolvable Task; a more specific rule may also require a label at its own boundary. Changing the wording around unchanged held behavior does not change its classification: record the actual behavior and its owner issue, then state whether it is contained or deferred.

Enforced by: `record-local-review` verifies any optionally recorded foundational item resolves; the responsible
author owns the classification itself because a machine cannot infer semantic root cause from an arbitrary finding.
