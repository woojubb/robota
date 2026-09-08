---
status: review-ready
type: INFRA
tags: ['cli', 'typescript']
lane: 'L2'
---

# ARCH-054: invert dag-node provider composition and gate the family

Paired with `.agents/tasks/ARCH-054-invert-dag-node-provider-composition-and-gate-the-family.md`.
Arising from [issue #2158](https://github.com/woojubb/robota/issues/2158).

## Approval Authority

This item is **not** covered by any standing authorization. It changes the published export surface of
`@robota-sdk/dag-node-instant-node` and of the three media node packages, adds a contract type to
`@robota-sdk/agent-core`, and one of its options creates a new workspace package — all of which
[`backlog-execution.md` § Validated recommendations and bounded gate-FAIL corrections](../../rules/backlog-execution.md)
places outside every delegation as a direct-user decision. Four choices are stated in
§ USER-DECISION and must be made before GATE-APPROVAL.

## Problem

### The inversion, measured

Four packages under `packages/dag-nodes/` import a concrete vendor provider, resolve its credential from
the ambient environment, and construct it inside the node. Every number below is from a command run on
`develop` at `3d72df4e7`; each command is reproduced so it can be re-run. None of them follows a
symlink (`find` without `-L`, with `node_modules` and `dist` pruned), because a symlink-following
enumeration in a pnpm workspace reaches the dependency store.

**M1 — manifest edges `dag-node-* → @robota-sdk/agent-provider-*`: 7 edges, 4 packages.**

```bash
node -e "
const fs=require('fs');const p='packages/dag-nodes';let n=0;
for(const d of fs.readdirSync(p)){const f=\`\${p}/\${d}/package.json\`; if(!fs.existsSync(f))continue;
const m=JSON.parse(fs.readFileSync(f,'utf8'));
for(const s of ['dependencies','peerDependencies'])
  for(const k of Object.keys(m[s]||{}))
    if(k.startsWith('@robota-sdk/agent-provider')){console.log(m.name,'|',s,'|',k);n++;}}
console.log('EDGES='+n);"
```

| Package                                  | Vendor dependencies declared                                                                                     |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `@robota-sdk/dag-node-instant-node`      | `agent-provider-anthropic`, `agent-provider-openai`, `agent-provider-gemini`, `agent-provider-openai-compatible` |
| `@robota-sdk/dag-node-gemini-image-edit` | `agent-provider-gemini`                                                                                          |
| `@robota-sdk/dag-node-text-to-image`     | `agent-provider-gemini`                                                                                          |
| `@robota-sdk/dag-node-seedance-video`    | `agent-provider-bytedance`                                                                                       |

**M2 — production source imports of a vendor provider: 8 imports, 4 files; 3 of them subpath imports.**

```bash
find packages/dag-nodes -type d \( -name node_modules -o -name dist \) -prune -o \
  -type f \( -name '*.ts' -o -name '*.tsx' \) -print \
  | grep -v '\.test\.' | grep -v '__tests__' | sort \
  | xargs grep -Hn "from '@robota-sdk/agent-provider"
```

- `packages/dag-nodes/instant-node/src/index.ts:14` — `AnthropicProvider`
- `packages/dag-nodes/instant-node/src/index.ts:15` — `OpenAIProvider`
- `packages/dag-nodes/instant-node/src/index.ts:16` — `GoogleProvider` — **subpath**
  `@robota-sdk/agent-provider-gemini/google`
- `packages/dag-nodes/instant-node/src/index.ts:17` — `DeepSeekProvider`
- `packages/dag-nodes/instant-node/src/index.ts:18` — `QwenProvider`
- `packages/dag-nodes/gemini-image-edit/src/runtime-core.ts:8` — `GoogleProvider` — **subpath**
- `packages/dag-nodes/text-to-image/src/runtime-core.ts:8` — `GoogleProvider` — **subpath**
- `packages/dag-nodes/seedance-video/src/runtime-core.ts:8` — `BytedanceProvider`

**Exactly 3 of the 8 are subpath imports** (`@robota-sdk/agent-provider-openai-compatible` is a plain
package name, not a subpath). Three is still enough to decide the gate's matcher: a rule that compares
the specifier for equality against a package name reports **zero** findings on those three, and zero
findings reads as a pass.

**M3 — concrete provider construction inside a node: 8 sites.**
`instant-node/src/index.ts:113,120,127,134,141` (five `new <Vendor>Provider(...)`, each inside a
`new Robota({...})` at `:111,118,125,132,139`), `gemini-image-edit/src/runtime-core.ts:95`,
`text-to-image/src/runtime-core.ts:97`, `seedance-video/src/runtime-core.ts:120`. 5 + 3 = 8.

**M4 — `process.env` reads in production node sources: 15 lines, 6 files** (comment lines excluded).

```bash
find packages/dag-nodes -type d \( -name node_modules -o -name dist \) -prune -o -type f -name '*.ts' -print \
  | grep -v '\.test\.' | grep -v '__tests__' | sort | xargs grep -Hn "process\.env" \
  | grep -v ":[0-9]*: *\*" | grep -v ":[0-9]*: *//"
```

Of those 15, **6 are credential or endpoint reads** — `instant-node/src/index.ts:82,86`
(`process.env[defaults.envVar]` over the `PROVIDER_DEFAULTS` table at `:62-68`, which hard-codes
`ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` / `DEEPSEEK_API_KEY` / `DASHSCOPE_API_KEY`),
`gemini-image-edit/src/runtime-core.ts:93`, `text-to-image/src/runtime-core.ts:95`, and
`seedance-video/src/runtime-core.ts:112,113`. Eight more are model-policy reads
(`DAG_*_DEFAULT_MODEL`, `DAG_*_ALLOWED_MODELS`, `DAG_RUNTIME_BASE_URL`, `DAG_PORT`). The last is
`mcp-tool/src/index.ts:210`, a different concern: it resolves a `$ENV:` reference the DAG author wrote
into node config, so it is a declared indirection rather than an ambient credential lookup, and it is
called out separately in § Solution.

**M5 — the same five-vendor list is copied outside the owning package.**
`packages/dag-cli/src/mcp/handlers/instant-nodes.ts:76-82` declares
`const validProviders: TInstantNodeProvider[] = ['anthropic','openai','gemini','deepseek','qwen'];`
and does not call `isInstantNodeProvider`. `INSTANT_NODE_PROVIDERS` is declared "The single runtime
source of truth for the supported instant-node providers" (`instant-node/src/index.ts:23-33`), so this
copy already contradicts its own SSOT claim and must be deleted by whichever D1 option is chosen.

**M6 — the family's only non-`@robota-sdk` production dependencies are `zod` and
`@modelcontextprotocol/sdk`.** Measured over `dependencies` + `peerDependencies` of all 20 members.
That measurement is what makes an allow-set gate cheap; see § S1.

### The corrected sibling exists in the same directory

`packages/dag-nodes/llm-text/src/index.ts` is the same kind of node with the composition inverted. Its
own header states the property:

> Collapsed, provider-registry-driven LLM text node (ARCH-PROVIDER-003). … The node is constructed with
> an injected {@link IProviderDefinition} registry and resolves the target `IAIProvider` through
> {@link normalizeProviderConfig} + {@link createProviderFromConfig} — so it reads **no** `process.env`
> itself (credential/`$ENV:` resolution lives in `agent-core`).
>
> — `packages/dag-nodes/llm-text/src/index.ts:38-46`

The load-bearing detail, which drives § Decision: **it receives a DEFINITION, not an instance.** The
concrete `IAIProvider` is built at execution time from the definition's factory, which is what lets the
node skip a provider whose credential is unresolvable and report why.

`packages/dag-nodes/skill/src/index.ts:67` is the other corrected shape: its constructor takes an
`ISkillExecutionPort`, and `packages/dag-nodes-default/src/index.ts:161` builds the concrete port at the
aggregator. Both mechanisms this item needs already exist in production — what is missing is their
application to the remaining four packages, and anything that would notice their absence.

### Why the existing gates are green on all of it

`node scripts/harness/check-dependency-direction.mjs` exits `0` on this tree. Three gates could
plausibly be the one that fires, and each declines for a stated reason:

1. **`DAG-NODES-LEAF` (rule 7, `check-dependency-direction.mjs:checkDagNodesLeaf`) is scoped to
   intra-DAG edges by construction.** Its loop body is
   `if (!dep.startsWith(dagPrefix)) continue; // only intra-DAG edges are policed here` (`:315`), and
   its header (`:298-299`) says so in words: "Scope: intra-DAG leaf-ness only — the cross-subsystem
   `dag-node-* → agent-*` assembly reach (ARL-11) is a separate invariant not policed here." A
   `dag-node-* → agent-provider-*` edge is never even examined. This is the decisive gap: the rule that
   reads exactly these packages' manifests has the vendor edges in front of it and skips them by design.

2. **`ENTRY-POINT-ONLY` (rule 8) guards aggregators, not leaves.** `GUARDED_AGGREGATORS` (`:345-364`)
   names `@robota-sdk/agent-tool-defaults` and `@robota-sdk/dag-nodes-default`; it asks who may
   statically import a catalog, not what a catalog member may import.

3. **`provider-env-resolution` reads three files.** Its subject is a hard-coded constant
   (`scan-provider-env-resolution.mjs:21-25`): the two `provider-factory.ts` modules and
   `agent-core/src/utils/env-ref.ts`. Its `::examined::` line reports "3 normalization module(s)", so
   the scan is honest about its reach — nobody widened it.

The `purity` rules in `.agents/harness.config.json` (1 entry) and the `compositionNeutrality` rules
(2 entries) both have the right _shape_ for this problem and the wrong _subject_: each is a list of
explicit `dir` entries. An enumerated list cannot be a family gate — a twenty-first node package added
tomorrow is outside every list, and the list not covering it produces silence, not a finding. That is
the property this item has to add and the reason the issue calls the missing artifact a _family_ gate.

## Prior Art Research

Scope: product documentation only — documentation sites, API references, published linter rule
documentation and release notes. No third-party source code was read. Every claim below carries the
original wording of the sentence it rests on; the four load-bearing quotes were re-fetched and verified
verbatim against the live pages while writing this section.

### Sources

| #   | Source                                           | URL                                                                                                                         |
| --- | ------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- |
| S1  | n8n — Credentials files                          | https://docs.n8n.io/connect/create-nodes/build-your-node/reference/credentials-files                                        |
| S2  | n8n — Verification guidelines                    | https://docs.n8n.io/connect/create-nodes/build-your-node/reference/verification-guidelines/                                 |
| S3  | n8n — Node linter                                | https://docs.n8n.io/connect/create-nodes/test-your-node/node-linter                                                         |
| S4  | n8n — `no-restricted-globals` rule documentation | https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/eslint-plugin-community-nodes/docs/rules/no-restricted-globals.md |
| S5  | n8n — `no-restricted-imports` rule documentation | https://github.com/n8n-io/n8n/blob/master/packages/%40n8n/eslint-plugin-community-nodes/docs/rules/no-restricted-imports.md |
| S6  | Airflow — Connections & Hooks                    | https://airflow.apache.org/docs/apache-airflow/stable/authoring-and-scheduling/connections.html                             |
| S7  | Airflow — Provider packages                      | https://airflow.apache.org/docs/apache-airflow-providers/index.html                                                         |
| S8  | Dagster — Defining resources                     | https://docs.dagster.io/guides/build/external-resources/defining-resources                                                  |
| S9  | Dagster — Configuring resources                  | https://docs.dagster.io/guides/build/external-resources/configuring-resources                                               |
| S10 | Prefect — Blocks                                 | https://docs.prefect.io/v3/concepts/blocks                                                                                  |
| S11 | Vercel AI SDK — Anthropic provider               | https://ai-sdk.dev/providers/ai-sdk-providers/anthropic                                                                     |

S4 and S5 are the published rule-documentation pages of the linter S3 designates as n8n's official node
linter — documentation, not implementation source.

### Observed common behavior

**The step declares; the composition layer binds — and it binds a factory, not a live client.** Dagster
states both halves in one page: "Assets specify resource dependencies by annotating the resource as a
parameter to the asset function." and "Attach them to the [@dg.Definitions] function. These resources
are automatically passed to the function at runtime." (S8, both verified verbatim). The credential is
resolved late, at that same layer: "Resources can be configured using environment variables, which is
useful for secrets or other environment-specific configuration." (S9). Airflow separates the same two
roles by name — "A Connection is essentially set of parameters - such as username, password and
hostname - along with the type of system that it connects to, and a unique name, called the `conn_id`."
and "A Hook is a high-level interface to an external platform that lets you quickly and easily talk to
them without having to write low-level code that hits their API or uses special libraries.", with "They
integrate with Connections to gather credentials, and many have a default `conn_id`." (S6, all three
verified verbatim) — and puts the vendor SDK in the provider package that owns the hook: "Providers can
contain operators, hooks, sensor, and transfer operators to communicate with a multitude of external
systems" (S7). Prefect's equivalent: "The most common use case for blocks is storing credentials used to
access external systems such as AWS or GCP." (S10). n8n keeps the credential in a file separate from the
node — "The credentials file defines the authorization methods for the node." (S1).

The `conn_id` / `Definitions` / block shape is a **late-bound reference**, not an eagerly constructed
client handed to the step. That distinction is what § Decision turns on.

**A mechanical gate over node packages has direct precedent, and it is an allow-set.** S3: "n8n's node
linter, `@n8n/eslint-plugin-community-nodes`, statically analyzes ("lints") the source code of n8n nodes
and credentials in community packages." Its verification guidelines state the dependency rule in the
allow direction — "Ensure that your package does **not** include any external dependencies to keep it
lightweight and easy to maintain." — the environment rule — "The code **must not** interact with
environment variables or attempt to read/write files." — and make the linter a precondition rather than
advice: "Make sure the linter passes (in other words, make sure running
`npx @n8n/scan-community-package n8n-nodes-PACKAGE` passes)." (S2, all three verified verbatim). Its
`no-restricted-globals` rule documentation states its purpose as "Prevents the use of Node.js global
variables that are not allowed in n8n Cloud." and lists them: "Restricted globals include:
`clearInterval`, `clearTimeout`, `global`, `globalThis`, `process`, `setInterval`, `setTimeout`,
`setImmediate`, `clearImmediate`, `__dirname`, `__filename`." (S4, verified verbatim — `process` is
named, and so is `globalThis`). `no-restricted-imports` (S5) supplies the import allowlist.

### The documented counter-example, and what it actually shows

Environment-variable defaulting IS documented as legitimate — one layer below the node. The Vercel AI
SDK's Anthropic provider documents an API key "that is being sent using the `x-api-key` header. It
defaults to the `ANTHROPIC_API_KEY` environment variable." (S11), alongside an explicit
`createAnthropic` factory for callers who want to pass it. That is the _client package_ defaulting its
own credential, which is exactly where `@robota-sdk/agent-provider-*` sits — not where
`@robota-sdk/dag-node-instant-node` sits. **No comparable reference was found for a workflow-graph node
or step definition documented as legitimately owning vendor-client construction together with credential
resolution**; that is a statement about what this search found, not a claim about every product that
exists.

### Constraint that applies to Robota

Robota's `packages/dag-nodes/*` are published, individually installable extension-point members — the
Family Decomposition Rule in `.agents/project-structure.md:364` records the DAG-node family as a
"per-member split" precisely because "each node is a registry-registered extension-point member a
consumer/3rd party adds à la carte". That makes n8n's community-node constraints (S2, S4, S5) the
closest structural analogue, and it makes the aggregator (`dag-nodes-default`, `dag-cli`'s
`createCliNodeRegistry`) the analogue of Dagster's `Definitions` (S8). Robota's enforcement idiom is a
`pnpm harness:scan` entry rather than an ESLint plugin, so what transfers from S3–S5 is the _rule
shape_ — allow-set dependency check, import allowlist, banned global — not the tool.

## Architecture Review

### Affected Scope

Contract owner:

- `packages/agent-core/src/interfaces/media-provider-definition.ts` (new) — the media provider
  _definition_ contract; `packages/agent-core/src/interfaces/index.ts` and `src/index.ts` re-export
- `packages/agent-core/src/interfaces/media-provider.ts` — existing `IImageGenerationProvider` (`:67`),
  `IVideoGenerationProvider` (`:100`), `isImageGenerationProvider` (`:106`), `isVideoGenerationProvider`
  (`:117`); unchanged, consumed by the new definition type
- `packages/dag-core/src/types/node-lifecycle.ts:13-25` — `INodeExecutionContext` gains one optional
  `runtimeBaseUrl?: string` field (see § S5)

Node packages (the inversion):

- `packages/dag-nodes/instant-node/{package.json,src/index.ts}`
- `packages/dag-nodes/gemini-image-edit/{package.json,src/index.ts,src/runtime-core.ts,src/runtime-helpers.ts}`
- `packages/dag-nodes/text-to-image/{package.json,src/index.ts,src/runtime-core.ts}`
- `packages/dag-nodes/seedance-video/{package.json,src/index.ts,src/runtime-core.ts}`

Composition roots (the injection):

- `packages/dag-nodes-default/src/index.ts` — the three media entries in `optionalLoaders` (`:113-129`)
  construct with no arguments today; `loadDefaultProviderDefinitions` (`:78-93`) is the lazy-load
  precedent the media set follows
- `packages/dag-cli/src/local-runner/node-registry.ts:19-20` — `new GeminiImageEditNodeDefinition()` /
  `new GeminiImageComposeNodeDefinition()`; line `:18` already shows the target shape for LLM
- `packages/dag-cli/src/local-runner/persistence/store.ts:125` — `rehydrateInstantNode`
- `packages/dag-cli/src/mcp/handlers/instant-nodes.ts:76-82` — the hard-coded vendor list (M5) plus the
  `createPromptBackedNodeDefinition` call
- `packages/agent-command-workflows/{package.json,src/authoring/pipeline.ts,src/persistence/instant-node-loader.ts}`
  — `package.json` is in scope because this package does **not** depend on
  `@robota-sdk/agent-builtin-providers` and `@robota-sdk/agent-framework` does not export
  `IProviderDefinition`; it therefore has no path to a registry today (see § S4)

Harness:

- `scripts/harness/scan-composition-neutrality.mjs` — **generalized, not forked** (§ S1)
- `scripts/harness/__tests__/scan-composition-neutrality.test.mjs` — new RED-proof cases
- `scripts/harness/node-family-composition-baseline.json` (new, removed in U4)
- `scripts/harness/run-all-scans.mjs` — the `composition-neutrality` entry's `examines` list (`:1116-1120`)
- `.agents/harness.config.json` — `compositionNeutrality` gains a family entry
- `ARCHITECTURE.md` § Dependency and interface rule identifiers
- `.agents/project-structure.md` § Family Decomposition Rule
- `packages/dag-nodes/docs/SPEC.md`, `packages/dag-nodes/docs/MEDIA-PROVIDER-CONTRACT.md`
- `packages/agent-builtin-providers/**` (only under USER-DECISION D2-A)

### Sibling scan

The `dag-nodes` packages that declare `@robota-sdk/agent-*` dependencies but are NOT in scope were
checked and are correct as they stand: `dag-node-llm-text` (`agent-core` only, registry injected),
`dag-node-skill` (`agent-core` + `agent-interface-command`, port injected), `dag-node-tool`
(`agent-core` + `agent-tools`, a neutral tool-factory package, not a vendor SDK), and
`dag-node-file-read` / `-file-write` (`agent-core` only). Outside `packages/dag-nodes/`, the same
enumeration over every other `packages/dag-*` package returns zero `@robota-sdk/agent-provider-*`
dependencies and zero such imports, so the inversion is confined to the node family and no
orchestrator-layer sibling shares it.

### Alternatives Considered

1. **A1 — Inject into `instant-node` only; leave the media nodes.**
   **Pro:** smallest diff; removes 5 of the 8 imports and both credential env reads.
   **Con:** exactly the fix the depth guardian rejected as insufficient for finding `ACLI-R1-F016`. Leaves
   three packages inverted, leaves the family gate unwritten, and leaves the next media node free to repeat
   the pattern.

2. **A2 — Relocate the four packages out of `packages/dag-nodes/` into the product tier.**
   **Pro:** makes the current direction legal with no contract change.
   **Con:** contradicts the Family Decomposition Rule (`.agents/project-structure.md:364`), and answers the
   wrong question — the issue says "This is not package-granularity work tracked by ARCH-051. It is the
   direction and ownership of concrete provider composition."

3. **A3 — Inject a constructed capability INSTANCE into the media nodes
   (`readonly imageProvider: IImageGenerationProvider`).**
   **Pro:** no new contract type; the node depends on exactly the interface
   `MEDIA-PROVIDER-CONTRACT.md` names.
   **Con** — four consequences, all verified in code, and this is why it is rejected:_
   (i) `createCliNodeRegistry()` (`packages/dag-cli/src/local-runner/node-registry.ts:15`) is a
   **synchronous** function, so the credential must be read at registry-construction time rather than at
   node-execution time as today;
   (ii) with no credential there is no instance, so the media nodes cannot be constructed and drop out of
   the registry — measurably, `createCliNodeRegistry` builds `gemini-image-edit` and
   `gemini-image-compose` unconditionally today (`node-registry.ts:19-20`) and `dag node list` renders
   exactly that registry (`packages/dag-cli/src/commands/node.ts:950`), so both would disappear from
   `robota-dag node list` on a machine with no `GEMINI_API_KEY`; the other two arrive through
   `dag-nodes-default`'s async `optionalLoaders` and would disappear there. A user-visible behaviour
   change under **every** D2 option, not only D2-C;
   (iii) `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED` (`text-to-image/src/runtime-core.ts:112`),
   `DAG_VALIDATION_GEMINI_API_KEY_REQUIRED` (`gemini-image-edit/src/runtime-core.ts:111`) and
   `DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED` (`seedance-video/src/runtime-core.ts:157`) all
   express "the provider is absent", which a required instance makes unreachable;
   (iv) **a defence layer disappears silently.** Today `runtime-core.ts:95-99` / `:97-100` calls
   `new GoogleProvider({ apiKey, imageCapableModels: allowedModels })` — the node's resolved allowlist is
   handed to the provider constructor. An externally built provider has `imageCapableModels: undefined`,
   and `isImageCapableModel` (`packages/agent-provider-gemini/src/gemini/image-operations.ts:135-142`,
   consumed at `:174`) **returns `true` unconditionally when the configured list is empty or undefined**.
   One half of a two-layer model gate would vanish with no finding anywhere.

4. **A4 — Extend `IProviderDefinition` with optional media factories.**
   **Pro:** one registry; `ARCH-PROVIDER-001` § "Key decisions" D3 argues that "a parallel registry would be
   a second SSOT".
   **Con:** `IProviderDefinition.createProvider` is **required** and returns `IAIProvider`
   (`packages/agent-core/src/interfaces/provider-definition.ts:162`). A video-only vendor has no
   `IAIProvider` to return and would need a throwing dummy — a contract that lies about what its members
   can do. D3's reasoning is about a second registry for the _same_ capability.

5. **A5 — Runtime capability lookup inside the node from an ambient registry.**
   **Pro:** no constructor-signature change.
   **Con:** moves the coupling from compile time to run time without removing it, and removes the edge the
   scan can see — the opposite of what this item buys.

6. **A6 — Inject a media provider DEFINITION (factory + credential requirement), owned by `agent-core`.**
   A new type beside `IProviderDefinition`, not inside it:

```ts
export interface IMediaProviderDefinition {
  readonly type: string;
  readonly credentialRequirement?: IProviderCredentialRequirement;
  readonly defaults?: { readonly model?: string; readonly allowedModels?: readonly string[] };
  readonly createImageProvider?: (config: IMediaProviderConfig) => IImageGenerationProvider;
  readonly createVideoProvider?: (config: IMediaProviderConfig) => IVideoGenerationProvider;
}
```

**Pro:** symmetrical with the sibling this spec cites — the node receives a definition and builds the
client lazily, so (i)–(iv) above do not occur: the credential is still resolved at execution time,
the three `*_API_KEY_REQUIRED` / `*_CREDENTIALS_REQUIRED` errors stay reachable and become "the
definition's credential did not resolve", and `imageCapableModels` is filled from the node's own
resolved allowlist at `createImageProvider(...)` call time, keeping both layers of the model gate.
Credential resolution stays inside `agent-core`, so `provider-env-resolution` keeps guarding it.
`MEDIA-PROVIDER-CONTRACT.md` is not violated: the type the node depends on is still
`IImageGenerationProvider` / `IVideoGenerationProvider`, and its required runtime check
`isImageGenerationProvider(provider)` sits naturally on the factory's return value.
**Con:** one new contract type in `agent-core` (a published surface addition) and one extra sequenced
unit; `createProvider`-style optionality means a definition that declares neither factory is
meaningless and needs a construction-time refusal.

### Decision

**A6 for the media axis, the `IProviderDefinition` registry for `instant-node`; A3 rejected on the four
measured consequences above, A4 rejected on the contract shape.**

**Why the media nodes take a definition rather than an instance.** The spec's own cited exemplar,
`dag-node-llm-text`, receives definitions and constructs the client at execution time; that is the
property that lets it skip an unresolvable provider and say why. An instance-shaped injection is not
the same inversion with a smaller diff — it is a different design that trades away lazy credential
resolution, three existing typed errors, and one layer of the model gate (A3 (i)–(iv)). The prior art
points the same way: `conn_id` (S6), `Definitions` resources (S8) and blocks (S10) are all late-bound
references, not eagerly constructed clients.

**Why a separate definition type rather than extending `IProviderDefinition`.** A4's rejection stands on
`provider-definition.ts:162` and is not an effort argument. Image and video are different capabilities
with contracts `agent-core` already owns; D3's "second SSOT" warning applies to a second registry for
the same capability, which this is not.

**Why `instant-node` takes the registry rather than a single provider.** It does select at run time —
`resolveProviderInstance` (`instant-node/src/index.ts:77`) switches on five vendors — so it is the
problem `LlmTextNodeDefinition` already solved, and should be solved the same way:
`findProviderDefinition(registry, type)` + `normalizeProviderConfig` + `createProviderFromConfig`, with
`$ENV:` and `env-default` credential resolution staying in `agent-core`.

**Validation before approval.** Reachability: every construction site is enumerated in § Affected Scope
and each has a composition owner that can supply the value — with one exception now made explicit,
`agent-command-workflows`, which has no path to a registry today and whose acquisition path is decided
in § S4 and put to the user in D1. Capability preservation: the credential diagnostic at
`instant-node/src/index.ts:88-104`, the three media `*_API_KEY_REQUIRED`/`*_CREDENTIALS_REQUIRED`
errors, the model allowlists, and `imageCapableModels` are each carried by a named completion criterion
(TC-12, TC-13) rather than left to be noticed. Adversarial pass: the failure mode most likely to ship is
the gate passing for the wrong reason — a baseline that outlives its violation, an equality import match
that misses the three subpath imports, a directory-based subject that a name-based family member
escapes, a deny-list that `@google/genai` walks around, and a member enumeration that silently yields
zero. All five are asserted against as RED-proofs in TC-01/02/03/14, not as green checks.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `scripts/harness/scan-composition-neutrality.mjs`, `.agents/harness.config.json`, `scripts/harness/node-family-composition-baseline.json`, `packages/agent-core/src/interfaces/media-provider-definition.ts`, `packages/dag-nodes/gemini-image-edit/src/runtime-core.ts`, `packages/dag-nodes/text-to-image/src/runtime-core.ts`, `packages/dag-nodes/seedance-video/src/runtime-core.ts`, `packages/dag-cli/src/local-runner/node-registry.ts`, `packages/dag-nodes/instant-node/src/index.ts`, `packages/agent-command-workflows/src/authoring/pipeline.ts`, `ARCHITECTURE.md`

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 1 contract owner, 4 node packages, 6 composition roots, 9 harness/doc paths, listed in § Affected Scope
- [x] Sibling scan 완료 — every other `packages/dag-nodes/*` and every other `packages/dag-*` package enumerated; results in § Sibling scan
- [x] 대안 최소 2개 검토 완료 — 6 alternatives (A1–A6), each with Pro/Con and code-level evidence for the rejections
- [x] 결정 근거 문서화 완료 — § Decision, including the four measured consequences that reject A3 and the contract shape that rejects A4

## Fallback & Degradation Declaration

This change **removes** two existing silent fallbacks, **preserves** one, and **changes the failure mode
of one loader** — the last of which is declared here rather than assumed.

**Removed.** The `?? process.env.<VAR>` chains at `gemini-image-edit/src/runtime-core.ts:75,89,93`,
`text-to-image/src/runtime-core.ts:77,91,95` and `seedance-video/src/runtime-core.ts:94,108,112,113`,
where an absent constructor option silently falls through to the ambient environment. After this item
the value is injected, or the node returns its existing typed validation error.

**Preserved.** The per-node optional loaders at `packages/dag-nodes-default/src/index.ts:168-198`
(`tryImport` / `tryConstruct`) skip a media node whose optional peer SDK is absent, each already
carrying `// allow-fallback:`. Under A6 the node is still constructible without a credential — a
definition is data — so credential absence does **not** move into this path, and the skip keeps meaning
"the node package is not installed".

**Changed, and this is the part A3 would have hidden.** Whoever owns media provider **definitions**
becomes a new load point in `dag-nodes-default`. The LLM precedent
(`loadDefaultProviderDefinitions`, `:78-93`) deliberately **throws a typed diagnostic naming the missing
package instead of skipping**, and the media set will follow it, so "the media definition set could not
be loaded" is a loud error rather than three quietly missing nodes. That is a deliberate divergence from
the per-node skip above and is declared here as a sanctioned single-path decision, not a fallback:
partial silence about which nodes exist is the failure this repository's registry diagnostics already
refuse.

**Not a fallback, but a behaviour change to declare:** under option D2-C the media nodes are absent from
`createDefaultNodeRegistry()` for any consumer that injects nothing, and a DAG using `text-to-image`
then fails validation with an unknown node type. Under A6 this happens **only** under D2-C — with A3 it
would have happened under every D2 option whenever a credential was missing, which is the asymmetry
§ Decision rejects A3 for.

## Solution

### S1 — the gate: generalize the existing scan, do not fork it

`scripts/harness/scan-composition-neutrality.mjs` already owns (a) `findForbiddenDependencies` with
prefix matching across all three manifest sections (`:68-88`), (b)(c) AST-based `findIoViolations` with
the HARNESS-048 alias map and `x['id']`→`x.id` normalisation (`:315-338`), `SCAN-TARGET-MISSING` as a
hard finding (`:459-472`), and pure exported check functions the test drives directly. Forking it would
put the same three checks in two files and make the next AST-evasion fix a two-place change — the exact
regression HARNESS-048 was written to end. `#2163` (ARCH-058) also announces a "future node admission"
contract over `packages/dag-nodes/*`, so the generalized policy is the seat that keeps that from
becoming a third scan over one directory.

**Three structural additions, and nothing else:**

1. **Family subject, resolved by package NAME.** A policy entry may declare `familyNamePrefix:
"@robota-sdk/dag-node-"` instead of `dir`. Members are resolved through
   `listWorkspacePackageDirs(root)` (`scripts/harness/workspace-packages.mjs:108`), which is already
   nesting-aware, by reading each manifest's `name`. **Name, not directory** — because rule 7 defines
   this family by name (`nodePrefix = \`${HARNESS.npmScopePrefix}dag-node-\``,
`check-dependency-direction.mjs:305`) and the Family Decomposition Rule keys its row `dag-node-*`.
Today all 20 members happen to sit under `packages/dag-nodes/`, so the two definitions coincide; a
package created at `packages/dag-node-foo/`tomorrow would be inside rule 7 and outside a
directory-scoped gate, and that disagreement would appear as silence. The entry additionally
declares`familyHomeDir: "packages/dag-nodes"`, and a member resolved **outside** it is itself a
   finding, so the two guards can never drift apart about who the family is.
2. **`allowedDependencies` / `allowedDependencyPrefixes` — the allow direction.**
   [`enforcement-architecture.md`](../../rules/enforcement-architecture.md) § 6 is explicit: "**enumerate
   what is excluded, not what is recognised**", because "A guard that decides by a LIST of recognised
   inputs answers 'not my business' to everything the list forgot — and that answer is silent." A
   deny-list of `@robota-sdk/agent-provider-` is that shape, and its escape hatch is one line long:
   a node that imports **`@google/genai` directly** passes, and that SDK is already in the tree as a
   `peerDependency` of `packages/dag-nodes-default`. The n8n rule this spec cites is also in the allow
   direction ("does not include any external dependencies", S2). The family's allow-set, from M6:
   `{@robota-sdk/dag-core, @robota-sdk/dag-node, @robota-sdk/agent-core, @robota-sdk/agent-tools,
@robota-sdk/agent-interface-command, zod}` plus the frozen exception
   `@modelcontextprotocol/sdk` (dag-node-mcp-tool, an MCP client is the node's entire purpose). This is
   the idiom rule 7 already uses in the same family (`allowedDagTargets` + `DAG_NODES_LEAF_ALLOWLIST`,
   `check-dependency-direction.mjs:307-310, 291`). Import specifiers are matched by **prefix**, so
   `@robota-sdk/agent-core/node` resolves to its package and the three subpath vendor imports (M2) are
   caught; the existing exact-match `forbiddenImports` set stays for the two `dir` entries, which do
   not need prefixes.
3. **A shrinking frozen baseline.** `node-family-composition-baseline.json` freezes exactly the findings
   measured in § Problem, keyed by `package + kind + id + file`. A listed entry with no corresponding
   violation is a finding, so the file cannot outlive the migration; an unlisted finding fails, so a
   fifth inverted node package is refused from U1 onward. The idiom is established here
   (`scan-file-size.mjs:169-186`, `scan-named-artifact-resolves.mjs:265,285`).

**`forbiddenIdentifiers` for the family entry is `["process.env", "globalThis.process"]`** — the same
pair the two existing entries carry. Narrowing it to `process.env` alone would drop precisely the form
HARNESS-048's evasion audit planted (`globalThis['process'].env['HOME']`), and S4's restricted-globals
list names `globalThis` alongside `process`.

**Scope over tests: total, matching the model.** `scan-composition-neutrality.mjs` walks with
`excludeTests: false` and its comment says "the guard is total". The family entry keeps that. Measured
cost today: the 30 test files under `packages/dag-nodes/` contain **0** literal `process.env` reads
(they use `vi.stubEnv`), so the choice adds nothing to the frozen baseline — but it is stated because
the baseline's size depends on it.

**The member-count floor closes the last silent-pass hole.** `SCAN-TARGET-MISSING` covers a missing
`familyHomeDir`, a member without `src/`, and a member without `package.json`. It does not cover
_"the family resolved to zero members"_ — findings 0, exit 0, which is "could not check" collapsing into
"checked and fine". The entry therefore declares `minMembers`, the scan prints
`::examined:: <n> family member(s)`, and `n < minMembers` is a hard finding.

**Rule statement, and what actually checks it.** `ARCHITECTURE.md` § Dependency and interface rule
identifiers gains a `DAG-NODE-COMPOSITION` entry in that section's existing form, and
`.agents/project-structure.md` § Family Decomposition Rule gains one sentence binding the direction to
the `dag-node-*` row.

**Correction to the previous draft of this spec, stated because it was load-bearing there:**
`scan-rule-statement-floor.mjs` does **not** require an `Enforced by:` line — the string does not appear
in that file at all. What it requires is that every identifier a scan _emits_ is **stated in some
normative document**; it says so itself: "It checks that a statement EXISTS, not that the statement is
correct, current, or says what the scan enforces." The only scan that demands `Enforced by:` is
`scan-new-rule-declares-enforcement.mjs`, and it reads **the diff of `.agents/rules/` only**. Neither
`ARCHITECTURE.md` nor `.agents/project-structure.md` is in its reach, so the `Enforced by:` line this
item adds is **prose no machine checks**. TC-11 is therefore written to assert the line's exact shape in
this repository's own tree, which is the most this item can honestly buy; widening the enforcement scan
is filed as a separate root item in § Out of scope.

`mcp-tool/src/index.ts:210` survives on its own terms: it resolves a `$ENV:` reference the DAG author
put in node config — a declared indirection, not an ambient credential lookup. It stays in the baseline
through U3 and U4 moves it into a named permanent `exemptions` list carrying its reason, so that
"the baseline is empty" stays a true statement.

### S2 — media nodes (A6)

`agent-core` gains `IMediaProviderDefinition` (shape in A6). The three node runtimes take it:

```ts
export interface ITextToImageRuntimeOptions {
  readonly imageProviderDefinition: IMediaProviderDefinition;
  readonly defaultModel?: string;
  readonly allowedModels?: readonly string[];
}
```

`resolveProvider(allowedModels)` keeps its signature and its meaning and changes only its body: instead
of reading `process.env.GEMINI_API_KEY` and calling `new GoogleProvider(...)`, it calls
`definition.createImageProvider({ credential, imageCapableModels: allowedModels })`, where the
credential is resolved by `agent-core` from the definition's `credentialRequirement`. Three properties
follow directly and each is a completion criterion:

- **the credential is still read at execution time**, so `createCliNodeRegistry()` stays synchronous and
  the registry is built without any key present;
- **`getImageProviderCapability` still receives `undefined`** when the credential does not resolve, so
  `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED` (`:112`),
  `DAG_VALIDATION_GEMINI_API_KEY_REQUIRED` (`:111`) and
  `DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED` (`:157`) remain reachable;
- **`imageCapableModels` keeps its value** — it is passed into the factory at call time from the node's
  own resolved allowlist, so `isImageCapableModel` never falls back to its unconditional-`true` branch
  (`image-operations.ts:135-142`).

`isImageGenerationProvider` / `isVideoGenerationProvider` are applied to the factory's return value, as
`MEDIA-PROVIDER-CONTRACT.md` requires.

### S3 — instant-node

`ICreatePromptNodeInput` keeps `provider` and `model` as **data**; `IPersistedPromptNode` does not
change (DATA-003 made it the round-trip SSOT). What changes is that the definition is constructed with a
registry:

```ts
export interface IPromptNodeDeps {
  readonly providers: readonly IProviderDefinition[];
}
export function createPromptBackedNodeDefinition(
  spec: ICreatePromptNodeInput,
  deps: IPromptNodeDeps,
): PromptBackedNodeDefinition;
```

`resolveProviderInstance` (`:77-148`) collapses from a five-arm `switch` plus the `PROVIDER_DEFAULTS`
env-var table into `findProviderDefinition` + `normalizeProviderConfig` + `createProviderFromConfig`.
`IRehydrateInstantNodeDeps` gains `providers` beside `compositeRunner`. `PROVIDER_DEFAULTS`' per-vendor
default model migrates into the `IProviderDefinition.defaults` field that already exists for it.

Whether `INSTANT_NODE_PROVIDERS` / `isInstantNodeProvider` survive is D1, and the consequence the
previous draft missed is stated there: making validity registry-dependent makes a stored
`provider: 'qwen'` valid in one host and unknown in another, which is a real change to what DATA-003
declared a round-trip SSOT. The hard-coded copy at
`packages/dag-cli/src/mcp/handlers/instant-nodes.ts:76-82` (M5) is deleted under every D1 option.

### S4 — composition roots, including the one with no path today

`createCliNodeRegistry` already models the target at
`packages/dag-cli/src/local-runner/node-registry.ts:18`; `:19-20` gain the media definition the same
way. `dag-nodes-default`'s three `optionalLoaders` entries (`:113-129`) gain a constructor argument,
sourced through a lazy-import path shaped like `loadDefaultProviderDefinitions` (`:78-93`), so
`dag-framework` gains no static provider-SDK edge and `ENTRY-POINT-ONLY` is unaffected.

**`agent-command-workflows` is the exception and it is decided here, not left implicit.** Its
`dependencies` are `agent-core`, `agent-framework`, `agent-interface-command`, `dag-builder`,
`dag-core`, `dag-framework`, `dag-node`, `dag-node-instant-node`, `dag-nodes-default` — no
`agent-builtin-providers` — and `agent-framework` does not export `IProviderDefinition`. Two paths
exist and D1's options carry the choice:

- **P1 (recommended):** the registry arrives through the existing `IWorkflowsAuthoringDeps` injection
  point, supplied by the command's composition root. No new manifest edge; the package stays
  provider-agnostic, which matches the Command Package Rule.
- **P2:** add `@robota-sdk/agent-builtin-providers` to its `dependencies`. Legal under the
  dependency-direction rules (it is a leaf aggregator, and no cycle results), but it puts a concrete
  default provider set inside a command package.

Either way `packages/agent-command-workflows/package.json` is in § Affected Scope, which the previous
draft omitted.

### S5 — `DAG_RUNTIME_BASE_URL` / `DAG_PORT`

`resolveRuntimeBaseUrl()` (`gemini-image-edit/src/runtime-helpers.ts:47-61`, called at
`runtime-core.ts:189,263`) resolves the DAG runtime's own asset base URL. It is a **run-scope** value,
not a definition-scope one: freezing it into a node definition's constructor options would bake one
run's server address into a definition that outlives it. It therefore moves to
`INodeExecutionContext` (`packages/dag-core/src/types/node-lifecycle.ts:13-25`) as one optional
`runtimeBaseUrl?: string`, populated by the runtime that already knows its own address, with the
existing `http://127.0.0.1:3011` default retained in the runtime rather than in the node. The cost is
explicit: this is a `dag-core` contract addition, one optional field, and it is why the field appears in
§ Affected Scope. The alternative — a constructor option — is cheaper and wrong for the reason above.
Check (c) stays **total**: a per-line exemption inside a total guard is how a guard erodes.

### Sequencing

Six sequenced units, in this order, each leaving `pnpm harness:scan` and the affected suites green:

| Unit | Content                                                                                                                                                                                                                    | Baseline after |
| ---- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------- |
| U0   | generalize `scan-composition-neutrality`: family subject by name, allow-set direction, import prefixes, `minMembers`, baseline support. No policy entry added; the two existing entries keep exactly today's findings (0). | n/a            |
| U1   | register the DAG-node family as a policy entry + frozen baseline at today's counts + rule statements                                                                                                                       | 4 packages     |
| U1.5 | `agent-core` `IMediaProviderDefinition` + `MEDIA-PROVIDER-CONTRACT.md`; no consumer yet                                                                                                                                    | 4 packages     |
| U2   | media provider definition owner (per D2) + three media nodes + their composition roots + `INodeExecutionContext` field                                                                                                     | 1 package      |
| U3   | instant-node + its four composition roots + the M5 hard-coded copy                                                                                                                                                         | 0 packages     |
| U4   | delete the baseline; move `mcp-tool:210` to `exemptions`; docs                                                                                                                                                             | file removed   |

U0 and U1.5 are the seams that keep a harness refactor and a contract addition from being reviewed
inside a node migration; each is independently mergeable and green on its own.

**Gate before migration, not after — and the baseline freeze is what makes that possible.** Arming with
an empty baseline would require the whole migration in one change, which is precisely the scope the
depth guardian called FOUNDATIONAL. Arming last leaves a window in which a fifth node package can be
added inverted and nothing objects. The frozen shrinking baseline is the only ordering that is red on
new violations from U1 while letting the existing four be fixed one axis at a time — and because a
stale entry also fails, the remaining violations are a _recorded_ state, not a silent one.

## Affected Files

```
scripts/harness/scan-composition-neutrality.mjs                     (generalized)
scripts/harness/__tests__/scan-composition-neutrality.test.mjs      (new cases)
scripts/harness/node-family-composition-baseline.json               (new, removed in U4)
scripts/harness/run-all-scans.mjs                                   (examines list)
.agents/harness.config.json                                         (compositionNeutrality family entry)
ARCHITECTURE.md                                                     (DAG-NODE-COMPOSITION statement)
.agents/project-structure.md                                        (Family Decomposition Rule)
packages/agent-core/src/interfaces/media-provider-definition.ts     (new)
packages/agent-core/src/interfaces/index.ts, src/index.ts           (re-export)
packages/dag-core/src/types/node-lifecycle.ts                       (runtimeBaseUrl?: string)
packages/dag-nodes/docs/SPEC.md
packages/dag-nodes/docs/MEDIA-PROVIDER-CONTRACT.md
packages/dag-nodes/gemini-image-edit/{package.json,src/index.ts,src/runtime-core.ts,src/runtime-helpers.ts}
packages/dag-nodes/text-to-image/{package.json,src/index.ts,src/runtime-core.ts}
packages/dag-nodes/seedance-video/{package.json,src/index.ts,src/runtime-core.ts}
packages/dag-nodes/instant-node/{package.json,src/index.ts}
packages/dag-nodes-default/src/index.ts
packages/dag-cli/src/local-runner/node-registry.ts
packages/dag-cli/src/local-runner/persistence/store.ts
packages/dag-cli/src/mcp/handlers/instant-nodes.ts
packages/agent-command-workflows/package.json                       (only under S4 path P2)
packages/agent-command-workflows/src/authoring/pipeline.ts
packages/agent-command-workflows/src/persistence/instant-node-loader.ts
packages/agent-builtin-providers/**                                 (only under USER-DECISION D2-A)
```

## Completion Criteria

- [ ] TC-01: the generalized scan exits 1 with one finding per planted violation, for each of five
      shapes — a disallowed manifest dependency, a **subpath** vendor import
      (`@robota-sdk/agent-provider-gemini/google`), a direct vendor-SDK import (`@google/genai`),
      `process.env`, and `globalThis['process'].env` — and exits 0 on a clean fixture member.
- [ ] TC-02: a fixture member named `@robota-sdk/dag-node-fixture` placed **outside**
      `packages/dag-nodes/` is (a) enumerated as a family member and (b) reported as a
      `family-member-outside-home` finding; a fixture member inside it with a planted violation is
      reported with no configuration edit.
- [ ] TC-03: removing a real violation without removing its baseline entry exits 1 with a
      stale-baseline finding; adding a violation absent from the baseline exits 1.
- [ ] TC-04: `node scripts/harness/scan-rule-statement-floor.mjs` exits 0 with `DAG-NODE-COMPOSITION`
      stated in `ARCHITECTURE.md`.
- [ ] TC-05: `test "$(grep -l '@robota-sdk/agent-provider' packages/dag-nodes/*/package.json | wc -l | tr -d ' ')" = 0`
      succeeds. (Run today it fails, printing `4` — the criterion is red before the work and green
      after, which `grep -c` was not.)
- [ ] TC-06: the M2 command in § Problem outputs zero lines.
- [ ] TC-07: the M4 command in § Problem outputs exactly one line
      (`packages/dag-nodes/mcp-tool/src/index.ts:210`).
- [ ] TC-08: `node scripts/harness/check-dependency-direction.mjs` exits 0 and `pnpm harness:scan`
      exits 0.
- [ ] TC-09: `pnpm --filter '@robota-sdk/dag-node-*' test`, `pnpm --filter @robota-sdk/dag-cli test`,
      `pnpm --filter @robota-sdk/agent-command-workflows test` and
      `pnpm --filter @robota-sdk/agent-core test` all exit 0.
- [ ] TC-10: `test ! -e scripts/harness/node-family-composition-baseline.json` succeeds, and restoring
      the file with a non-empty `entries` array makes the scan exit 1.
- [ ] TC-11: `rg -n 'DAG-NODE-COMPOSITION' ARCHITECTURE.md .agents/project-structure.md` hits both
      files, and in `ARCHITECTURE.md` the identifier's entry matches
      `Enforced by: \`composition-neutrality\``. (This asserts the line's shape in this tree; no harness
      scan checks that shape — see § Out of scope.)
- [ ] TC-12: with no credential in the environment, an instant-node run fails with
      `DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED` naming the required variable and listing the
      providers whose keys are set; a `text-to-image` run fails with
      `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`; a `gemini-image-edit` run fails with
      `DAG_VALIDATION_GEMINI_API_KEY_REQUIRED`; a `seedance-video` run fails with
      `DAG_VALIDATION_SEEDANCE_VIDEO_CREDENTIALS_REQUIRED`; and in that same credential-free
      environment `createCliNodeRegistry()` still returns the `gemini-image-edit` and
      `gemini-image-compose` node types (the two it builds synchronously today) and
      `createDefaultNodeRegistry()` still returns `text-to-image` and `seedance-video`.
- [ ] TC-13: a `text-to-image` run with a model outside the resolved allowlist fails with
      `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, and a unit test asserts the provider built by
      the definition received a non-empty `imageCapableModels` equal to that allowlist — so
      `isImageCapableModel` cannot reach its unconditional-`true` branch.
- [ ] TC-14: a policy entry whose family resolves to zero members exits 1 with a member-floor finding,
      and the scan prints `::examined:: <n> family member(s)` with `n >= minMembers` on the real tree.

## Test Plan

Type `INFRA` + tags `cli`, `typescript` → CI pipeline smoke test (harness scan exit codes) for the gate
rows; unit test for the node contract rows; process-spawn assertion for the CLI rows.

| TC-ID | Test Type | Tool / Approach                                                                           | Notes                                                                            |
| ----- | --------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| TC-01 | unit      | `scripts/harness/__tests__/scan-composition-neutrality.test.mjs`, planted fixture members | RED-proof per shape; the `@google/genai` case is what proves the allow direction |
| TC-02 | unit      | same file, fixture root with a member outside `packages/dag-nodes/`                       | a directory-scoped subject cannot pass this                                      |
| TC-03 | unit      | same file, baseline mutated in both directions                                            | stale entry and unlisted violation are both findings                             |
| TC-04 | CI smoke  | `node scripts/harness/scan-rule-statement-floor.mjs`                                      | exit 0                                                                           |
| TC-05 | CI smoke  | `grep -l … \| wc -l` compared to 0                                                        | verified red today (prints `4`)                                                  |
| TC-06 | CI smoke  | the M2 command in § Problem                                                               | expects empty output                                                             |
| TC-07 | CI smoke  | the M4 command in § Problem                                                               | expects exactly the `mcp-tool` `$ENV:` line                                      |
| TC-08 | CI smoke  | `check-dependency-direction.mjs`; `pnpm harness:scan`                                     | exit 0                                                                           |
| TC-09 | unit      | `pnpm --filter … test` for four package groups                                            | exit 0                                                                           |
| TC-10 | unit      | `test ! -e …` plus the baseline-restore case in the scan test                             | the absence is asserted, not assumed                                             |
| TC-11 | CI smoke  | `rg -n` with an `Enforced by:` pattern, not a bare identifier match                       | the honest ceiling: no harness scan checks this shape (§ Out of scope)           |
| TC-12 | unit      | four per-node unit cases with no credential + one registry-construction case              | the credential-absence half A3 would have made unreachable                       |
| TC-13 | unit      | `text-to-image` allowlist case + a factory-argument assertion                             | asserts the second defence layer survives, not merely that the node still runs   |
| TC-14 | unit      | zero-member policy entry in the scan test + `::examined::` floor on the real tree         | closes the "could not check" → "checked and fine" hole                           |

`pnpm harness:scan` and the affected package test suites must be green at the end of every sequenced
unit, not only at the end of the last one.

## Out of scope — separate root items, labelled not absorbed

Two causes sit **below** this item and are recorded here so another writer can file them; this spec
absorbs neither, per [`finding-depth.md`](../../rules/finding-depth.md).

1. **An `Enforced by:` line outside `.agents/rules/` is checked by nobody.**
   `scan-new-rule-declares-enforcement.mjs` reads only the diff of `.agents/rules/`, and
   `scan-rule-statement-floor.mjs` checks that an identifier is _stated_, not how. So every
   `Enforced by:` line in `ARCHITECTURE.md` and `.agents/project-structure.md` — including the one this
   item adds — is unverified prose. Same family as the draft `HARNESS-094` ("a classification table is
   checked by nobody"). The fix is to widen the enforcement scan's reach to `architectureDocs`, which is
   a change to a harness gate's scope and not to this item's subject.
2. **`packages/dag-nodes-default/package.json` disagrees with its own dynamic imports.** It declares
   `@robota-sdk/dag-node-seedance-video` and `@robota-sdk/dag-node-text-to-image` in `dependencies`
   while `@robota-sdk/dag-node-gemini-image-edit` sits in `optionalDependencies`, yet all three are
   loaded identically through `optionalLoaders` (`src/index.ts:113-129`). Pre-existing, unrelated to the
   direction of provider composition.

## USER-DECISION

Four decisions are outside the standing authorization and must be answered before GATE-APPROVAL.

**D1 — the published surface of `@robota-sdk/dag-node-instant-node`.**

- **D1-A: change the surface fully.** `createPromptBackedNodeDefinition(spec, deps)` and
  `rehydrateInstantNode(record, deps)` require `providers`; `isInstantNodeProvider(value, registry)`
  validates against the injected registry; `INSTANT_NODE_PROVIDERS` is removed. _Consequence:_ a
  breaking change to a published package, 10 call sites in 2 workspace packages plus the hard-coded copy
  at `mcp/handlers/instant-nodes.ts:76-82`, a registry-acquisition path for `agent-command-workflows`
  (§ S4), **and the validity of a stored `provider` value becomes registry-dependent — the same
  `.node.json` loads under one host and is unknown under another, which changes what DATA-003 declared a
  round-trip SSOT.**
- **D1-B: keep the surface, add an optional `providers` with a fallback to today's table.**
  _Consequence:_ no break, and no fix — the vendor imports and env reads stay, the gate can never be
  armed for this package, and the baseline never empties.
- **D1-C: keep `INSTANT_NODE_PROVIDERS` as a deprecated re-export of the default registry's types.**
  _Consequence:_ the node package gains a dependency on `agent-builtin-providers`, reintroducing a
  composition edge in a thinner form.
- **D1-D (recommended): move only CONSTRUCTION to the registry; the persisted vocabulary stays owned by
  the package.** `createPromptBackedNodeDefinition(spec, deps)` requires `providers`, while
  `INSTANT_NODE_PROVIDERS` and `isInstantNodeProvider(value)` keep their current single-argument shape.
  _Consequence:_ every vendor import and env read still disappears, so the gate arms fully and the
  baseline empties; the DATA-003 round-trip vocabulary stays host-independent; the cost is that adding a
  supported vendor touches both the constant and the registry, so a check for that divergence is needed.

**D2 — who owns the media provider definitions.**

- **D2-A (recommended): extend `@robota-sdk/agent-builtin-providers`** with
  `createDefaultMediaProviderDefinitions()`, adding an `@robota-sdk/agent-provider-bytedance`
  dependency. _Consequence:_ a published surface gains an export and the package gains one SDK
  dependency; the media composition roots already depend on it or already lazy-load it, so no new static
  edge appears. Under A6 a missing credential does **not** remove the nodes from the registry.
- **D2-B: a new `@robota-sdk/agent-builtin-media-providers` package.** _Consequence:_ a new workspace
  package (outside pre-approved scope), a cleaner LLM/media split, one more package to publish and
  version.
- **D2-C: no shared default; only `dag-cli` and `apps/*` wire media definitions.** _Consequence:_
  `createDefaultNodeRegistry()` stops returning the three media nodes for any consumer that injects
  nothing, so a DAG using `text-to-image` fails validation with an unknown node type — a user-visible
  behaviour change, recorded in § Fallback & Degradation Declaration.

**D3 — the shape of the media injection.**

- **D3-A: inject a constructed instance (`IImageGenerationProvider`).** _Consequence:_ the composition
  root must read credentials at registry-construction time in a synchronous function; with no
  credential the three media nodes cannot be constructed at all; the three `*_API_KEY_REQUIRED` /
  `*_CREDENTIALS_REQUIRED` errors become unreachable; and `imageCapableModels` loses its owner, so
  `isImageCapableModel` returns `true` for every model.
- **D3-B (recommended): inject a media provider DEFINITION owned by `agent-core` (A6).**
  _Consequence:_ symmetry with `dag-node-llm-text`, lazy credential resolution preserved, all four
  existing errors and both layers of the model gate preserved, credential resolution stays under
  `provider-env-resolution`'s protection; the cost is one new published contract type in `agent-core`
  and one extra sequenced unit (U1.5).

**D4 — the direction of the gate.**

- **D4-A: deny-list on the `@robota-sdk/agent-provider-` prefix.** _Consequence:_ a node importing
  `@google/genai` directly passes, and that SDK is already a `peerDependency` of `dag-nodes-default`;
  the guard is in the recognised-list direction that `enforcement-architecture.md` § 6 refuses.
- **D4-B (recommended): an allow-set of permitted dependencies plus a frozen exception list.**
  _Consequence:_ direct vendor-SDK reach is blocked too, and the guard fails toward a refusal someone
  sees; the cost is maintaining the exception set, which today holds exactly one entry
  (`@modelcontextprotocol/sdk`), and the risk that a legitimate new dependency is refused until the set
  is updated — which § 6 names as the price worth paying.

### Resolution — owner's recorded decision

Recorded verbatim from `/tmp/robota-issues/round2/DECISIONS.md`, entry of 2026-09-05:

> 2026-09-05 ARCH-054 (#2158) 결정: D2-A 확정(agent-builtin-providers 확장). D1 은 llm-text 형태로
> 재작업 — 리터럴 유니온 INSTANT_NODE_PROVIDERS/TInstantNodeProvider 제거(레지스트리 유도 가드),
> 영속 provider = 문자열 + 주입 레지스트리 findProviderDefinition 검증, 실패는
> DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN 하나.

**How each axis resolves.**

- **D1 — resolved as D1-A, reworked in the `llm-text` shape.** Not the D1-D this document recommended.
  `INSTANT_NODE_PROVIDERS` and `TInstantNodeProvider` are removed; the persisted `provider` is a plain
  string validated through the injected registry's `findProviderDefinition`; the guard is derived from
  the registry rather than from a literal union. An unrecognised persisted provider fails with exactly
  one error, `DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN`.
- **D2 — resolved as D2-A**, the option this document recommended. `@robota-sdk/agent-builtin-providers`
  gains `createDefaultMediaProviderDefinitions()` and an `@robota-sdk/agent-provider-bytedance`
  dependency.
- **D3 — resolved as D3-B**, the option § Decision already selects (A6 on the media axis).
- **D4 — resolved as D4-B**, the option this document recommended.

**What D1-A changes relative to the D1-D text above.** The cost D1-D was chosen to avoid — a persisted
vocabulary that can diverge from the registry — is instead removed at the source: there is no second
vocabulary to diverge. The consequence D1-D listed for the round-trip contract is answered by
validating the persisted string against the injected registry at rehydrate time rather than by keeping
a host-independent constant. The credential-absence failures the media nodes raise are unaffected:
`DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN` is the failure for a provider the registry does not
know, which is a different case from a provider that is known but has no credential.

## User Execution Test Scenarios

### Scenario 1: instant-node workflow remains usable after provider composition moves to the host

- Executability: manual-only: the scenario requires a live provider credential and paid model service that unattended execution cannot safely provide
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: a built checkout, an interactive terminal, a disposable workflow project, and a valid `ANTHROPIC_API_KEY` configured for the selected provider
- Command: robota
- UI steps: start `robota`, select the configured provider and model, submit a prompt-backed workflow containing one instant node, and observe the completed turn and node output
- Automation barrier: credential-bound-service
- Unavailable capability: a live Anthropic-compatible provider credential and paid remote model execution are unavailable to unattended verification
- Attempted automation: a deterministic provider-free CLI route cannot exercise the real remote instant-node execution path or prove the provider-host composition boundary
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=the workflow turn completes, the instant node output is rendered, and the run is reported as succeeded
- Cleanup: delete the disposable workflow project and clear the temporary provider credential from the shell
- Evidence: pending — record the completed turn, rendered node output, and run-success indicator after a credentialed manual execution

### Scenario 2: media workflow preserves model allowlisting and credential diagnostics

- Executability: manual-only: the scenario requires a live image provider credential and paid model service that unattended execution cannot safely provide
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: a built checkout, an interactive terminal, a disposable workflow project, `GEMINI_API_KEY`, a valid image model, and the configured allowed-model list
- Command: robota
- UI steps: start `robota`, submit a text-to-image workflow with an allowed model, repeat with a disallowed model, then repeat the disallowed case after removing `GEMINI_API_KEY`
- Automation barrier: credential-bound-service
- Unavailable capability: a live Gemini-compatible image credential and paid image generation service are unavailable to unattended verification
- Attempted automation: provider-free tests can cover the model and credential guards but cannot prove the real user-facing image-generation result through the live service
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=the allowed run produces an image result, the disallowed model reports `DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED`, and the missing credential reports `DAG_VALIDATION_TEXT_TO_IMAGE_API_KEY_REQUIRED`
- Cleanup: delete the generated image and disposable workflow project, then clear the temporary provider credential from the shell
- Evidence: pending — record the three rendered outcomes, diagnostic messages, and generated asset after a credentialed manual execution

### Scenario 3: media node catalog remains available without a provider credential

- Executability: manual-only: the repository's DAG catalog command is exposed as a separate interactive local binary and cannot be driven by the canonical unattended TUI command in this environment
- Product surface: robota-tui
- Surface rationale: shipped-entrypoint=robota
- Prerequisites: a built checkout, an interactive terminal, a disposable workflow project, and `GEMINI_API_KEY` absent from the shell
- Command: robota
- UI steps: start `robota`, open the local node catalog, and inspect the available node types without submitting a paid model request
- Automation barrier: sandbox-restriction
- Unavailable capability: the local DAG catalog binary is not available through the canonical unattended TUI invocation used by this scenario contract
- Attempted automation: the intended `robota-dag node list` route was identified, but this environment's scenario contract accepts only the shipped `robota` entrypoint for CLI and TUI commands
- Observable type: ui-state
- Observable rationale: source=rendered-product-ui
- Expected observable: visible=`gemini-image-edit` and `gemini-image-compose` are listed while no provider credential is required
- Cleanup: exit the catalog and delete the disposable workflow project
- Evidence: pending — record the catalog output and the absence of `GEMINI_API_KEY` after a manual execution

## Tasks

- [ ] `.agents/tasks/ARCH-054-invert-dag-node-provider-composition-and-gate-the-family.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → review-ready

**Ordering:** GATE-WRITE is the entry gate (gate-catalogue § Prior-gate map: "GATE-WRITE has no prior status gate"), so no prior-gate PASS is required. Expected input state confirmed: frontmatter `status: draft` and the file sits in `.agents/spec-docs/draft/`. `git status --short` shows only two untracked planning artifacts (this spec and its Task) and `git diff --stat origin/develop...HEAD` is empty — no work this gate authorizes has been performed ahead of it.

**Machine set (reproduced):** `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <this file> --dry-run` → "27 criteria judged — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN", no entry written. Frontmatter (4/4): `status: draft`, `type: INFRA`, `tags: ['cli','typescript']`. Problem: no TBD/TODO, 8952 chars. Prior Art Research: section present and substantiated per `scan-spec-research`. Checklist: 4/4 `[x]`, sibling scan `[x]` with evidence. Banned-phrase check: clean. Test Plan: present, no TBD, 0 manual rows. Structure: `## Tasks` placeholder present, no `## Status`/`## Classification` body sections.

**Re-derived by hand (not taken on trust):**

- _Alternatives Considered ≥2 with pro/con_ — 6 numbered entries A1–A6, each carrying `**Pro:**` and `**Con:**`; A3's Con is an unclosed emphasis marker (`**Con** — …:_`), cosmetic only.
- _One Test Plan row per TC-N_ — Completion Criteria yields exactly `TC-01 … TC-14` (14) and the Test Plan table yields exactly `TC-01 … TC-14` (14): same count, same IDs, same order.
- _Evidence Log present and empty_ — before this entry the file was 853 lines and `## Evidence Log` was line 853 with nothing after it; this is the first entry.
- _All 4 Architecture Review Checklist items `[x]`_ — read directly at § Architecture Review Checklist; each carries completion evidence, not a bare tick.

**Semantic criteria:**

- **Concrete symptom — MET.** § Problem states five measurements with the command that produced each; every one was re-run in this worktree and reproduced exactly. M1 (7 edges over 4 packages) → the `node -e` manifest walk printed `EDGES=7` over `dag-node-instant-node` (×4), `-gemini-image-edit`, `-text-to-image`, `-seedance-video`. M2 (8 imports, 4 files, 3 subpath) → the `find | xargs grep` printed exactly 8 lines at `instant-node/src/index.ts:14,15,16,17,18`, `gemini-image-edit/src/runtime-core.ts:8`, `text-to-image/src/runtime-core.ts:8`, `seedance-video/src/runtime-core.ts:8`, of which 3 end in `/google`. M3 (8 construction sites) → `grep -n "new .*Provider("` returned exactly `instant-node:113,120,127,134,141` + `gemini-image-edit:95` + `text-to-image:97` + `seedance-video:120`. M4 (15 lines, 6 files) → the command printed 15 lines at the cited line numbers, including `mcp-tool/src/index.ts:210`. M5 → `packages/dag-cli/src/mcp/handlers/instant-nodes.ts:76-82` holds the literal five-vendor array and `grep -c isInstantNodeProvider` on that file returns `0`. The wrong behaviour is named and verified: `node scripts/harness/check-dependency-direction.mjs` exits `0` on that same tree.
- **Reproduction condition — MET.** The section names the tree it measured (`develop` at `3d72df4e7`), the enumeration scope (`packages/dag-nodes/`, `node_modules`/`dist` pruned, no symlink following), and the exact file:line of every claim. `git cat-file -t 3d72df4e7` → `commit`, and at that commit the § "Why the existing gates are green" citations are exact: `:291` `DAG_NODES_LEAF_ALLOWLIST`, `:298` "Scope: intra-DAG leaf-ness only", `:305` `nodePrefix`, `:307` `allowedDagTargets`, `:315` `// only intra-DAG edges are policed here`, `:345` `GUARDED_AGGREGATORS`. `scan-provider-env-resolution.mjs` `NORMALIZATION_MODULES` is the 3-entry frozen list the spec describes. Currency note for the next gate, not a defect of this criterion: since `3d72df4e7`, commit `e965f4fd4` moved `checkDagNodesLeaf` into `scripts/harness/family-siblings.mjs` (the quoted comment is now `family-siblings.mjs:58`) and added the name-derived rules 11/12 there; the symptom still reproduces at HEAD (`check-dependency-direction.mjs` exits 0, prints `::examined:: 31 family members (FAMILY-SIBLINGS)`), but § S1's "generalize the existing scan" seat argument was written before that module existed.
- **Research feeds Alternatives / Decision — MET.** The findings are load-bearing, not decorative: § Decision closes its media argument with "The prior art points the same way: `conn_id` (S6), `Definitions` resources (S8) and blocks (S10) are all late-bound references, not eagerly constructed clients" — the late-binding finding is what selects A6 over A3. § S1 derives `forbiddenIdentifiers` `["process.env","globalThis.process"]` from S4's restricted-globals list, and D4-B's allow-direction from S2 plus `enforcement-architecture.md` § 6. The counter-example (S11, the AI SDK's `ANTHROPIC_API_KEY` default) is used to place env-defaulting one layer down rather than suppressed. Every S-number cited in Decision/Solution (S2, S4, S6, S8, S10, S11) resolves to a row in the § Sources table.
- **Decision names its trade-off — MET.** § Decision: "An instance-shaped injection is not the same inversion with a smaller diff — it is a different design that trades away lazy credential resolution, three existing typed errors, and one layer of the model gate (A3 (i)–(iv))", and A6's own Con accepts the cost ("one new contract type in `agent-core` … and one extra sequenced unit"). The two decisive facts were checked in code: `isImageCapableModel` (`packages/agent-provider-gemini/src/gemini/image-operations.ts:135-142`, consumed at `:174`) does `if (!configuredImageModels || configuredImageModels.length === 0) return true;`, and `IProviderDefinition.createProvider` at `packages/agent-core/src/interfaces/provider-definition.ts:162` is required and returns `IAIProvider` — so A3(iv) and A4's Con are measured, not asserted.
- **New-surface placement — MET (criterion is ACTIVE).** The spec introduces one genuinely new interface surface, `IMediaProviderDefinition` at `packages/agent-core/src/interfaces/media-provider-definition.ts` (new), re-exported from `interfaces/index.ts` and `src/index.ts`; plus one optional field on `INodeExecutionContext` (`dag-core`), one export on `agent-builtin-providers` (D2-A), and one new harness data file. No new workspace package under the recommended path (D2-B, which would create one, is stated and rejected). (a) Analogous layer + family classification: the new type sits beside `IProviderDefinition` in the same `agent-core/src/interfaces/` layer and the node-side mirror is `dag-node-llm-text`, whose header the spec quotes — verified verbatim at `packages/dag-nodes/llm-text/src/index.ts:38-46` ("constructed with an injected {@link IProviderDefinition} registry … reads **no** `process.env` itself"); the family classification is cited at `.agents/project-structure.md:364`, which I read and which is exactly the `DAG nodes (dag-node-*) | per-member split | … registry-registered extension-point member` row. (b) Reuse at the contract/core level: the delivery replaces node→sibling-PRODUCT edges (`@robota-sdk/agent-provider-*`) with a contract dependency on `agent-core`, and § S1's allow-set is `{dag-core, dag-node, agent-core, agent-tools, agent-interface-command, zod}` + one frozen exception. The one place a sibling-product edge would appear is faced explicitly in § S4: `agent-command-workflows` genuinely has no registry path today (verified — its manifest declares no `@robota-sdk/agent-builtin-providers`, while `dag-cli` and `dag-nodes-default` both declare it), and P1 (injection through `IWorkflowsAuthoringDeps`, no new manifest edge) is recommended over P2 against the Command Package Rule (`.agents/project-structure.md:292`). D2-A's extension is the established shape for its target: `agent-builtin-providers` already declares four `@robota-sdk/agent-provider-*` dependencies and is classified at `.agents/project-structure.md:21` as an aggregator named apart from the family it bundles. Out of this criterion's reach but flagged for GATE-APPROVAL: `spec-workflow.md` § New-Surface Architecture Placement items 3 and 4 (independent architecture-review validation recorded in the Evidence Log, and owner-first surfacing) are required "before GATE-APPROVAL" and no such review verdict exists in this log yet.
- **≥1 criterion per distinct feature or sub-item — MET.** Every sequenced unit and every S-section has at least one TC: U0/S1 gate generalization → TC-01 (five planted shapes + clean fixture), TC-02 (name-vs-directory subject), TC-03 (baseline in both directions), TC-14 (member floor); U1 rule statements → TC-04, TC-11; U1.5/S2 media contract → TC-13; U2 media nodes + composition roots → TC-06, TC-12, TC-13; U3 instant-node + the M5 copy → TC-05, TC-06, TC-07, TC-12; U4 baseline deletion + `mcp-tool` exemption → TC-10, TC-07; S4 `agent-command-workflows` → TC-09; S5 `runtimeBaseUrl` relocation → TC-07 (the M4 command must fall to one line, which covers `runtime-helpers.ts:53,57`). Weakest coverage, recorded rather than skipped: S5's positive behaviour (the runtime populating `runtimeBaseUrl`, asset URLs still resolving) and the D2-A `agent-builtin-providers` package suite rest on TC-09/TC-12 rather than a dedicated criterion — above the "at least 1" floor this criterion sets, but the thinnest row in the table.
- **Command form or Observable behaviour form — MET.** All 14 checked individually. Command form: TC-04, TC-05 (literal `test "$(grep -l … | wc -l | tr -d ' ')" = 0`, with its red-today value `4` stated), TC-06/TC-07 (the M2/M4 commands by reference — both re-run here and reproducible), TC-08, TC-09, TC-10, TC-11. Observable-behaviour form with named exit codes, finding kinds, error identifiers or returned values: TC-01, TC-02 (`family-member-outside-home`), TC-03 (stale-baseline finding), TC-12 (four named `DAG_VALIDATION_*` codes plus the node types `createCliNodeRegistry()`/`createDefaultNodeRegistry()` must still return in a credential-free environment), TC-13 (`DAG_VALIDATION_TEXT_TO_IMAGE_MODEL_NOT_ALLOWED` plus a non-empty `imageCapableModels` assertion), TC-14 (`::examined:: <n> family member(s)`, `n >= minMembers`). No criterion leans on a vague predicate.

**Recovery-context checks (requested, verified):**

- There is no § "Prospective Recovery" in this document; the section carrying the authorization statement is § "Approval Authority" (line 13). It states the item is **not** covered by any standing authorization and defers four choices to the user — it makes no claim that any past sequence was compliant (searched for `was/were compliant`, `properly gated`, `followed the gate`, `already approved`, `retroactive` — zero hits).
- Nothing in the document proposes disabling a hook, scan or verification. The only hits for `disabl|bypass|--no-verify|suppress|_ACK=|exempt` are three lines that _strengthen_ enforcement: U4 moving `mcp-tool:210` into a named permanent `exemptions` list inside the new gate with its reason recorded, and § S5's "Check (c) stays **total**: a per-line exemption inside a total guard is how a guard erodes."
- Formatting-only claim for § Alternatives Considered — **confirmed**. `diff -u` against the preserved copy at `/tmp/robota-issues/round2/impl2/ARCH-054/plan-preserved-untracked/…` shows changes confined to that one section; a word-level comparison that normalizes list numbering and emphasis markers (`_Pro:_`/`_Con:_` ↔ `**Pro:**`/`**Con:**`) produces an **empty diff**, and the word count moves 7278 → 7284, exactly the six added list numbers. No argument, pro or con was altered, added or removed. Residue: A3's Con retains an orphan trailing `_` from the conversion — cosmetic, no words changed.
- Consistency with the owner's recorded decision (`/tmp/robota-issues/round2/DECISIONS.md`: `2026-09-05 ARCH-054 (#2158) 결정: D2-A 확정(agent-builtin-providers 확장)`): § Decision selects A6 for the media axis (= D3-B) and § Affected Scope / § Affected Files scope `packages/agent-builtin-providers/**` "(only under USER-DECISION D2-A)" — consistent with D2-A and with no other D2 option. **Flagged for GATE-APPROVAL, not judged here:** the same recorded decision reworks D1 in `llm-text` form (remove `INSTANT_NODE_PROVIDERS`/`TInstantNodeProvider`, validate the persisted string through the injected registry, single failure `DAG_VALIDATION_INSTANT_NODE_PROVIDER_UNKNOWN`), while § USER-DECISION still recommends D1-D (keep both) and TC-12 asserts `DAG_VALIDATION_INSTANT_NODE_API_KEY_REQUIRED`. GATE-WRITE does not judge approval and the document does not claim D1 is settled, so this does not bear on this verdict.

**Verdict:** PASS — all 27 criteria met (20 mechanical reproduced, 4 of them re-derived by hand; 7 semantic judged above, none N/A).

- GATE-WRITE — Semantic review confirms the concrete symptom, reproduction condition, research-to-decision trace, trade-off, new-surface placement, feature coverage, and canonical observable forms.

**Judged at:** HEAD `d9b521a06c71` · base `origin/develop@d9b521a06c71` · document `.agents/spec-docs/draft/ARCH-054-invert-dag-node-provider-composition-and-gate-the-family.md` blob `3a2a430f073f` (untracked)
