---
'@robota-sdk/agent-framework': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-ui-terminal': minor
---

Make the settings, contribution-root and transport-settings modules of the framework platform-neutral. The main entry no longer opens a settings file; it asks the host for text and for a store, and the file-backed halves moved to `@robota-sdk/agent-framework/node`.

- Settings sources: a host source is now `IHostSettingsSource` (replacing `INodeHostSettingsSource`) with `kind`, `scope`, `displayName`, an optional `path` and a required `read()` that returns the document's text, `undefined` when it does not exist, and throws when it exists but cannot be read. `readSettingsSourceText` and every settings layer read through it, so an absent, empty, corrupt or unreadable layer is classified and refused exactly as a file layer is. A host with no file system passes its own sources and stores. `createNodeHostSettingsSource` and `createNodeHostSettingsStore` moved to `/node`; the Node source reads the file the way it always did, and the store still writes owner-only.
- Settings files: `readSettings`, `writeSettings`, `updateModelInSettings`, `deleteSettings` and `resetUserConfig` (with `IResetUserConfigResult`) moved to `/node`, unchanged. `TSettingsData` is exported from the module that defines `ISettingsDocumentStore`, and `TSettingsScope` from the scope types; both stay on the main entry.
- `applyStatusLineSettings` and `applyAppearanceSettings` take an `ISettingsDocumentStore` instead of a settings file path, so they read and write through whatever store the host built. `@robota-sdk/agent-cli` passes a `createNodeHostSettingsStore` over the product's user settings file.
- Contribution roots: `createNodeHostContributionSource` and `createDefaultUserContributionSources` moved to `/node`. `createContributionSourcesForProjectAccess(access, userSources)` takes the user `IContributionSource[]` the caller built, where it took a home directory and built the Node source itself; with none, a session has the trusted project's sources only.
- Transport settings: `TransportRegistry` takes an `ITransportSettingsRepository` only. A file path string is no longer accepted; pass `createFileTransportSettingsRepository(path)` from `/node`. `createMemoryTransportSettingsRepository` stays on the main entry.
- `readPackageVersion` moved to `/node`.
- `@robota-sdk/agent-command` reads a host settings source's file from `path` when it has one and from its `displayName` otherwise, in the doctor's settings checks.
- `@robota-sdk/agent-cli`, `@robota-sdk/agent-ui-terminal`: import the moved symbols from `/node`; behaviour is unchanged.
