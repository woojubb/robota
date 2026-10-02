# DAG node packages

This folder groups the node packages of Robota's DAG workflow engine. It is not a package itself:
there is no `package.json` here, and nothing is importable as `@robota-sdk/dag-nodes`. Each
subfolder is its own package, named `@robota-sdk/dag-node-<folder>`, that exports one or more node
definitions extending `AbstractNodeDefinition` from `@robota-sdk/dag-node`.

All node packages are internal (`private: true`) and are not published to npm. The shared rules for
them are in [docs/SPEC.md](docs/SPEC.md); media nodes also follow
[docs/MEDIA-PROVIDER-CONTRACT.md](docs/MEDIA-PROVIDER-CONTRACT.md).

## Node packages

Entry, output and text:

- [`@robota-sdk/dag-node-input`](input/docs/README.md) — `input`: emits a text value as a pipeline
  entry point.
- [`@robota-sdk/dag-node-multi-input`](multi-input/docs/README.md) — `multi-input`: emits several
  named text ports as an entry point.
- [`@robota-sdk/dag-node-text-output`](text-output/docs/README.md) — `text-output`: passes text
  through unchanged as the final result.
- [`@robota-sdk/dag-node-text-template`](text-template/docs/README.md) — `text-template`: inserts
  the input text into a template.
- [`@robota-sdk/dag-node-transform`](transform/docs/README.md) — `transform`: prefixes text, or
  passes other inputs through.
- [`@robota-sdk/dag-node-utility-text`](utility-text/docs/README.md) — small text and JSON utility
  nodes (split, join, replace, trim, `json-extract`, `conditional-text`, and more).

AI and media:

- [`@robota-sdk/dag-node-llm-text`](llm-text/docs/README.md) — `llm-text`: generates text with any
  provider from an injected provider registry.
- [`@robota-sdk/dag-node-instant-node`](instant-node/docs/README.md) — runtime-defined nodes:
  prompt-backed LLM nodes and composite nodes that wrap an inner DAG.
- [`@robota-sdk/dag-node-text-to-image`](text-to-image/docs/README.md) — `text-to-image`: generates
  an image from a text prompt.
- [`@robota-sdk/dag-node-gemini-image-edit`](gemini-image-edit/docs/README.md) — `gemini-image-edit`
  and `gemini-image-compose`: edits one image or combines several, guided by a prompt.
- [`@robota-sdk/dag-node-seedance-video`](seedance-video/docs/README.md) — `seedance-video`:
  generates a video from a text prompt.
- [`@robota-sdk/dag-node-image-loader`](image-loader/docs/README.md) — `image-loader`: turns a media
  reference into a binary image value.

Files, network and integrations:

- [`@robota-sdk/dag-node-file-read`](file-read/docs/README.md) — `file-read`: reads a file inside
  the run's execution root.
- [`@robota-sdk/dag-node-file-write`](file-write/docs/README.md) — `file-write`: writes or appends
  to a file inside the run's execution root.
- [`@robota-sdk/dag-node-http-request`](http-request/docs/README.md) — `http-request`: sends an HTTP
  request and emits the response.
- [`@robota-sdk/dag-node-tool`](tool/docs/README.md) — `tool`: runs one allowlisted
  `@robota-sdk/agent-tools` builtin as a step.
- [`@robota-sdk/dag-node-skill`](skill/docs/README.md) — `skill`: resolves an agent runtime skill to its
  prompt for a downstream LLM node.

Test helpers:

- [`@robota-sdk/dag-node-image-source`](image-source/docs/README.md) — `image-source`: emits a
  configured image as a source node.
- [`@robota-sdk/dag-node-ok-emitter`](ok-emitter/docs/README.md) — `ok-emitter`: emits `"ok"` when
  it receives a valid image.

## Default node set

[`@robota-sdk/dag-nodes-default`](../dag-nodes-default/docs/README.md) assembles the default node
set. `createDefaultNodeRegistrySync()` returns the nodes with no provider dependency: the entry,
output, text and utility nodes, `image-loader`, the test helpers, and `tool`.
`createDefaultNodeRegistry()` adds `llm-text`, the image and video nodes, and `skill`; a media or
skill node that cannot be loaded is skipped. `file-read`, `file-write`, `http-request` and
`instant-node` are not part of the default set; a host registers them itself.
