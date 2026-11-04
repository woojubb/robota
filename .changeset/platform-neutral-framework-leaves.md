---
'@robota-sdk/agent-framework': minor
---

Start making the framework platform-neutral: thirty-eight leaf modules no longer import `node:path`, `node:crypto`, `node:util`, `node:fs` types or `Buffer`, and use the `@robota-sdk/agent-core` helpers instead. Persisted ids, digests and comparison results are unchanged. The package stays Node-only until the rest of the split lands.

Behaviour that changes:

- A path that is not absolute is never anchored to the process directory. A working directory that is not absolute is refused where a project prompt or context reference is resolved ("The session working directory must be absolute"). A plugin path that is not absolute is refused with `PluginPathContainmentError`, and `resolveContainedRelative` refuses a relative root. `isWorkspacePathContained` answers `false` for a root or candidate that is not absolute, where two relative paths were resolved together and `repo` held `repo/a`.
- A root-relative path that is spelled as a root on either platform (`\x`, `C:\x`) is refused on every platform; a POSIX host used to let a Windows spelling through.
- Project state directories are kept in the spelling the host supplied, so the host's own comparison with its layout holds on every platform. A POSIX host used to get a backslash spelling back with `/`.
- On a Windows host, the `relativePath` and `instructions:` ids from `listFrameworkProjectContributionPaths` are spelled with `/` (`packages/app/AGENTS.md`), while the entries the CLI adds keep `\`. The working directory is read with either separator, so on a POSIX host a directory name that contains a backslash is read as two segments.
- Labels built from a layout root are spelled with one separator, never a mix. An agent's `definedIn`, the `source` of a skill diagnostic and the `path` of a skipped skill are `/`-spelled for a project definition (`authorized workspace project/.robota/agents/x.md`) on every host, and keep the host directory's own separators for a definition read from one (`C:\Users\me\.robota\agents\x.md`); they used to follow the host's separator. A skill's `skillDirectory` is unchanged.

Unchanged on Windows: a memory topic `path`, the root of a project state storage, and the `system:` context reference ids keep the host's separators.
