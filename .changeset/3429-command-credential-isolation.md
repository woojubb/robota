---
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': patch
'@robota-sdk/agent-tools': minor
'@robota-sdk/agent-subagent-runner': patch
'@robota-sdk/dag-node-instant-node': minor
'@robota-sdk/agent-command-workflows': patch
---

Credentials the runtime holds for itself no longer reach the commands it runs.

- `agent-cli` — once a workspace's settings are admitted, every variable a provider profile or
  definition names as its credential (`$ENV:` references, and defaults such as `OPENAI_API_KEY`)
  leaves the process environment, so tools, hooks, background shells, a skill's `!` commands and
  the environment an MCP header helper inherits no longer carry it (a variable an MCP definition
  references explicitly still resolves) (a hosted worker's broker token included); the provider keeps authenticating from
  the startup snapshot. A user or managed settings layer can let
  commands see one with `"commandEnvAllow": ["NAME"]`; project settings cannot. With the OS sandbox
  on, confined commands can no longer read `settings.json`, `credentials/`, `mcp-credentials/` or
  `remote-host-identity.json` under the user state directory. **Behavior change:** a command that
  relied on inheriting a provider key now needs the opt-in.
- `agent-framework` — the settings schema gains `commandEnvAllow`; `checkSettingsDocument` and
  `buildProviderProfilesSnapshot` take an optional environment map to resolve `$ENV:` references
  against instead of the live process environment.
- `agent-command` — provider startup checks credentials against the host's environment snapshot.
- `agent-tools` — `OsSandboxClient` takes `hiddenPaths`, always hidden from confined commands and
  not changeable by sandbox settings.
- `agent-subagent-runner` — a child-process subagent removes its provider credential variable from
  its own environment once its provider is built, unless the start payload says the owner opted it in
  (`keepProviderCredential`).
- `dag-node-instant-node` — prompt nodes accept an env resolver (`createPromptBackedNodeDefinition`'s
  third argument, `rehydrateInstantNode`'s `resolveEnv`) for their `$ENV:` credential default.
- `agent-command-workflows` — `/workflows create` and `/workflows run` resolve prompt-node credentials
  from the host's environment snapshot.
