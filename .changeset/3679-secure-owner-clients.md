---
"@robota-sdk/agent-cli": minor
"@robota-sdk/agent-ui-terminal": minor
"@robota-sdk/agent-framework": minor
---

Rename `daemon unlock` to `daemon clear-start-lock` so clearing an abandoned start lock is distinct from unlocking secure runtime keys.

Allow the session view to hand secure attach to its host for credential-based confirmation.

Allow hosts to constrain the environment used for workspace identity Git probes.
