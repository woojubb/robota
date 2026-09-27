# File Write Node

`@robota-sdk/dag-node-file-write` (internal) exports `FileWriteNodeDefinition`, node type
`file-write` (category `File`). It writes or appends text to a file on the local filesystem. It runs
on Node.js only.

- **Inputs** `text` (string, optional) — the content to write (empty when absent); `path` (string,
  optional) — overrides `config.path`.
- **Outputs** `path` (string) — the resolved absolute path; `sizeBytes` (number) — bytes written;
  `appended` (boolean).
- **Config** `path` (string, default `''`); `encoding` (`utf8` | `base64`, default `utf8`);
  `append` (boolean, default `false`); `createDirs` (boolean, default `true`) — create missing parent
  directories.

The path resolves against the run's execution root and must stay inside it, checked after symlinks
are resolved and before any directory is created; a path outside the root fails validation.
Filesystem errors come back as structured failures. No external service or environment variables;
the cost estimate is 0.

Not part of the default node set: a host registers it itself. Contract: [SPEC.md](SPEC.md).
