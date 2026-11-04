---
'@robota-sdk/agent-command': minor
'@robota-sdk/agent-preset': minor
'@robota-sdk/agent-cli': minor
'@robota-sdk/pack-coding': minor
'@robota-sdk/agent-ui-terminal': minor
'@robota-sdk/agent-ui-web': minor
---

Move what touches a host out of the main entries of `@robota-sdk/agent-command` and `@robota-sdk/agent-preset` into new Node-only `./node` subpaths (`"browser": null`), so neither main entry names a Node module of its own. Both stay Node-only until the packages they import go neutral.

- `@robota-sdk/agent-command/node` (new) holds `/shell` and `/editor` (`createShellCommandModule`, `createEditorCommandModule` and their sources, entries, `execute*`, `resolveShell`, `resolveEditor` and `spawnInherited`), `createTerminalClientCommands` (an attached terminal runs `/shell` and `/editor` itself), `createNodeDoctorDeps` and `resolveCommandOnPath`, and the new `openFileInEditor`. Import these from `/node`.
- `createDefaultCommandModules` no longer builds `/shell` and `/editor`, and its `editorTemporaryDirectoryPrefix` option is gone: a Node product adds the two modules beside the default set, as `@robota-sdk/pack-coding` already does. The CLI's command list is unchanged.
- `/doctor` takes its probes and writers by injection. `createDoctorCommandModule(inputs, deps, display)` has no default for `deps` (pass `createNodeDoctorDeps` from `/node`), `IDoctorDeps` gains `ensureOwnerOnlyDirectory` and `writeSettings` for the confirmed repairs, and `createDefaultCommandModules` takes `doctorDeps`. Absent, `/doctor` is still listed and answers that it is unavailable on this host; nothing is probed or written.
- `/keybindings` opens its file through an injected `TOpenFileInEditor`: `createKeybindingsCommandModule(file, openInEditor)` and the new `keybindingsEditor` option of `createDefaultCommandModules` (pass `openFileInEditor` from `/node`). Absent, `/keybindings` answers that the editor is unavailable here and creates no file.
- `/provider` and `/model` read a `$ENV:` credential reference from the host's `env` snapshot only. Absent, the reference reads as unset (the setup says so and asks again); the live process environment is no longer consulted by the command itself.
- `/loop` takes its ids and per-loop offset from `randomId` and `sha256Hex` in `@robota-sdk/agent-core`; both read exactly as before.
- The `/doctor` check ids (`settings.<scope>.<family>`) read a project-relative path a Windows host joined with `\` as they read one joined with `/`.
- `@robota-sdk/agent-preset/node` (new) holds `loadExternalPresetsFromDir`. The main entry gains `loadExternalPresetsFromFiles` (`IExternalPresetFile` list of `{ fileName, read }`), which has the same per-file error rules over files a host hands it; only `*.json` names are read. Output-style file ids are read from the file name without `node:path`.
- `@robota-sdk/agent-cli` passes `createNodeDoctorDeps` and `openFileInEditor`, and reads the preset directory and runs the attached terminal's commands through the `/node` entries, so every command behaves as before. `@robota-sdk/pack-coding` and `@robota-sdk/agent-ui-terminal` (tests) import `/shell` and `/editor` from `@robota-sdk/agent-command/node`; `@robota-sdk/agent-ui-web` only has a test comment updated.
