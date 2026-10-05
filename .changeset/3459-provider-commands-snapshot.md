---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': patch
---

Provider commands check a profile's `$ENV:` or default credential against the host's environment snapshot, so `/provider switch`, `/provider test`, `/provider add`, `/provider edit` and a cross-profile `/model` keep working while the runtime withholds its own credentials from `process.env`.

- `IProviderCommandModuleOptions` takes an optional `env`, and `createDefaultCommandModules` takes `providerEnvironment`. The CLI passes its startup snapshot.
- The git that isolated subagents run, and so the repository's hooks, now get the command environment instead of the full snapshot.
