# DAG Builder

Turns a declarative pipeline spec, or a workflow file read from disk, into a fully wired
`IDagDefinition`. It only constructs definitions; it never executes them.

Internal package: `@robota-sdk/dag-builder` is private to this monorepo (`"private": true`) and not
published to npm. It is part of the DAG workflow subsystem; see
[the DAG packages](../../dag-core/README.md#the-dag-packages).

## Where it sits

- Depends on: [`@robota-sdk/dag-core`](../../dag-core/docs/README.md).
- Used by: [`@robota-sdk/agent-command-workflows`](../../agent-command-workflows/README.md) (workflow
  authoring and file import for `/workflows`), [`dag-framework`](../../dag-framework/docs/README.md)
  (its `build` capability), [`dag-orchestration-client`](../../dag-orchestration-client/docs/README.md)
  and `apps/dag-runtime-server`.

## Main exports

- `buildDagFromPipeline(input, manifests)` — builds a definition from pipeline stages. Sequential
  stages are wired in order and parallel stages (`{ parallel: [...] }`) fan out from and back into
  their neighbours, matching each node type's `defaultOutputPort` to the next one's
  `defaultInputPort`; `fromPort` / `toPort` override that per stage. The caller supplies the
  `INodeManifest[]` that decides which node types exist. Returns `TDagBuildResult`: the definition
  with node and edge counts, or an `IDagError`, plus any wiring warnings.
- `decodeDagFile(parsed, companion?)` — decodes a parsed file in either on-disk format (a workflow
  file with `nodes` + `links`, or a definition with `dagId`) into a `TResult`.
  `dagDefinitionFromParsedFile(parsed, companion?)` is the throwing form (`DagFileDecodeError`).
- `toDagWorkflowFile(definition)` / `fromDagWorkflowFile(file, companion?)` — convert between an
  `IDagDefinition` and the workflow-file format. A `.dag.<identifier>.json` companion carries what the
  file format cannot record (original node ids, retry and cost policies); without it, imported
  nodes are named `node-<n>`.
- `IDagBuildPort` — the build capability as a port, for hosts that expose building as a service.

Decoding is pure and synchronous: a caller that also reads a companion file does that IO itself and
passes the result in.

## Usage

```ts
import { readFile } from 'node:fs/promises';
import { buildDagFromPipeline, dagDefinitionFromParsedFile } from '@robota-sdk/dag-builder';
import { buildNodeDefinitionAssembly } from '@robota-sdk/dag-node';
import { createDefaultNodeRegistrySync } from '@robota-sdk/dag-nodes-default';

// Manifests say which node types exist and which ports to wire by default.
const assembly = buildNodeDefinitionAssembly(createDefaultNodeRegistrySync());
if (!assembly.ok) throw new Error(assembly.error.message);

const built = buildDagFromPipeline(
  {
    dagId: 'shout',
    pipeline: [
      { nodeType: 'input', config: { text: 'hello' } },
      { nodeType: 'text-upper' },
      { nodeType: 'text-output' },
    ],
  },
  assembly.value.manifests,
);
if (built.ok) {
  console.log(built.nodeCount, built.edgeCount, built.definition.status); // 3 2 'draft'
} else {
  console.error(built.error.code); // e.g. 'UNKNOWN_NODE_TYPE'
}

// Import a workflow file or a definition file; throws DagFileDecodeError when it is malformed.
const definition = dagDefinitionFromParsedFile(JSON.parse(await readFile('flow.dag.json', 'utf8')));
```

## Documents

- [SPEC.md](SPEC.md) — purpose, contract and non-goals of the builder and file converter.
