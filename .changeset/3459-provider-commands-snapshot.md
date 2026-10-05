---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-cli': patch
---

Provider commands work again once the runtime withholds its own credentials. `/provider switch`, `/provider test`, `/provider add`, `/provider edit` and a cross-profile `/model` checked a profile's `$ENV:` or default credential against the live `process.env`, which the runtime now empties, so they failed with "missing apiKey".

- `IProviderCommandModuleOptions` takes an optional `env`, and `createDefaultCommandModules` takes `providerEnvironment`. The CLI passes its startup snapshot.
- The git that isolated subagents run, and so the repository's hooks, now get the command environment instead of the full snapshot.
