# File Read Node

`@robota-sdk/dag-node-file-read` (internal) exports `FileReadNodeDefinition`, node type `file-read`
(category `File`). It reads a file from the local filesystem and emits its contents. It runs on
Node.js only.

- **Input** `path` (string, optional) — overrides `config.path`.
- **Outputs** `text` (string) — the file contents; `path` (string) — the resolved absolute path;
  `sizeBytes` (number) — the file size.
- **Config** `path` (string, default `''`); `encoding` (`utf8` | `base64`, default `utf8`).

The path resolves against the run's execution root and must stay inside it, checked after symlinks
are resolved; a path outside the root fails validation. Filesystem errors come back as structured
failures. No external service or environment variables; the cost estimate is 0.

Not part of the default node set: a host registers it itself. Contract: [SPEC.md](SPEC.md).
