---
status: in-progress
type: INFRA
tags: [typescript, cli]
lane: L2
---

# STRUCT-012: refactor the transport family onto its name hierarchy

Paired with `.agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`.
No GitHub issue yet — the owner directed a local foundational item (see § Approval Authority). This
item **absorbs** the earlier `STRUCT-012` draft written for
[issue #2197](https://github.com/woojubb/robota/issues/2197) (the two presentation packages carrying
the transport prefix): same family, same defect, and the owner has directed the whole-family
refactor rather than the two-package fix. Its measurements and prior art are reused below unchanged.

## Approval Authority

This item is **not** covered by any standing authorization. It renames or removes **published**
packages (`@robota-sdk/agent-transport-protocol` at `3.0.0-beta.79` is removed; `agent-transport-tui`
is renamed to `@robota-sdk/agent-ui-terminal`), changes the public export surface of `@robota-sdk/agent-transport` and
`@robota-sdk/agent-framework`, and adds a repository-wide dependency gate — every one of which
[`backlog-execution.md` § Validated recommendations and bounded gate-FAIL corrections](../../rules/backlog-execution.md)
places outside every delegation as a direct-user decision.

The owner has directed the refactor and, in this conversation (2026-09-05), settled every decision
inside it — the module placement after being shown the measurement, the new `agent-ui-*` family
names, the shape inside `agent-framework`, the registry, and the release step; each ruling is quoted
verbatim in § Disposition and § USER-DECISION is therefore empty. What remains is the pipeline's own
GATE-APPROVAL on this document as written, which is the owner's sign-off on the **plan**, not a
re-decision of the rulings.

## Disposition

Owner rulings, in the order given (2026-09-05). These are the premises of every section below.

1. The rule. > "우리는 같은 레벨의 이름을 가진 패키지가 동레벨의 패키지를 import 하지 못하게
   되어있습니다. 규칙이 그렇습니다. agent-transport의 하위 인 agent-transport-protocol은 다른
   agent-transport-\*들이 평행 참조 불가합니다"
2. Why the names are hierarchical. > "패키지 이름을 계층적으로 구성한 이유는 이렇게 쉽게 위반사항을
   검출하기 위한 것입니다" — **the name hierarchy is the rule and the detector.** The sibling ban is
   derived from the package name, not declared in a table.
3. The naming class that is refused. > "\*-defaults 명명 방식은 잘못되었음. transport같은데는
   defaults가 있을수 없음. 그런 접두어는 어떤 프리셋 같은" / > "agent-provider-defaults 도 있을수
   없음. 완벽한 모순입니다. 절대 transport를 이런식으로 처리하지말고 리팩토링을 통해 바로잡겠습니다"
4. The direction of the fix. > "현재 더이상 이방향으로 처리하지 말고 파운데이셔널 이슈로 로컬에 새로
   생성하고 리팩터링 진행하세요" — the browser-entry direction of `INFRA-158` is abandoned; this item
   is the foundational replacement.
5. Where the shared substrate lives. > "agent-transport-xxx가 참고하려면 agent-transport를 참고해야
   합니다" — the shared lower layer is **absorbed into the family parent** `packages/agent-transport`.
   The question "what new prefix does the lower layer get" no longer exists. The owner's stated
   split: (a) the four WS-only modules → `agent-transport-ws`, (b) the rest of the transport-neutral
   session bridge → `agent-transport`, and `agent-transport-protocol` is removed.
6. How pure the parent must be. > "agent-transport 는 framework같은거 품지말고 순수할수록 좋다." —
   `agent-transport` drops its `agent-core` and `agent-framework` dependencies and becomes
   contract-pure: `agent-interface-*` plus pure TypeScript. A module whose place in the parent is
   ambiguous is **not** kept in the parent.
7. Scope of the purity requirement, corrected later the same day. > "agent-transport-\* 는 내부적으로
   framework를 참조할 수 있지. agent-transport는 순수하면 좋다. 그리고 어차피 트리쉐이킹 한다." —
   purity applies to the **parent only**. A child `agent-transport-*` importing `agent-framework` is
   not a violation and the sibling gate must not refuse it; that `-ws`/`-http`/`-mcp` are
   contract-pure today may be kept but is **not** hardened into a requirement. The browser-bundle
   concern about a framework value graph is restated on the owner's tree-shaking premise; the concern
   about `node:` builtins stands, because a builtin reached from the root barrel is resolved by the
   bundler before any tree-shaking and is not removed by it (`VITE-TS`).
8. The four `ws-`-named modules, decided after the measurement in § Problem was shown (2026-09-05):
   the owner chose **"부모에 두고 의존 기준으로 개명 (Recommended)"** over the literal split of
   ruling 5(a). All four stay in `agent-transport`'s root and are renamed by what they are —
   `wire-messages`, `session-message-handler` (`createSessionMessageHandler`), `session-events`,
   `background-messages`. § Decision fixes S3 in that form; there is no D1 left to decide.
9. The presentation packages (issue #2197), decided 2026-09-05: **"agent-ui-web / agent-ui-terminal,
   둘 다 지금"**. A new family `agent-ui-*` is created: `agent-transport-gui` →
   `@robota-sdk/agent-ui-web`, `agent-transport-tui` → `@robota-sdk/agent-ui-terminal`, both in S5,
   the published `-tui` with its registry deprecation step. Not optional.
10. The shape inside `agent-framework` and the registry, decided 2026-09-05 as recommended: the
    runtime-host modules land under `agent-framework/src/transport-host/` exported from the root
    barrel, and `TransportRegistry` does **not** stay in the parent (ruling 6, "순수할수록").
11. The release step for the two retired names, decided 2026-09-05: **"후속 배포 시점에 deprecate +
    포인터"**. In the same release run that ships the successors (`@robota-sdk/agent-transport` with
    the substrate absorbed, `@robota-sdk/agent-ui-terminal`), every version of each old name is
    deprecated with a pointer to its successor; no unpublish; no shim package. It is a manual owner
    step, listed as a release-checklist item in § Decision S5. With this, no owner decision remains
    open (§ USER-DECISION is empty).

Precedent borrowed, and only this much of it: the `STRUCT-011` ruling (issue #2198, 2026-08-23) —
"동레벨 패키지 여럿을 하나로 묶어 내놓는 패키지는 완전히 다른 접두사를 달고 이름에 목적을 담아야
한다" — supplies the "different prefix + purpose in the name" principle for anything that leaves a
family. Its chosen name class (`-builtin`/`-defaults`) is what ruling 3 refuses, so nothing else is
borrowed from it.

## Problem

### The rule, and six edges that break it

Ruling 1 says an `agent-transport-*` package may not import another `agent-transport-*` package.
Measured on `develop` at `4b03d3248` (2026-09-05) over every workspace manifest's `dependencies` +
`peerDependencies`, enumerated with `readdirSync` over `packages/` and `apps/` (no symlink following —
a following enumeration in a pnpm workspace reaches the dependency store):

```
$ node scratch/sibling-edges.mjs        (the enumeration is reproduced in § Completion Criteria TC-02)
workspace packages scanned: 88
SIBLING edges (same agent-<family>- prefix, any depth): 11
  [agent-interface-*] 4   (all four authorized by the ARCH-101 layer map — see § Gate)
  [agent-provider-*]  1   agent-provider-openai -> agent-provider-openai-compatible
  [agent-transport-*] 6
    agent-transport-gui        -> agent-transport-protocol
    agent-transport-http       -> agent-transport-protocol
    agent-transport-webrtc     -> agent-transport-protocol
    agent-transport-webrtc-web -> agent-transport-gui
    agent-transport-webrtc-web -> agent-transport-protocol
    agent-transport-ws         -> agent-transport-protocol
PARENT/CHILD edges (bare agent-<family> <-> agent-<family>-*): 0
```

**Six of the family's nine members reach sideways.** Five reach `agent-transport-protocol`; one
(`-webrtc-web`) reaches `-gui`. `agent-transport-mcp` reaches nothing sideways. The parent
`agent-transport` reaches `-protocol` only as a `devDependency` from one test file
(`packages/agent-transport/src/__tests__/ws-multi-surface-exit-policy.test.ts:16`) — a correction to
the round-2 facts sheet, which counted it as a runtime consumer.

`agent-transport-protocol` is a sibling by name and a lower layer by fact: its own manifest depends on
six `agent-interface-*` packages and on **no** transport package, and `.agents/project-structure.md:28`
describes it as "shared by -ws and -webrtc". A package every sibling must reach is not a sibling; it
is the family's substrate, and ruling 5 says the substrate's name is `agent-transport`.

### A declaration defect that shows up as a naming defect

The absorbed `STRUCT-012` draft (issue #2197) measured the same family from the other end: **6 of 9**
members declare `transport-admission: none` in their own SPEC front matter, two of them
(`agent-transport-gui`, `agent-transport-tui`) as "a presentation layer" / "the peer is this process's
own terminal". That draft's conclusion stands and is carried here: the prefix has never meant "admits
a peer", so the family's layers were never written down, and the false positives every audit
re-derives are produced by humans reading a prefix that nothing checks.

Ruling 2 resolves what that draft left to the owner. The draft's recommended fix was a declared
`| Layer | Package |` table (the `ARCH-101` shape). Under ruling 2 that is the wrong fix for this
family: **the name is already the declaration.** A second, hand-written table would be a second
parser of one fact — the duplication class `scripts/harness/interface-layers.mjs`'s own header names:
"one fact would have two parsers that can disagree about it". The remedy is therefore not to declare
layers beside the names but to make the names true and to derive the check from them.

### The gate gap

`scripts/harness/check-dependency-direction.mjs` polices a sibling ban for exactly one family.
`checkDagNodesLeaf` (`:303-330`) refuses a `dag-node-*` that depends on "a **sibling** `dag-node-*`".
`checkInterfacePackageDeps` (`:248-289`) judges `agent-interface-*` peers through the declared
`ARCH-101` layer map. **No rule exists for `agent-transport-*`, `agent-provider-*`, `agent-remote-*`,
`agent-session-*`, `agent-tool-*`, `agent-cli-*`, `agent-command-*`,** or any other `agent-<family>-*`
prefix — so the six edges above were never red, and `.agents/project-structure.md:28-29` absorbed the
drift by describing the sideways reach as sharing.

### The parent is not yet a parent

Ruling 5 makes `agent-transport` the package every child must be allowed to import. Measured, it is
the least importable member of the family:

| `packages/agent-transport/src/` module                                                        | `@robota-sdk/*` imports                                                                                                              | `node:` builtins     | Framework/core coupling                                         |
| --------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ | -------------------- | --------------------------------------------------------------- |
| `headless/HeadlessInteractionChannel.ts`                                                      | agent-framework (**value**: `buildRuntimeSession`), agent-core (types), agent-interface-session                                      | `node:child_process` | runtime host — builds a runtime session                         |
| `headless/print-terminal.ts`                                                                  | agent-core (types `ITerminalOutput`, `ISpinner`)                                                                                     | `node:readline`      | terminal I/O                                                    |
| `headless/headless-stream-json.ts`                                                            | agent-interface-{command,execution,session}                                                                                          | `node:crypto`        | none (uses `randomUUID`)                                        |
| `headless/headless-runner.ts`, `headless-session.ts`, `headless-transport.ts`, `cli-input.ts` | agent-interface-{session,transport}                                                                                                  | —                    | none directly; composed by the two above                        |
| `programmatic/createProgrammaticAgent.ts`                                                     | agent-framework (**value**: `createInteractiveRuntime`), agent-core (types)                                                          | —                    | runtime host — builds an interactive runtime                    |
| `programmatic/ProgrammaticInteractionChannel.ts`                                              | agent-core (types `IActionRequest`, `TActionResponse`)                                                                               | —                    | core types only                                                 |
| `transport-settings-repository.ts`                                                            | agent-framework (**value**: `readSettings`, `writeSettings`; type `TSettingsData`)                                                   | —                    | settings file I/O through the framework                         |
| `transport-registry.ts`                                                                       | agent-core (types `IDestroyResult`, `TUniversalValue`), agent-interface-{session,transport}; imports `transport-settings-repository` | —                    | composes the file settings repository (framework, transitively) |
| `transport-settings-view.ts`                                                                  | agent-core (type `TUniversalValue`), agent-interface-{session,transport}                                                             | —                    | core type only                                                  |
| `transport-run-generation.ts`, `transport-registry-errors.ts`                                 | agent-interface-{session,transport}                                                                                                  | —                    | none                                                            |

`src/index.ts` re-exports `headless/*` and `programmatic/*` at the **root** entry, so any consumer of
`@robota-sdk/agent-transport` resolves `node:child_process`, `node:readline` and a framework runtime
builder. The children that must import the parent under ruling 5 are, today, contract-pure
(`-ws`/`-http`/`-mcp`: `agent-interface-*` + `-protocol` only — an observation, not a requirement,
per ruling 7) and two of them are **browser bundles** (`agent-transport-gui`, built by Vite;
`agent-transport-webrtc-web`, `tsdown` `platform: 'browser'`). `agent-framework` itself depends on
`agent-executor`, `agent-session`, `agent-tools`, `agent-tool-defaults`, `yaml`, `zod`. Under ruling
7 a child may reference the framework and a browser bundle tree-shakes the framework values it does
not use; what tree-shaking does **not** remove is a `node:` builtin resolved from the root barrel the
bundle imports (`VITE-TS`: "Vite does not automatically polyfill Node.js modules"). Absorbing the
substrate into the parent **as it is** would therefore leave the parent impure (ruling 6) and hand
the two browser bundles three `node:` resolutions they cannot shake — which is why § Solution purifies
the parent before anything moves in.

### The four `ws-` modules are misnamed, not WS-bound — measured

Ruling 5(a) sends "the four WS-only modules" to `agent-transport-ws`. The modules exist
(`ws-protocol.ts`, `ws-session-events.ts`, `ws-background-messages.ts`, `ws-handler.ts`; 795 lines),
but their dependents do not match the name:

```
$ grep -n "from './ws-" packages/agent-transport-protocol/src/*.ts   (excluding the ws-* files themselves)
message-decoders.ts:17      import type { …, TClientMessage, TServerMessage } from './ws-protocol.js';
outbound-delivery.ts:33     import type { TServerMessage } from './ws-protocol.js';
resume-buffer.ts:12         import type { TServerMessage } from './ws-protocol.js';
session-resume-bridge.ts:24 import { handleClientMessage, parseClientMessage } from './ws-handler.js';
session-resume-bridge.ts:25 import { subscribeSessionEvents } from './ws-session-events.js';
session-resume-bridge.ts:29 import type { TSeqServerMessage, TServerMessage } from './ws-protocol.js';
```

and outside the package, `createWsHandler` is a **production** import of `agent-transport-webrtc`
(`src/webrtc-transport.ts:1`, `src/session-attachment.ts:13`, `src/pairing-gate-options.ts:20`) as
well as of `-ws`. `ws-handler.ts` itself says at `:4-5` "Framework-agnostic: works with any WebSocket
implementation via send/onMessage callbacks. No dependency on ws, uWebSockets, etc." and its
`IWsHandlerOptions` (`:28-46`) carries `session`, `deliver: TOutboundDeliver` and `driverId` — no
WebSocket type anywhere. `ws-protocol.ts` is the `TClientMessage`/`TServerMessage` vocabulary that
`-gui` and `-webrtc-web` decode. **Every one of the four is transport-neutral by dependency; `ws-` is
a residue from when WebSocket was the only carrier.** Moving them to `-ws` by filename would create
two edges the owner's own gate refuses — `agent-transport → agent-transport-ws` (parent reaching up
into a child) and `agent-transport-webrtc → agent-transport-ws` (sibling). Shown this measurement,
the owner chose the dependency-driven placement (ruling 8); § Decision fixes S3 in that form.

### Cost, measured

All counts are `git grep -l` at `4b03d3248`; "historical" is `STRUCT-011`'s class
(`tasks/completed/`, `spec-docs/done/`, `spec-docs/rejected/`, `.agents/archive/`, `.changeset/`,
`.design/`), which is left untouched.

| Name / symbol set                                                      | Total | Historical | **Live** | `.ts`/`.tsx` | `package.json` | `scripts/` | `.github/` |
| ---------------------------------------------------------------------- | ----- | ---------- | -------- | ------------ | -------------- | ---------- | ---------- |
| `agent-transport-protocol`                                             | 166   | 62         | **104**  | 57           | 8              | 7          | 0          |
| `createWsHandler` / `IWsHandlerOptions` / the four `ws-*` module names | —     | —          | **44**   | —            | —              | —          | —          |
| `agent-transport-gui` (`private: true`)                                | 102   | 38         | **64**   | 12           | 5              | 8          | 0          |
| `agent-transport-tui` (published)                                      | 268   | 158        | **110**  | 12           | 3              | 24         | 1          |

Live `agent-transport-protocol` references by owner: `-ws` 15, `-webrtc` 14, `agent-cli` 11, `-gui` 9,
`scripts/harness` 7, `-webrtc-web` 6, `-http` 5, the package itself 4, `agent-transport` 4 (test +
manifest), `agent-interface-transport` 4, `.agents/specs` 4, `.agents/spec-docs` 4, and one each in
`README.md`, `pnpm-lock.yaml`, `content/guide/architecture.md`, `diagrams/robota-architecture.mmd`,
`.agents/publish-registry.md`, `.agents/project-structure.md`, `.agents/harness.config.json`,
`apps/agent-app`, `packages/agent-cli-web`, `CHANGELOG.md`.

Symbols the siblings actually take from `-protocol` (production `src`, `4b03d3248`):

| Consumer                     | Symbols                                                                                                                                                                                                                                                                    |
| ---------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `agent-transport-ws`         | `createWsHandler`, `createOutboundDelivery`, `createPendingStallClock`, `resolveAdmission`, `decodeChannelFrame`, `encodeBinaryFrame`, `encodeChannelEventFrame`, `isOverPendingBudget`, `DEFAULT_MAX_PENDING_BYTES`, types                                                |
| `agent-transport-webrtc`     | `createWsHandler`, `createOutboundDelivery`, `resolveAdmission`, `SessionResumeBridge`, types                                                                                                                                                                              |
| `agent-transport-http`       | `resolveAdmission`, `bearerCredential`, `credentialMatches`                                                                                                                                                                                                                |
| `agent-transport-gui`        | `decodeFrame`, `decodeServerMessage`, `TClientMessage`, `TServerMessage`                                                                                                                                                                                                   |
| `agent-transport-webrtc-web` | `decodeServerMessage`, `TClientMessage`, `TServerMessage`                                                                                                                                                                                                                  |
| `agent-cli`                  | `SessionResumeBridge`, `buildHandoffManifest`, `beginHandoff`/`advanceHandoff`/`commitHandoff`, `chunkHandoffPayload`, `verifyHandoffPayload`, `HandoffChunkAssembler`, `sourceStillOwns`, `IHandoffTransaction` (tests only: `createWsHandler`, `createOutboundDelivery`) |
| `agent-transport-mcp`        | none                                                                                                                                                                                                                                                                       |

## Prior Art Research

Product documentation only. The tables below are **reused verbatim** from the absorbed `STRUCT-012`
draft (issue #2197) and from the `INFRA-158` backup
(`git show backup/infra-158-gates:.agents/spec-docs/backlog/INFRA-158-ship-a-browser-entry-point-for-the-transport-protocol-package.md`);
no quotation was altered. The earlier draft's own recommendation (a declared layer table rather than
a rename) is superseded by owner ruling 2, and that supersession is recorded in § Decision — not by
editing the evidence. Every statement of absence below is scoped to the pages read.

### Sources

| Tag          | Product            | Document                                          | URL                                                                                                              |
| ------------ | ------------------ | ------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `NX-EMB`     | Nx                 | Enforce Module Boundaries                         | https://nx.dev/docs/features/enforce-module-boundaries                                                           |
| `NX-DIM`     | Nx                 | Tag in Multiple Dimensions                        | https://nx.dev/docs/guides/enforce-module-boundaries/tag-multiple-dimensions                                     |
| `NX-PDR`     | Nx                 | Project Dependency Rules                          | https://nx.dev/docs/concepts/decisions/project-dependency-rules                                                  |
| `TURBO-B`    | Turborepo          | `turbo boundaries` API reference (Tags)           | https://turborepo.com/docs/reference/boundaries                                                                  |
| `BZL-VIS`    | Bazel              | Visibility                                        | https://bazel.build/concepts/visibility                                                                          |
| `DC-RULES`   | dependency-cruiser | Rules reference                                   | https://raw.githubusercontent.com/sverweij/dependency-cruiser/main/doc/rules-reference.md                        |
| `NET-NS`     | Microsoft Learn    | Framework Design Guidelines — Names of Namespaces | https://learn.microsoft.com/en-us/dotnet/standard/design-guidelines/names-of-namespaces                          |
| `GO-LAYOUT`  | Go                 | Organizing a Go module                            | https://go.dev/doc/modules/layout                                                                                |
| `MS-LAYER`   | Microsoft Learn    | Common web application architectures              | https://learn.microsoft.com/en-us/dotnet/architecture/modern-web-apps-azure/common-web-application-architectures |
| `NPM-DEP`    | npm CLI            | `npm-deprecate`                                   | https://docs.npmjs.com/cli/v11/commands/npm-deprecate                                                            |
| `NPM-DEPDOC` | npm Docs           | Deprecating and undeprecating packages            | https://docs.npmjs.com/deprecating-and-undeprecating-packages-or-package-versions                                |
| `NPM-UNPUB`  | npm Docs           | npm Unpublish Policy                              | https://docs.npmjs.com/policies/unpublish/                                                                       |
| `NPM-PJ`     | npm CLI            | `package.json` — `name` / `exports`               | https://docs.npmjs.com/cli/v11/configuring-npm/package-json                                                      |
| `AISDK-VER`  | Vercel AI SDK      | Versioning / API stability                        | https://ai-sdk.dev/docs/migration-guides/versioning                                                              |
| `AISDK-40`   | Vercel AI SDK      | Migrate AI SDK 3.4 to 4.0                         | https://ai-sdk.dev/docs/migration-guides/migration-guide-4-0                                                     |
| `NODE-PKG`   | Node.js            | Modules: Packages — conditional / subpath exports | https://nodejs.org/api/packages.html#conditional-exports                                                         |
| `NODE-SUB`   | Node.js            | Modules: Packages — subpath exports               | https://nodejs.org/api/packages.html#subpath-exports                                                             |
| `VITE-TS`    | Vite               | Troubleshooting — module externalized for browser | https://vite.dev/guide/troubleshooting.html#module-externalized-for-browser-compatibility                        |
| `MSW-MIG`    | MSW                | 1.x → 2.x migration                               | https://mswjs.io/docs/migrations/1.x-to-2.x/                                                                     |
| `MCP-SDK`    | MCP TypeScript SDK | Package README                                    | https://github.com/modelcontextprotocol/typescript-sdk                                                           |
| `VBLOB`      | Vercel Blob        | Client uploads                                    | https://vercel.com/docs/vercel-blob/client-upload                                                                |

### Axis 1 — how a family is split into a core and per-surface satellites

| Tag        | Verbatim                                                                                                                                                                                                                                                         |
| ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `AISDK-40` | "**Removed Svelte, Vue, and SolidJS exports** — The `ai` package no longer exports Svelte, Vue, and SolidJS UI integrations. You need to install the `@ai-sdk/svelte`, `@ai-sdk/vue`, and `@ai-sdk/solid` packages directly."                                    |
| `MCP-SDK`  | stdio is documented _"for local/command-line processes"_ and imported as `import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';` while the core comes from `@modelcontextprotocol/server`                                                   |
| `MSW-MIG`  | _"Everything related to the browser-side integration is now exported from the `msw/browser` entrypoint."_                                                                                                                                                        |
| `VBLOB`    | _"Upload a file using the Blob SDK from a browser"_; _"The file goes directly from the browser to Vercel Blob"_; the sample imports from the `/client` subpath while server code imports the package root                                                        |
| `NX-PDR`   | "**UI libraries:** A UI library contains only presentational components." … "**Naming Convention:** `ui` (if nested) or `ui-*`" … "**Data-access libraries:** … **Naming Convention:** `data-access` (if nested) or `data-access-*`"                             |
| `NX-PDR`   | "This article explains **one possible way** to organize your repository projects by type." / "Keep the number of library types low / **Clearly document what each type of library means**"                                                                       |
| `MS-LAYER` | "**Layers represent logical separation within the application.**" / "The UI layer shouldn't make any requests to the DAL directly" / "With a layered architecture, applications **can enforce restrictions on which layers can communicate with other layers.**" |

### Axis 2 — what a name is documented to carry

| Tag         | Verbatim                                                                                                                                                                                                                                                                               | What naming is documented to buy            |
| ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `NET-NS`    | "the goal when naming namespaces is **creating sufficient clarity for the programmer using the framework to immediately know what the content of the namespace is likely to be.**"                                                                                                     | Human clarity                               |
| `NET-NS`    | "❌ **DO NOT use organizational hierarchies as the basis for names in namespace hierarchies, because group names within corporations tend to be short-lived.**" / "✔️ DO use a **stable, version-independent** product name"                                                           | Names should encode stable facts            |
| `GO-LAYOUT` | "The package name matches the last path component of the module name."                                                                                                                                                                                                                 | Identity / import path                      |
| `NPM-PJ`    | "The `name` and `version` together form an identifier that is **assumed to be completely unique**."                                                                                                                                                                                    | Addressing                                  |
| `BZL-VIS`   | "Visibility is specified by listing allowed packages. **Allowing a package does not necessarily mean that its subpackages are also allowed.**"                                                                                                                                         | A prefix is not a grant                     |
| `DC-RULES`  | The canonical same-family rule example, and its documented defect: "**This will correctly flag relations from one folder to another, but also relations _within_ folders.**" — the fix offered is a back-reference `pathNot`                                                           | A path-derived rule needs a precise matcher |
| `NX-EMB`    | "Nx comes with a generic mechanism for expressing constraints on project dependencies: tags." / "You can declaratively define constraints using project tags and enforce them automatically."                                                                                          | Declared metadata as the gate               |
| `TURBO-B`   | "Boundaries also has a feature that lets you add tags to packages. These tags can be used to create rules for Boundaries to check." / "**Package names can also be used in place of a tag in `allow` and `deny` lists.**"                                                              | A package NAME is an accepted rule subject  |
| —           | Across the pages read the documented purposes of a name are uniqueness, identity, human clarity and consistency; `TURBO-B` is the one page read that admits a package name directly as a boundary-rule subject. This is a statement about the pages read, not about all documentation. | —                                           |

### Axis 3 — one package, two runtimes: keeping a Node builtin out of a browser graph

| Tag        | Verbatim                                                                                                                                                                                                                                                                                           |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NODE-SUB` | _"When using the `"exports"` field, custom subpaths can be defined along with the main entry point by treating the main entry point as the `"."` subpath"_ … _"Now only the defined subpath in `"exports"` can be imported by a consumer"_ — other subpaths throw `ERR_PACKAGE_PATH_NOT_EXPORTED`. |
| `NODE-PKG` | _"When using environment branches, always include a `"default"` condition where possible. … For this reason, using `"node"` and `"default"` condition branches is usually preferable to using `"node"` and `"browser"` condition branches."_                                                       |
| `NODE-PKG` | _"Within the `"exports"` object, key order is significant. During condition matching, earlier entries have higher priority and take precedence over later entries."_                                                                                                                               |
| `VITE-TS`  | _"Module "fs" has been externalized for browser compatibility. Cannot access "fs.readFile" in client code."_ / _"This is because Vite does not automatically polyfill Node.js modules."_                                                                                                           |
| `NPM-PJ`   | On `exports`: _"The 'exports' provides a modern alternative to 'main' allowing multiple entry points to be defined, conditional entry resolution support between environments, and preventing any other entry points besides those defined in 'exports'."_                                         |

### Axis 4 — retiring a published npm package name

| Tag          | Verbatim                                                                                                                                                                                                                                    |
| ------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `NPM-DEP`    | "This command will update the npm registry entry for a package, **providing a deprecation warning to all who attempt to install it.**" / "`npm deprecate <package-spec> <message>`" / "**Note: This command is unaware of workspaces.**"    |
| `NPM-DEPDOC` | "A deprecation warning or message can say anything. You may wish to include a message encouraging users to update to a specific version, or **an alternate, supported package**."                                                           |
| `NPM-UNPUB`  | "If your package does not meet the unpublish policy criteria, we recommend deprecating the package… **if they are depending on it their builds will not break.**" / "**Once `package@version` has been used, you can never use it again.**" |
| `AISDK-VER`  | "We maintain backward compatibility for stable features and **only introduce breaking changes in major releases**." / "For major releases, we provide automated codemods where possible"                                                    |

### Axis 5 — how mature TypeScript package families place the root, the siblings and the framework

Ten package families and five enforcement tools, from product documentation plus each family's
dependency graph **as published on npm** (`registry.npmjs.org/<pkg>/latest`, fetched 2026-09-05); no
third-party source code. Owner rulings 1–8 were taken as fixed and are not re-litigated by this axis.

| Tag        | Family / tool                   | Documentation used                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                | Published manifest facts (npm, latest)                                                                                                                                                                                                                                                                                                                                     |
| ---------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `PA-TSQ`   | TanStack Query                  | [v4 announcement](https://tanstack.com/blog/announcing-tanstack-query-v4): "built upon an agnostic core with framework specific adapters on top of it ... share the core logic ... like the QueryClient or Query Subscriptions between frameworks, while also having framework specific code like hooks ... inside adapters."                                                                                                                                                                                                                                                                                     | `@tanstack/query-core` 5.102.8: **0 deps, 0 peers**. `react-query`, `vue-query`, `solid-query`: dep on `query-core` (exact-pinned) + framework as **peer**. No adapter depends on another adapter.                                                                                                                                                                         |
| `PA-TRPC`  | tRPC                            | [Adapters](https://trpc.io/docs/server/adapters): "Adapters act as the glue between the host system and your tRPC API." [Express adapter](https://trpc.io/docs/server/adapters/express): `import * as trpcExpress from '@trpc/server/adapters/express'`; install list is only `@trpc/server`.                                                                                                                                                                                                                                                                                                                     | `@trpc/server` 11.18.0: **0 deps**; adapters are **root subpaths** (`./adapters/express`, `./adapters/fastify`, `./adapters/ws`, `./adapters/node-http`, `./adapters/fetch`, …) plus `./shared`. `@trpc/client`: peer on `@trpc/server`. `@trpc/react-query`: peers on `@trpc/client`, `@trpc/server`, `@tanstack/react-query`, `react`.                                   |
| `PA-CONN`  | Connect-ES                      | [Repo README](https://github.com/connectrpc/connect-es/blob/main/README.md): `@connectrpc/connect` "RPC clients and servers for your schema"; `connect-web` "Adapters for web browsers and any other platform that has the fetch API on board"; `connect-node` "Serve RPCs on vanilla Node.js servers"; `connect-fastify` "Plug your services into a Fastify server"; `connect-express` "Adds your services to an Express server".                                                                                                                                                                                | `@connectrpc/connect` 2.1.2: **0 deps** (peer `@bufbuild/protobuf`); exports **`./protocol`, `./protocol-connect`, `./protocol-grpc`, `./protocol-grpc-web`** as root subpaths. `connect-web`, `connect-node`: peer on `connect` only. `connect-fastify`, `connect-express`: peer on `connect` **and `connect-node`** (a layered sibling) plus the host framework as peer. |
| `PA-LP2P`  | libp2p                          | [Repo README](https://raw.githubusercontent.com/libp2p/js-libp2p/main/README.md): `@libp2p/interface` "The interface implemented by a libp2p node"; `@libp2p/utils` "Package to aggregate shared logic and dependencies for the libp2p ecosystem". [CONFIGURATION.md](https://github.com/libp2p/js-libp2p/blob/main/doc/CONFIGURATION.md): "js-libp2p acts as the composer for this modular p2p networking stack using libp2p compatible modules as its subsystems"; "A libp2p transport just needs to be compliant with the Transport Interface"; "`@libp2p/tcp` (not available in browsers)".                   | `@libp2p/interface` 3.3.0: types + a few pure deps, **no node builtins**. `@libp2p/tcp`, `@libp2p/websockets`: dep on `interface` + `utils`; **never on `libp2p`**. `libp2p` 3.3.11 (the composer): deps on `interface`, `interface-internal`, `utils`, … **never on any transport**. `tcp`/`websockets` use the `browser` field to swap node files.                       |
| `PA-OTEL`  | OpenTelemetry JS                | [Repo README](https://github.com/open-telemetry/opentelemetry-js/blob/main/README.md): `@opentelemetry/api` "TypeScript interfaces, enums and no-op implementations ... intended for use both on the server and in the browser". [CONTRIBUTING](https://github.com/open-telemetry/opentelemetry-js/blob/main/CONTRIBUTING.md): "Universal packages are packages that can be used in both web browsers and Node.js ... For packages with platform-conditional code (browser vs node), add a `browser` field to the `package.json` that path-swaps the relevant ... files."                                         | `@opentelemetry/api` 1.9.1: **0 deps**. `sdk-trace-node` → `sdk-trace-base` + `context-async-hooks`; `sdk-trace-web` → `sdk-trace-base` + `core`. **Node and web siblings share via `-base`, never via each other.** `otlp-exporter-base` exports `./node-http` and `./browser-http` subpaths.                                                                             |
| `PA-AISDK` | Vercel AI SDK                   | [Providers and models](https://ai-sdk.dev/docs/foundations/providers-and-models): "a language model specification that abstracts differences between providers ... published as an open-source package, which you can use to create custom providers". [Custom providers](https://ai-sdk.dev/providers/community-providers/custom-providers): `npm install @ai-sdk/provider @ai-sdk/provider-utils`.                                                                                                                                                                                                              | `@ai-sdk/provider` 4.0.10: 1 dep (`json-schema`). `@ai-sdk/openai`, `@ai-sdk/anthropic`: deps on `provider` + `provider-utils` **only — never on `ai`**. `ai` 7.0.93 (framework): deps on `provider`, `provider-utils`, `gateway`. `@ai-sdk/react`: dep on `ai` (UI host sits _above_ the framework).                                                                      |
| `PA-MCP2`  | MCP TypeScript SDK v2           | [Repo README](https://github.com/modelcontextprotocol/typescript-sdk/blob/main/README.md): middlewares (`/node`, `/express`, `/fastify`, `/hono`) "are intentionally thin adapters: they should not introduce new MCP functionality or business logic." [Upgrade to v2](https://ts.sdk.modelcontextprotocol.io/v2/migration/upgrade-to-v2): "`@modelcontextprotocol/core-internal` is `private: true` and is not published — do not import from it directly"; "the root entries are runtime-neutral so browser/Workers bundlers can consume them"; "Declare in every member exactly what its own sources import". | `@modelcontextprotocol/core` 2.0.0: dep `zod` only. `/server`, `/client` → `/core`. `/node`, `/express`, `/fastify`, `/hono`: **peer** on `/server` + host framework; none depends on another middleware. Node-only transports: `./stdio` subpath, not in root barrel.                                                                                                     |
| `PA-SIO`   | Socket.IO                       | [How it works](https://socket.io/docs/v4/how-it-works/): two layers, each "server / client / parser"; parser is the shared piece. [socket.io-adapter README](https://raw.githubusercontent.com/socketio/socket.io/main/packages/socket.io-adapter/Readme.md): "Default socket.io in-memory adapter class ... not intended for end-user usage, but can be used as an interface to inherit from other adapters".                                                                                                                                                                                                    | `socket.io` → `engine.io`, `socket.io-parser`, `socket.io-adapter`. `socket.io-client` → `engine.io-client`, `socket.io-parser`. Server and client siblings share only through `-parser`.                                                                                                                                                                                  |
| `PA-HONO`  | Hono                            | [Web Standard](https://hono.dev/docs/concepts/web-standard): "Hono uses only Web Standards, which means that Hono can run on any runtime that supports them"; Node "requires a Node.js adapter". [Adapter helper](https://hono.dev/docs/helpers/adapter): `import { env, getRuntimeKey } from 'hono/adapter'`.                                                                                                                                                                                                                                                                                                    | `hono` 4.13.7: **0 deps**; runtime adapters are **root subpaths** (`./bun`, `./deno`, `./vercel`, `./netlify`, `./adapter`, …). Node is the one **separate package** `@hono/node-server`, peer on `hono`.                                                                                                                                                                  |
| `PA-LC`    | LangChain JS                    | [LangChain 0.1 architecture](https://www.langchain.com/blog/the-new-langchain-architecture-langchain-core-v0-1-langchain-community-and-a-path-to-langchain-v0-1): community split because "having so many integrations in the same package also makes it next to impossible to properly version them". [@langchain/core README](https://www.npmjs.com/package/@langchain/core): "Because all used packages must share the same version of core, packages should never directly depend on @langchain/core. Instead they should have core as a peer dependency and a dev dependency."                               | `@langchain/openai` 1.5.11: **peer** on `@langchain/core`, no dep on `langchain` or on any other partner. `langchain` 1.5.10 (framework): peer on `core`; **no dep on any integration**.                                                                                                                                                                                   |
| `PA-NX`    | Nx (tool)                       | [enforce-module-boundaries](https://nx.dev/docs/features/enforce-module-boundaries): "Nx comes with a generic mechanism for expressing constraints on project dependencies: tags"; `depConstraints: [{ sourceTag, onlyDependOnLibsWithTags \| notDependOnLibsWithTags }]`; tags match by exact string, glob (`scope:*`) or regex.                                                                                                                                                                                                                                                                                 | tag-based                                                                                                                                                                                                                                                                                                                                                                  |
| `PA-DC`    | dependency-cruiser (tool)       | [Rules reference](https://github.com/sverweij/dependency-cruiser/blob/main/doc/rules-reference.md): `from.path` capture groups are reusable in `to` as `$1`; documented example `no-inter-ubc`: `from: {path: "^src/business-components/([^/]+)/.+"}`, `to: {path: "^src/business-components/([^/]+)/.+", pathNot: "^src/business-components/$1/.+"}`.                                                                                                                                                                                                                                                            | name/path pattern with capture                                                                                                                                                                                                                                                                                                                                             |
| `PA-JSB`   | eslint-plugin-boundaries (tool) | [Selectors](https://www.jsboundaries.dev/docs/selectors/): captured values `{{ from.element.captured.family }}`; documented policy "disallow dependencies between elements of the same type that belong to different families" using `captured: { family: "!{{ from.element.captured.family }}" }`.                                                                                                                                                                                                                                                                                                               | name pattern with capture + negation                                                                                                                                                                                                                                                                                                                                       |
| `PA-TURBO` | Turborepo Boundaries (tool)     | [Boundaries](https://turborepo.dev/docs/reference/boundaries): default checks = importing files outside the package directory and "importing packages not declared as dependencies in `package.json`"; "package names can also be used in place of a tag". [Structuring a repository](https://turborepo.dev/docs/crafting-your-repository/structuring-a-repository): "avoid accessing files across package boundaries as much as possible".                                                                                                                                                                       | tag/name allow-deny on manifests + undeclared-import check                                                                                                                                                                                                                                                                                                                 |
| `PA-SYNC`  | syncpack (tool)                 | [syncpack.dev](https://syncpack.dev/): version consistency (`versionGroups`, `semverGroups`, pin/ban).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            | versions only — does not enforce direction                                                                                                                                                                                                                                                                                                                                 |

Could not be verified from product docs: whether any of the ten families _documents_ running one of
the five tools in its own repository (the contributor docs fetched do not say). The Nx library-types
page came via search snippets, not a direct fetch.

### Observed common behavior

1. **A family is shipped as one core package plus per-surface satellites that consumers install
   directly** — `ai` + `@ai-sdk/<surface>` (`AISDK-40`), `@modelcontextprotocol/server` + `/stdio`
   (`MCP-SDK`). The pages read document the satellites' relation to the core; they do not document a
   satellite-to-satellite dependency, and this spec makes no claim about one beyond that.
2. **The environment-specific slice of one package is split at a named subpath, not tree-shaken away**
   — `msw/browser` (`MSW-MIG`), Vercel Blob's `/client` (`VBLOB`), `/stdio` (`MCP-SDK`); Node documents
   the subpath as the mechanism and the unknown-subpath failure as a hard error (`NODE-SUB`), and Vite
   documents that a Node builtin reached from a browser graph is a hard failure (`VITE-TS`).
3. **A package name is an accepted subject of a boundary rule** in at least one tool consulted
   (`TURBO-B`); the others consulted carry the boundary in declared tags. Owner ruling 2 chooses the
   name as the subject for this repository.
4. **A path-derived same-family rule has one documented defect — it also fires within the family —
   and the documented fix is a more precise matcher** (`DC-RULES`). The gate here needs exactly that
   precision: parent is legal, sibling is not.
5. **Where a distinct UI prefix is prescribed it is one option among several** (`NX-PDR` `ui-*`), and
   a layer is a logical property with a one-directional rule (`MS-LAYER`).
6. **Retiring a published name is a one-way, consumer-visible event with a fixed recipe:** publish the
   replacement, `npm deprecate <old> "<message naming the replacement>"`, never unpublish; the command
   is workspace-unaware (`NPM-DEP`, `NPM-DEPDOC`, `NPM-UNPUB`). The AI-SDK ecosystem gates the same
   move to a major release with a migration guide (`AISDK-VER`).
7. **The family root is the contract plus runtime-neutral shared logic, and it is dependency-free or
   near-free in 8 of the 10 families** (`query-core` 0, `@trpc/server` 0, `@connectrpc/connect` 0,
   `hono` 0, `@opentelemetry/api` 0, `@modelcontextprotocol/core` 1, `@ai-sdk/provider` 1,
   `@libp2p/interface` a few pure codecs). **In 10 of 10 the root depends on neither the framework nor
   any child.** Roots declare runtime neutrality in prose (`PA-OTEL` "server and in the browser",
   `PA-MCP2` "root entries are runtime-neutral", `PA-HONO` "only Web Standards").
8. **Code shared among siblings lives first in a root subpath** — tRPC `./shared` and
   `./adapters/node-http`, Connect `./protocol*`, Hono `./adapter` — and second in a named substrate
   below the root (`-base`, `-utils`, `-parser`, `-internal`; MCP keeps its `core-internal`
   `private: true`). **No `-common`, `-shared` or `-protocol` package exists in any of the ten
   families**; `-protocol` appears only as Connect's root subpaths. Where a sibling does import a
   sibling (`connect-fastify → connect-node`, `@trpc/react-query → @trpc/client`) the package's own
   description names it as a layer ("plug X into Y"), never as shared substrate.
9. **The composer depends on the contract and never on a per-concern child, and the children never
   import the composer** — `libp2p` → `interface`/`utils`, never → transports; `ai` → `provider`,
   never → `@ai-sdk/openai`; `langchain` → `core`, never → partners; `@ai-sdk/openai` never → `ai`.
   The one child layer that does sit above the framework is the **UI/host** layer (`@ai-sdk/react` →
   `ai`, `@trpc/react-query` → `@trpc/client`), with the host framework as a peer. 10/10 for
   "framework never depends on a child".
10. **The enforcement shape that matches a name-derived family rule is a capture rule, not a tag** —
    dependency-cruiser's `$1` (`PA-DC`) and eslint-plugin-boundaries' `captured.family` with `!`
    negation (`PA-JSB`); Nx tags (`PA-NX`) would need a tag maintained per family in parallel with the
    name. Turborepo pairs its boundary check with an **undeclared-import** check (`PA-TURBO`), and MCP
    writes the same rule in prose: "Declare in every member exactly what its own sources import".
11. **Node-only code in a runtime-neutral root is a named subpath** — MCP `server/stdio`, OTel
    `otlp-exporter-base/node-http` vs `/browser-http`, tRPC `adapters/node-http`, Hono `hono/bun` — or
    a platform sibling package (`connect-node`/`connect-web`, `sdk-trace-node`/`-web`,
    `@hono/node-server`); the invariant across all of them is that the root's default entry contains
    no `node:` import.

### Constraints that apply to Robota

- Axis 5 converges with rulings 5–6 and adds three things this spec adopts in § Decision: the
  substrate is a root concern (a root subpath, `PA-TRPC`/`PA-CONN`/`PA-HONO`), not a `-protocol`
  package; the framework must never import a transport child (`PA-LP2P`/`PA-AISDK`/`PA-LC`, 10/10),
  which becomes a companion assertion in the gate; and the family holds two child layers — protocol
  transports (`-ws/-http/-mcp/-webrtc/-webrtc-web`, the libp2p-transport / AI-provider shape) and
  hosts (`-tui/-gui`, the `@ai-sdk/react` shape) — which ruling 7 permits to differ in what they
  import.

- The gate must distinguish parent from sibling by name alone (rulings 1–2), and must not fire on the
  parent edge it exists to permit — `DC-RULES`'s documented defect is the failure mode to prove
  against (TC-01).
- The substrate the children import must carry no Node builtin at its root, because two children are
  browser bundles and Vite will not polyfill (`VITE-TS`); tree-shaking (ruling 7) removes unused
  framework values, not a builtin the root barrel resolves. The two `node:crypto` users
  (`admission.ts`, `handoff-manifest.ts`) therefore live behind an explicit subpath (`NODE-SUB`), the
  shape `INFRA-158` already concluded for this exact code — reused here under the parent's name.
- `@robota-sdk/agent-transport-protocol` is published at `3.0.0-beta.79`; its removal follows
  `NPM-DEPDOC`'s recipe and is an owner release-checklist step (ruling 11; § Decision S5), not a plan item.
- `agent-transport-gui` is `private: true` and carries no registry cost; `agent-transport-tui` is
  published, so `NPM-UNPUB`'s "can never use it again" applies to it alone. The cost asymmetry from the
  absorbed draft stands (64 vs 110 live files).
- `NET-NS`'s stable-facts principle is satisfied by ruling 2 only if the names are made true first —
  a gate derived from names that lie would freeze the lie. That is why the parent is purified and the
  substrate absorbed **before** the baseline is allowed to shrink.

## Architecture Review

### Affected Scope

- `scripts/harness/check-dependency-direction.mjs` — generalise the `dag-node-*` sibling rule
  (`:303-330`) into a name-derived `agent-<family>-*` family rule; `scripts/harness/__tests__/check-dependency-direction.test.mjs`
- `scripts/harness/family-sibling-baseline.json` — new, frozen, shrink-only; deleted at the end
- `packages/agent-transport/**` — purified to `agent-interface-*` + pure TS; absorbs the substrate
- `packages/agent-framework/**` — receives the runtime-host modules (headless, programmatic, registry,
  settings repository)
- `packages/agent-transport-protocol/**` — dissolved (104 live referencing files)
- `packages/agent-transport-{ws,http,webrtc,gui,webrtc-web}/**`, `packages/agent-cli/**`,
  `examples/capabilities/multi-surface-deploy/**` — consumer rewiring (`apps/remote-signaling` is not
  a consumer: manifest `agent-interface-session` + `ws` only)
- the ten harness files in § Decision's scans table (`scan-transport-admission.mjs`,
  `scan-deployment-matrix.mjs`, `scan-tui-safe-text-boundary.mjs`, `check-capability-placement.mjs`,
  `check-agent-server-boundary.mjs`, `scan-transport-conformance.mjs`, `release-test-suites.mjs`,
  `changed-path-capabilities.mjs`)
- `packages/agent-transport-gui/**` (+ 64 live files) → `packages/agent-ui-web` (forced by the gate:
  `-webrtc-web → -gui` is a sibling edge); `packages/agent-transport-tui/**` (+ 110) →
  `packages/agent-ui-terminal` (ruling 9, published, deprecated at the successor's release)
- `.agents/project-structure.md:26-29`, `ARCHITECTURE.md:48-57`, `.agents/publish-registry.md:53`,
  `README.md:146`, `content/guide/architecture.md:82-83`, `diagrams/robota-architecture.mmd:25`,
  `.agents/harness.config.json:509`, `packages/agent-transport*/docs/SPEC.md`

### Sibling scan

Every `agent-<family>-*` family in the workspace was measured with the same enumeration (TC-02); the
`agent-ui-*` family this item creates (ruling 9) does not exist yet — `git grep -l "agent-ui-"` finds
nothing — and is under the same rule from its first member, parent or no parent (TC-01 plants it):
`agent-interface-*` (7 members, 4 sibling edges — all authorized by the `ARCH-101` map),
`agent-provider-*` (6, 1 edge), `agent-transport-*` (8 + parent, 6 edges), `agent-remote-*` (2, 0),
`agent-tool-*` (2, 0), `agent-cli-*` (1 + parent, 0), `agent-command-*` (1 + parent, 0),
`agent-session-*` (1 + parent, 0), `agent-builtin-*` (1, 0), `agent-capability-*` (1, 0),
`agent-subagent-*` (1, 0). Child → parent runtime edges today: **0** in every family (`-tui` and
`agent-cli` reach `agent-transport`; `-tui` only as a `devDependency`). The `dag-node-*` rule and the
`agent-interface-*` rule were read as the two existing shapes; the `STRUCT-011` rename (PR #2201,
63 files / 11 packages) was read as the rename procedure. `agent-tool-defaults` carries ruling 3's
refused naming class and is out of scope here (see § Out of scope).

### Alternatives Considered

1. **Name-derived family gate + parent purification + absorb the substrate into `agent-transport` +
   dissolve `-protocol` + rename the presentation packages (the owner's direction, rulings 1–6).**
   **Pro:** the check is derived from the names, so it costs no declaration and cannot drift from one;
   the six red edges are removed by moving the substrate to the one name every child may import; the
   parent becomes the lowest member of its family, which is the only shape under which "child imports
   parent" is a downward edge; the browser children keep a Node-free graph. **Con:** the largest
   option — 104 + 44 + 64 + 110 live files, one published package removed and one published package
   renamed, `agent-framework`'s surface grows; the owner's literal 5(a) split was red under the gate
   (measured above) and had to go back to the owner before S3 could be fixed (it has: ruling 8).
2. **Declare a per-family layer table and guard from the table; no rename, no move (the absorbed
   draft's alternative 1).** **Pro:** zero public surface changed; the mechanism exists
   (`interface-layers.mjs`) and is dual-consumed; the six edges become legal by declaration.
   **Con:** refused by ruling 2 — "패키지 이름을 계층적으로 구성한 이유는 이렇게 쉽게 위반사항을 검출하기
   위한 것입니다". A table beside the names is a second parser of one fact, and it legalises a
   sibling-named package that is factually a lower layer instead of making the name true.
3. **Absorb the substrate into `agent-interface-transport` (a contract package).** **Pro:** every
   child already depends on it, so no new edge appears and no gate goes red. **Con:** the substrate is
   runtime code — `createWsHandler`, `SessionResumeBridge`, `resolveAdmission` (with `node:crypto`),
   handoff chunking — and `scan-interface-runtime.mjs` (`.agents/project-structure.md:306-311`) refuses
   any class or bare value import in an `agent-interface-*` package; the shape would have to be
   frozen into `interface-entry-baseline.json` as a growing exception, which is the vacuous green the
   interface rule exists to refuse. Honestly stated: this option "passes" only by disabling a gate.
4. **Absorb the substrate into `agent-transport` as it is, and move the registry out to keep the
   parent small (no framework purification).** **Pro:** fewer files than 1; the registry's only
   consumer is `agent-cli` (+ one example). **Con:** the parent keeps `headless/` and `programmatic/`,
   which import `agent-framework` values and `node:child_process`/`node:readline` at the **root**
   barrel — the framework values a browser child tree-shakes (ruling 7), the three `node:` builtins it
   does not (`VITE-TS`); and the parent stays impure. Refused by ruling 6.
5. **Keep the substrate in the parent behind a subpath only (`@robota-sdk/agent-transport/session`),
   leaving `headless/`/`programmatic/` at the root.** **Pro:** bundlers follow imports, so a browser
   child importing only the subpath would bundle a clean graph, and under ruling 7 a child's manifest
   edge to a framework-dependent package is not a violation. **Con:** the parent itself stays impure
   (ruling 6 is about the parent, not the children), the `./headless` root keeps three `node:`
   builtins one wrong import away from a browser bundle, and the subpath adds a second name for what
   ruling 5 says is simply `agent-transport`. Refused by ruling 6.
6. **Rename `-protocol` to a non-family prefix and leave the parent alone (the pre-ruling-5 shape).**
   **Pro:** smallest change that makes the six edges legal by name; no framework purification.
   **Con:** refused by ruling 5 — "agent-transport-xxx가 참고하려면 agent-transport를 참고해야 합니다";
   it also leaves `agent-transport` a package no child can import, which contradicts the parent role
   the name claims.
7. **Do nothing.** **Pro:** every edge is legal today because nothing checks it. **Con:** the family
   stays the one prefix-grouped family whose rule lives only in the owner's head; the next sideways
   reach is caught by nothing, and rulings 1–6 are explicit that this is refused.

### Decision

**Alternative 1**, sequenced so that every unit is independently green. Every decision inside it is
now the owner's (rulings 1–11); this section fixes the resulting form and grounds it in Axis 5.

**The gate rule, stated exactly.** For a workspace package whose bare name is `agent-<family>-<rest>`
(three or more dash segments, first segment `agent`), a `dependencies`/`peerDependencies` edge to
another `@robota-sdk/*` package is judged as: (i) to `agent-<family>` — the parent — **legal**; (ii) to
`agent-<family>-<other>` — a sibling, at any depth — **illegal**; (iii) to anything else — not this
rule's business (the existing rules judge it: `INTERFACE-DEPS`, `dag-node` leaf, purity, cycles).
Explicitly under (iii): a child `agent-transport-*` depending on `@robota-sdk/agent-framework` is
**legal** (ruling 7) and the gate must not report it — TC-01 plants that edge in the fixture.
Two companion clauses close the directions Axis 5 shows are always closed: (iv) the bare parent
`agent-<family>` must not depend on any `agent-<family>-*` child (the root never imports a child,
10/10 in `PA-*`); (v) `@robota-sdk/agent-framework` and `@robota-sdk/agent-core` must not depend on
any `@robota-sdk/agent-transport-*` or `@robota-sdk/agent-ui-*` package (the composer depends on the
contract, never on a per-concern child — `PA-LP2P`, `PA-AISDK`, `PA-LC`). Both are green today and
cost one manifest read each (TC-11). **Shape:** the rule is a capture rule over the package name —
`from ^@robota-sdk/agent-([a-z]+)-[a-z0-9-]+$` → `to ^@robota-sdk/agent-$1-[a-z0-9-]+$` forbidden,
`to ^@robota-sdk/agent-$1$` allowed — the documented shape of dependency-cruiser's `$1` (`PA-DC`) and
eslint-plugin-boundaries' `captured.family` negation (`PA-JSB`), not an Nx tag maintained beside the
name. And because a manifest rule can be walked around by a source import the manifest does not
declare, it is paired with the Turborepo-Boundaries hygiene check (`PA-TURBO`; MCP's "Declare in
every member exactly what its own sources import"): every `@robota-sdk/*` specifier imported from a
package's production `src/` must appear in **one of** that package's `dependencies`,
`peerDependencies` or `devDependencies` — "undeclared" is absence from all three, the complement
`check-dep-kind.mjs:131` hands to the `deps` scan, so a type-only import carried by a `devDependency`
is not a finding (TC-12).
The family is the second dash segment, so `agent-transport-webrtc-web` is a sibling of
`agent-transport-gui`, and `agent-tools` is not a member of `agent-tool-*`. **The `agent-interface-*`
family is delegated to `INTERFACE-DEPS`**, not baselined: the owner ruled for that prefix (`ARCH-101`,
issue #2180, quoted in `.agents/specs/contract-family-owner-map.md:47-49`) that "the general layer rule
governs this prefix: an `agent-interface-*` package may compose another when the layers differ and the
composition is one-directional", and both guards already read that map. Freezing its four edges in a
shrink-only baseline would make the baseline permanent, which is the shape `ARCH-054` refuses.

**Red-proof of the rule on the current tree and on a fixture.** A prototype of exactly the rule above,
driven by the real `findWorkspacePackages()`, run at `4b03d3248`:

```
$ node scratch/sibling-gate-proto.mjs tree
mode=tree packages=92
parent edges (LEGAL): 0
delegated to INTERFACE-DEPS: 4
  map  agent-interface-session -> agent-interface-analytics
  map  agent-interface-session -> agent-interface-command
  map  agent-interface-session -> agent-interface-execution
  map  agent-interface-session-mobility -> agent-interface-session
VIOLATIONS: 7
  RED  agent-provider-openai -> agent-provider-openai-compatible
  RED  agent-transport-gui -> agent-transport-protocol
  RED  agent-transport-http -> agent-transport-protocol
  RED  agent-transport-webrtc -> agent-transport-protocol
  RED  agent-transport-webrtc-web -> agent-transport-gui
  RED  agent-transport-webrtc-web -> agent-transport-protocol
  RED  agent-transport-ws -> agent-transport-protocol
exit=1

$ node scratch/sibling-gate-proto.mjs fixture      (transport + agent-session + the new agent-ui family;
                                                    agent-transport-ws also depends on agent-framework — not reported, ruling 7;
                                                    agent-ui-web -> agent-transport is cross-family — not reported)
mode=fixture packages=8
parent edges (LEGAL): 3
  ok   agent-transport-ws -> agent-transport
  ok   agent-transport-webrtc -> agent-transport
  ok   agent-session-analytics -> agent-session
VIOLATIONS: 3
  RED  agent-transport-webrtc -> agent-transport-ws
  RED  agent-session-replay -> agent-session-analytics
  RED  agent-ui-terminal -> agent-ui-web            (no bare agent-ui parent exists; the rule is the same)
exit=1
```

The tree run is red on exactly the six transport edges plus one `agent-provider-*` edge; the fixture
run proves parent-legal / sibling-illegal in three families, including the parentless `agent-ui-*`
family ruling 9 creates. These seven edges are the **frozen
baseline** of S1. The provider edge is the same defect class in another family
(`agent-provider-openai-compatible` is a lower layer wearing a sibling name) and is recorded as a
separate root item, not absorbed (§ Out of scope).

**Why the rename is forced, not preferred.** Once the gate is armed, the only way an edge leaves the
baseline is for one of its endpoints to stop being a sibling: `agent-transport-protocol` must become
`agent-transport` (ruling 5), and `agent-transport-gui` must leave the family or `-webrtc-web` must
stop importing it. The gate makes the names true or stays red; there is no third state.

**What Axis 5 adds to the owner's rulings.** (1) The root of a family is the contract plus the
runtime-neutral shared logic and nothing heavier — 8 of 10 roots are dependency-free and 10 of 10
depend on neither the framework nor a child (`PA-*`, observed 7). Ruling 6's parent is exactly that
root. (2) Code shared among siblings is a **root subpath**, first, and never a `-protocol`/`-common`/
`-shared` package — tRPC `./shared`, Connect `./protocol*`, Hono `./adapter` (observed 8). Ruling 5's
absorption of `-protocol` into `agent-transport` is that convention applied. (3) The composer depends
on the contract and never on a child, and the children never import the composer (observed 9). Robota
differs by ruling 7 in one direction only — a child **may** reference `agent-framework` — so the
recommendation is layered rather than absolute: the **protocol transports**
(`-ws`/`-http`/`-mcp`/`-webrtc`/`-webrtc-web`) depend on the root + `agent-interface-*` only, the
libp2p-transport / AI-provider shape they already have, while the **hosts** (`agent-ui-terminal`,
`agent-ui-web`) may depend on `agent-framework`, the `@ai-sdk/react → ai` shape `-tui` already has.
This is a recommendation, not a gate clause — ruling 7 says so — but its converse **is** a gate
clause: `agent-framework`/`agent-core` never import a transport or UI child (clause (v), TC-11).
(4) The gate is a name-capture rule paired with an undeclared-import check (observed 10; clauses
above, TC-12). (5) Node-only code sits behind a root `./node` subpath (observed 11) — already the
shape of § Problem's `admission.ts` / `handoff-manifest.ts` disposition.

**S3 in its decided form (ruling 8).** All 16 `-protocol` modules move to `agent-transport`'s root
(`admission.ts`, `handoff-manifest.ts` under `src/node/`); the four `ws-`-named modules are renamed by
what they are — `ws-protocol.ts` → `wire-messages.ts`, `ws-handler.ts` → `session-message-handler.ts`
with `createWsHandler` → `createSessionMessageHandler` and `IWsHandlerOptions` →
`ISessionMessageHandlerOptions`, `ws-session-events.ts` → `session-events.ts`,
`ws-background-messages.ts` → `background-messages.ts` — and nothing moves to `-ws`, because nothing
in them names a WebSocket carrier (measured in § Problem); the carrier code already lives in `-ws`
(`ws-transport.ts`, `ws-transport-configurable.ts`). 44 live files carry the old names and are
rewritten in S3; no alias export is kept, since the published `-protocol` name is retired in the
same item and every consumer is in-tree.

**S5 in its decided form (ruling 9).** `agent-transport-gui` → `@robota-sdk/agent-ui-web` and
`agent-transport-tui` → `@robota-sdk/agent-ui-terminal`, both now, creating the `agent-ui-*` family
(`NX-PDR`'s `ui-*` convention; no existing family reads as its sibling). The last transport baseline
entry, `agent-transport-webrtc-web → agent-transport-gui`, is **resolved by this rename**: after S5
the edge is `agent-transport-webrtc-web → agent-ui-web`, cross-family, which clause (iii) leaves to
the other rules — and it is the `@ai-sdk/react → ai` / `connect-fastify → connect-node` shape Axis 5
documents as a layer, a browser peer built over a UI core. The new family is under the sibling rule
from its first member (`agent-ui-terminal → agent-ui-web` would be red; TC-01 plants it).

**The parent's target state (ruling 6).** `packages/agent-transport/package.json` `dependencies` =
exactly `@robota-sdk/agent-interface-{transport,session,session-mobility,command,execution,analytics}`
— the set `agent-transport-protocol` declares today — and nothing else; no `agent-core`, no
`agent-framework`, no `node:` builtin reachable from the root entry. Module-by-module disposition:

| Module (today in `agent-transport`)                                                                                                                                   | Coupling measured                                                                      | Goes to                                                                                                                                | Why not the parent                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `headless/*` — `HeadlessInteractionChannel.ts`, `headless-runner.ts`, `headless-session.ts`, `headless-stream-json.ts`, `headless-transport.ts`, `index.ts` (6 files) | `agent-framework` value, `node:child_process`, `node:crypto`, `agent-core` types       | `agent-framework` (the "Runtime host" layer in `ARCHITECTURE.md:41-42`: `buildRuntimeSession` / `startRuntimeHost`)                    | it builds a runtime session — a host, not a transport substrate                                                                                                                                                                                                                                                                                                                                  |
| `headless/print-terminal.ts`, `headless/cli-input.ts`                                                                                                                 | `agent-core` types, `node:readline`; no framework import                               | `agent-cli`                                                                                                                            | not runtime-host modules: nothing in `headless/` consumes them, their only importer is `agent-cli` (`cli.ts`, `init/init-command.ts`, `startup/project-setup-routing.ts`), `.agents/project-structure.md` § Implementation Owner Boundaries assigns prompt intake and rendering to `agent-cli`, and `.agents/harness.config.json:24` keeps `agent-framework` a "platform-neutral assembly layer" |
| `programmatic/*` (3 files)                                                                                                                                            | `agent-framework` value, `agent-core` types                                            | `agent-framework`                                                                                                                      | same: it builds an interactive runtime                                                                                                                                                                                                                                                                                                                                                           |
| `transport-settings-repository.ts`                                                                                                                                    | `agent-framework` value (`readSettings`/`writeSettings`)                               | `agent-framework`                                                                                                                      | file settings I/O through the framework                                                                                                                                                                                                                                                                                                                                                          |
| `transport-registry.ts`, `transport-settings-view.ts`, `transport-run-generation.ts`, `transport-registry-errors.ts`                                                  | `agent-core` types (`IDestroyResult`, `TUniversalValue`); composes the file repository | `agent-framework`                                                                                                                      | the registry is what a host composes transports **with**; its only production consumer is `agent-cli` (+ one example). Ambiguous → not kept (ruling 6)                                                                                                                                                                                                                                           |
| substrate arriving from `-protocol` (16 modules)                                                                                                                      | `agent-interface-*` only; `node:crypto` in `admission.ts`, `handoff-manifest.ts`       | `agent-transport` root; the two `node:crypto` users behind `@robota-sdk/agent-transport/node` (`NODE-SUB`, the `INFRA-158` conclusion) | this IS the substrate                                                                                                                                                                                                                                                                                                                                                                            |

Consumer import changes: `agent-cli` (8 production files) takes `HeadlessInteractionChannel`,
`OUTPUT_FORMATS`, `TOutputFormat` and `TransportRegistry` from `@robota-sdk/agent-framework` instead
of `@robota-sdk/agent-transport` / `/headless`; `PrintTerminal` and `promptInput` become **local**
`agent-cli` modules (`print-terminal.ts`, `cli-input.ts` move into `packages/agent-cli/src/`, per the
disposition table) imported by relative path; and the handoff/bridge symbols come from
`@robota-sdk/agent-transport` instead of `-protocol`.
`agent-transport-tui` changes nothing in production (its `agent-transport` edge is a `devDependency`
with no `src` import). `examples/capabilities/multi-surface-deploy` takes `TransportRegistry` from
`agent-framework`. `agent-framework` gains no workspace dependency (it already depends on
`agent-core`, `agent-interface-{transport,session,…}`); it gains the `node:` builtins headless
already uses, which is consistent with its existing `yaml`/settings file I/O.

**Browser safety of the parent, guaranteed rather than hoped.** Ruling 7 settles the framework half:
a child may reference `agent-framework`, and a browser bundle tree-shakes the framework values it does
not import. The half tree-shaking does not settle is the `node:` builtin — a browser bundler resolves
it from whichever barrel the bundle imports and, per `VITE-TS`, does not polyfill it — so the parent's
root must simply not carry one. After S2 the parent's root graph has no `node:` import (the three
today are in `headless/`, which leaves). After S3 the only `node:`
imports are `admission.ts` and `handoff-manifest.ts` (`node:crypto`: `randomBytes`, `timingSafeEqual`,
`createHash`), placed under `src/node/` and exported only as the `./node` subpath, declared with
`"browser": null` exactly as `packages/agent-core/package.json` declares its own `./node` — the
`CORE-028` shape, whose scan (`scripts/harness/scan-browser-package-node-subpath.mjs`) refuses a
Node-only subpath import from any package that declares a `browser` build; the root barrel does not
re-export them. TC-06 asserts `git grep "from 'node:" packages/agent-transport/src` outside
`src/node/` and `__tests__/` prints nothing, and that `src/index.ts` does not reference `./node/`. The
WebCrypto rewrite that would make the two isomorphic (the `agent-remote-pairing` shape) is a security
change to `SEC-008` admission and is deliberately not bundled here.

**Validation before approval** (`spec-workflow.md` § Validated Recommendation): _Reachability_ —
every production consumer of `-protocol` and of the parent's leaving modules is enumerated in
§ Problem with the symbols it takes, and each has a named destination package it already depends on
or may legally depend on (children → parent; `agent-cli` → framework, which it already imports).
_Capability preservation_ — no symbol is dropped; the 16 substrate modules move whole, `createWsHandler`
keeps its behaviour as `createSessionMessageHandler` (ruling 8), and `agent-cli`'s headless/print paths are covered
by its existing suite (TC-09). _Adversarial pass_ — (a) the gate passing on the parent edge by
accident: TC-01 fixture asserts the parent edge is reported legal and the sibling edge red in two
families; (b) a baseline that outlives its violation: TC-03 asserts a stale entry is a finding;
(c) the family resolving to zero members: TC-01 asserts the examined-member count is printed and a
zero count is a finding; (d) the parent re-acquiring a framework edge later: TC-05 is a manifest
assertion that stays in `pnpm harness:scan` after this item; (e) the literal 5(a) move going red:
measured in § Problem, put to the owner, and settled as ruling 8 before S3 was fixed; (f) the
manifest rule bypassed by an undeclared source import: TC-12.

**Delivery mode:** `sequenced`

**Continuation artifacts:** `scripts/harness/check-dependency-direction.mjs`, `scripts/harness/family-sibling-baseline.json`, `packages/agent-transport/package.json`, `packages/agent-transport/src/index.ts`, `packages/agent-framework/src/index.ts`, `packages/agent-transport-ws/package.json`, `packages/agent-transport-gui/package.json`, `.agents/project-structure.md`, `ARCHITECTURE.md`

**Sequence, and why each unit is green on its own:**

1. **S1 — arm the name-derived gate and freeze.** Generalise `checkDagNodesLeaf`'s sibling clause into
   `checkFamilySiblings` in `check-dependency-direction.mjs`, delegate `agent-interface` to
   `INTERFACE-DEPS`, freeze the seven measured edges in `family-sibling-baseline.json` (shrink-only: an
   unlisted edge fails, a stale entry fails). No package changes. Green because the baseline is exactly
   today's set. TC-01, TC-02, TC-03, TC-04.
2. **S2 — purify the parent.** Move `headless/` (minus the two terminal-I/O files), `programmatic/`,
   the registry group and the settings repository to `agent-framework/src/transport-host/`; move
   `headless/print-terminal.ts` and `headless/cli-input.ts` to `agent-cli` (its only importer — see
   the disposition table); rewire `agent-cli` and the example; drop `agent-core` and `agent-framework`
   from the parent's manifest. **Tests that compose the framework move with the code, not into the
   framework:** `src/__tests__/headless-host-action-parity.test.ts` and
   `src/headless/__tests__/headless-skill-activation.integration.test.ts` import
   `@robota-sdk/agent-command`, and `agent-command → agent-framework`, so placing them in
   `agent-framework` would be a `DEV-CYCLE` (rule 6) finding; they move to the `agent-cli` suite, the
   one layer that legally depends on both packages (the alternative — rewriting them over
   `agent-framework/testing` doubles — is rejected because the parity test exists to exercise the real
   command modules). Both moved tests import `createProgrammaticAgent` and `createHeadlessTransport`
   by relative path today; after S2 those two are **root-barrel exports of
   `@robota-sdk/agent-framework`** (with `HeadlessInteractionChannel`, `createHeadlessRunner`,
   `OUTPUT_FORMATS`, `TransportRegistry`, the two settings-repository factories), and the tests import
   them by package specifier. No family edge changes, so the baseline is untouched and the gate stays
   green. TC-05, TC-09.
3. **S3 — absorb the substrate and rewire, as one unit.** There is no shim: an `export * from
'@robota-sdk/agent-transport'` in `-protocol` is exactly what `checkPassthroughReexports`
   (`check-dependency-direction.mjs:125-156`) refuses, and it has no allowlist — so S3 cannot be
   split into "move" and "rewire" with a green tree in between. One unit: `git mv` the 16 modules into
   the parent (`admission.ts`, `handoff-manifest.ts` under `src/node/`), rename the four `ws-` modules
   to `wire-messages`, `session-message-handler` (`createSessionMessageHandler`), `session-events`,
   `background-messages` (ruling 8), rewire the seven consumers (`-ws`, `-http`, `-webrtc`, `-gui`,
   `-webrtc-web`, `agent-cli`, `examples/capabilities/multi-surface-deploy` is not one — it imports
   only the registry) to `@robota-sdk/agent-transport` (`/node` where admission or the manifest is
   used), internalise the parent's own test import (`src/__tests__/ws-multi-surface-exit-policy.test.ts:16`
   becomes a relative import; that test also composes `agent-command` + `agent-framework` and moves
   to the `agent-cli` suite with the S2 pair), and delete the parent's `-protocol` `devDependency` —
   a leftover devDependency would be `agent-transport ⇄ agent-transport-protocol` in
   `allDependencies`, which `checkFullGraphCycles` (`:692`) reports. **Honest size: ~104 live files
   in one change** — the same order as `STRUCT-011`'s 63. The five transport baseline entries that
   name `-protocol` are removed in this unit; a stale entry is a finding, so the two cannot drift.
   TC-06, TC-07, TC-12.
4. **S4 — the `agent-ui-*` family (issue #2197, ruling 9).** `git mv packages/agent-transport-gui
packages/agent-ui-web` and `git mv packages/agent-transport-tui packages/agent-ui-terminal`, both
   now, with `STRUCT-011`'s live/historical policy (64 + 110 live files; historical records
   untouched). The `-gui` half removes the last transport baseline entry (`-webrtc-web → -gui`), the S3 unit having removed the five `-protocol` entries.
   Routing rows rewritten in the same change — measured at `4b03d3248`:
   `.agents/project-structure.md:29` (the `agent-transport-*/` row naming both), `:78` (the GUI
   framework table row), `:325` (the implementation-package rule naming `-tui`);
   `.agents/publish-registry.md:54` (`-tui`, beta) and `:67` (`-gui`, internal);
   `.agents/harness.config.json:506` and `:510` (entry-point paths); `README.md:141`;
   `ARCHITECTURE.md:56`; `.github/workflows/ci.yml:1322,1326` (`--filter
@robota-sdk/agent-transport-tui test:pty` — in scope for the reason `STRUCT-011` recorded: leaving
   it lands CI red); `content/guide/architecture.md` (14 lines); `diagrams/robota-architecture.mmd:27-28`;
   plus a new `agent-ui-*/` row in `.agents/project-structure.md`. Green because neither package has
   a sibling edge after the move and `-webrtc-web → agent-ui-web` is cross-family; the S4 rows of the
   scans table are rewritten in the same change, and the ARCH-005 prefix lists gain
   `@robota-sdk/agent-ui-` with the `:24` reason string updated (see below). TC-08, TC-13.
5. **S5 — remove, and the release checklist.** Delete `packages/agent-transport-protocol`, the
   `-protocol` rows of the routing docs, and — once only the provider entry remains and its own root
   item has landed — the baseline file. TC-06, TC-07. **Release checklist (ruling 11; a manual owner
   step, not a plan item):** in the same release run that ships the successors — the first
   `@robota-sdk/agent-transport` carrying the substrate and the first `@robota-sdk/agent-ui-terminal`
   — deprecate every version of each retired name with a pointer:
   `npm deprecate @robota-sdk/agent-transport-protocol "Moved into @robota-sdk/agent-transport as of 3.0.0-beta.N"`
   and `npm deprecate @robota-sdk/agent-transport-tui "Renamed to @robota-sdk/agent-ui-terminal as of 3.0.0-beta.N"`
   (`N` = that run's version). No unpublish (`NPM-UNPUB`), no shim package, and because `npm
deprecate` is workspace-unaware (`NPM-DEP`) it is run by hand from the release checklist, once.

**Scans that hard-code a retired name, by the unit that fixes them** (measured at `4b03d3248`; each
row is what TC-10 must see green at the end of that unit):

| Harness file                                                | Retired name(s)                                         | Fixed in |
| ----------------------------------------------------------- | ------------------------------------------------------- | -------- |
| `scripts/harness/scan-transport-admission.mjs:62`           | `agent-transport-protocol` (the admission seam)         | S3       |
| `scripts/harness/scan-deployment-matrix.mjs:33`             | `agent-transport-protocol`                              | S3       |
| `scripts/harness/scan-deployment-matrix.mjs:34-35`          | `agent-transport-gui`, `agent-transport-webrtc-web`     | S4 (gui) |
| `scripts/harness/scan-tui-safe-text-boundary.mjs:34`        | `packages/agent-transport-tui/src`                      | S4       |
| `scripts/harness/check-capability-placement.mjs:57,64`      | `@robota-sdk/agent-transport-gui`                       | S4       |
| `scripts/harness/check-agent-server-boundary.mjs:51,64,119` | `@robota-sdk/agent-transport-gui`                       | S4       |
| `scripts/harness/scan-transport-conformance.mjs:41`         | `agent-transport-gui`                                   | S4       |
| `scripts/harness/release-test-suites.mjs:89`                | `packages/agent-transport-tui`                          | S4       |
| `scripts/harness/changed-path-capabilities.mjs:58`          | `@robota-sdk/agent-transport-tui`                       | S4       |
| `scripts/harness/check-sdk-public-surface.mjs:407`          | `'agent-transport-tui': 1` (frozen count keyed by name) | S4       |
| `scripts/harness/scan-guard-scope-fail-closed.mjs:117`      | `tree: 'packages/agent-transport-tui/src'`              | S4       |
| `.agents/harness.config.json:506,509,510`                   | entry-point paths of `-gui`, `-protocol`, `-tui`        | S3 / S4  |
| `.agents/harness.config.json:111-114,135-138` (+ `:24`)     | ARCH-005 `forbiddenDependencyPrefixes` — see below      | S4       |

`apps/remote-signaling` is **not** a consumer: its manifest declares `agent-interface-session` and
`ws` only and no file under it mentions `-protocol`, so it is out of every unit.

**A gate that would narrow silently at S4, and the S4 step that keeps it whole.** The ARCH-005
composition-neutrality entries for `agent-product` and `agent-capability-pack`
(`.agents/harness.config.json:111-114`, `:135-138`) forbid `forbiddenDependencyPrefixes:
["@robota-sdk/agent-transport", "@robota-sdk/agent-interface-tui"]`, and
`scan-composition-neutrality.mjs:70-75` matches them with `startsWith`. After S4,
`@robota-sdk/agent-ui-terminal` and `@robota-sdk/agent-ui-web` match neither prefix, so a product
package could declare a UI dependency and the scan would stay green — "could not check" collapsing
into "checked and fine". S4 therefore adds `"@robota-sdk/agent-ui-"` to both lists in the same
change, updates the `:24` purity reason string (which names `agent-transport-tui, agent-transport-gui`)
to the new names, and lands a fixture red-proof: a fixture `agent-product` manifest declaring
`@robota-sdk/agent-ui-terminal` must produce a finding (TC-13).

**Depth semantics of the rule, stated for `ARCHITECTURE.md`:** the family is the second dash
segment and nothing deeper is a hierarchy — every same-family child at any depth is a sibling of every
other, so `agent-transport-webrtc-web → agent-transport-webrtc` would be red exactly as
`agent-transport-webrtc-web → agent-transport-gui` is; a compound name is a name, not a layer.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료 — 1 parent, 1 assembly package, 1 dissolved package, 5 sibling
      consumers, 1 CLI, 1 app, 1 example, 1 harness gate, 8 routing documents; § Affected Scope
- [x] Sibling scan 완료 — every `agent-<family>-*` family measured with one enumeration; the two
      existing sibling rules (`dag-node-*`, `agent-interface-*`) and the `STRUCT-011` rename procedure
      read; § Sibling scan
- [x] 대안 최소 2개 검토 완료 — seven alternatives, each with Pro and Con; the three refused by owner
      rulings say which ruling
- [x] 결정 근거 문서화 완료 — § Decision states the exact gate rule, the red-proof output, the parent's
      target state module by module, the browser-safety guarantee and the five adversarial cases
- [x] New-surface placement — **reclassification of a product-family boundary** (`spec-workflow.md`
      § New-Surface Architecture Placement): the substrate mirrors the existing `agent-transport`
      parent (ruling 5) and the runtime-host modules mirror `agent-framework`'s existing
      `buildRuntimeSession`/`startRuntimeHost` seam; no new package is created. The independent
      validation (`proposal-reviewer`) is a GATE-APPROVAL input recorded in § Evidence Log, not
      claimed here

## Fallback & Degradation Declaration

**None.** No intentional fallback, graceful degradation or silent `catch → default` is introduced.

Three behaviours could be mistaken for one and are the opposite: (1) a family member with **no**
baseline entry and a sibling edge is refused, not permitted (TC-02); (2) a baseline entry whose edge
is gone is a finding, not ignored (TC-03); (3) a family that resolves to zero members is a finding,
not an empty pass (TC-01). There is no `-protocol` re-export shim at any point: S3 moves and rewires
in one unit, and `checkPassthroughReexports` would refuse one anyway.

## Solution

1. **Gate.** In `scripts/harness/check-dependency-direction.mjs`, add `checkFamilySiblings(packages,
{ baseline, delegated })` beside `checkDagNodesLeaf`, implementing the rule in § Decision exactly;
   register it in the same `main()` and print `::examined:: <n> family member(s)`. Read
   `scripts/harness/family-sibling-baseline.json` (`{ "<from> -> <to>": "<reason>" }`), fail on an
   unlisted edge and on a stale entry. Fixtures: three families, parent edge + sibling edge each, plus the companion clauses and an
   undeclared-import case. Add the `FAMILY-SIBLINGS` identifier to `ARCHITECTURE.md` § Dependency and
   interface rule identifiers — stating the depth semantics above (family = second segment; any-depth
   same-family children are all siblings; compound names are not layers) — and one sentence to
   `.agents/project-structure.md` § Family Decomposition Rule binding the direction to the name
   hierarchy. **Enforced by:** the `deps` scan in `pnpm harness:scan` and
   `pnpm harness:pre-push`.
2. **Parent purification.** `git mv` `packages/agent-transport/src/{headless,programmatic}` (minus
   `print-terminal.ts` and `cli-input.ts`, which go to `packages/agent-cli/src/`) and the four
   registry/settings modules into `packages/agent-framework/src/transport-host/` (a directory, not a
   package); export them from `agent-framework`'s root barrel (ruling 10). Move
   `headless-host-action-parity.test.ts` and `headless-skill-activation.integration.test.ts` to
   `packages/agent-cli/src/__tests__/` (they import `agent-command`; `DEV-CYCLE`). Rewrite
   `agent-cli`'s 8 files and the example. Remove `agent-core` and `agent-framework` from the parent's
   manifest; remove the `./headless` export.
3. **Substrate absorption + consumer rewiring, one unit.** `git mv` the 16 `-protocol` modules and
   their tests into `packages/agent-transport/src/`, `admission.ts` and `handoff-manifest.ts` into
   `src/node/` with a `./node` export carrying `"browser": null`; drop `browser.ts` (its purpose is
   served by the root now being browser-safe). Rename the four `ws-` modules to `wire-messages`,
   `session-message-handler` (`createSessionMessageHandler`, `ISessionMessageHandlerOptions`),
   `session-events`, `background-messages` (ruling 8). Add the six `agent-interface-*` dependencies
   to the parent; delete the parent's `-protocol` `devDependency`; move
   `ws-multi-surface-exit-policy.test.ts` to the `agent-cli` suite. Rewrite the consumers' imports and
   manifests (`-ws`, `-http`, `-webrtc`, `-gui`, `-webrtc-web`, `agent-cli`) and the S3 rows of the
   scans table; remove the five `-protocol` baseline entries. No shim of any kind.
4. **`-webrtc-web → -gui`** stays in the baseline until S4 removes it by the rename.
5. **The `agent-ui-*` family** (ruling 9) with `STRUCT-011`'s procedure: `git mv` both directories
   (`agent-ui-web`, `agent-ui-terminal`), rewrite live references only (64 + 110 files, the routing
   rows enumerated in § Decision S4, the `ci.yml` filter line), historical records untouched,
   `package.json` name + description in the same change; add the `agent-ui-*/` row to
   `.agents/project-structure.md` and the family to `ARCHITECTURE.md`'s box.
6. **Removal.** Delete `packages/agent-transport-protocol`, its rows in `README.md:146`,
   `.agents/publish-registry.md:53`, `.agents/harness.config.json:509`, the diagram and guide lines;
   delete the baseline file when it is empty. Carry the two `npm deprecate` commands from § Decision
   S5 into the release checklist the owner runs (ruling 11).

## Affected Files

| File                                                                                                                                                                                                                                        | Change                                                                                                                                         |
| ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `scripts/harness/check-dependency-direction.mjs`                                                                                                                                                                                            | `checkFamilySiblings`; generalised from the `dag-node-*` clause                                                                                |
| `scripts/harness/__tests__/check-dependency-direction.test.mjs`                                                                                                                                                                             | fixture cases for two families                                                                                                                 |
| `scripts/harness/family-sibling-baseline.json`                                                                                                                                                                                              | new (7 entries) → empty → deleted                                                                                                              |
| `packages/agent-transport/package.json`, `src/index.ts`, `src/node/`                                                                                                                                                                        | purified manifest; substrate root; `./node` subpath                                                                                            |
| `packages/agent-transport/src/{headless,programmatic,transport-*}`                                                                                                                                                                          | moved to `packages/agent-framework/src/transport-host/`; `print-terminal.ts`, `cli-input.ts` to `packages/agent-cli/src/`                      |
| `packages/agent-framework/src/index.ts`, `package.json`                                                                                                                                                                                     | exports the runtime-host modules                                                                                                               |
| `packages/agent-transport-protocol/**`                                                                                                                                                                                                      | 16 modules moved out and consumers rewired in one unit (no shim); then deleted (104 live references)                                           |
| `packages/agent-transport-{ws,http,webrtc,gui,webrtc-web}/**`                                                                                                                                                                               | import `@robota-sdk/agent-transport`; manifests                                                                                                |
| `packages/agent-cli/src/**` (8 files + 5 handoff/remote files)                                                                                                                                                                              | framework for host symbols; parent for substrate symbols; receives `print-terminal.ts`, `cli-input.ts` and the three framework-composing tests |
| `examples/capabilities/multi-surface-deploy`                                                                                                                                                                                                | `TransportRegistry` from `agent-framework`                                                                                                     |
| the ten harness files in § Decision's scans table                                                                                                                                                                                           | retired names replaced in the unit the table names                                                                                             |
| `packages/agent-transport-gui/**` + 64 live files                                                                                                                                                                                           | `git mv` → `packages/agent-ui-web`; `@robota-sdk/agent-ui-web` (ruling 9)                                                                      |
| `packages/agent-transport-tui/**` + 110 live files                                                                                                                                                                                          | `git mv` → `packages/agent-ui-terminal`; `@robota-sdk/agent-ui-terminal` (ruling 9); `ci.yml:1322,1326`                                        |
| `.agents/project-structure.md`, `ARCHITECTURE.md`, `.agents/publish-registry.md`, `README.md`, `content/guide/architecture.md`, `diagrams/robota-architecture.mmd`, `.agents/harness.config.json`, `packages/agent-transport*/docs/SPEC.md` | routing/identity updates                                                                                                                       |

## Completion Criteria

- [ ] TC-01: `pnpm exec vitest run scripts/harness/__tests__/check-dependency-direction.test.mjs` → exits 0 asserting, on a fixture with `agent-transport-ws → agent-transport`, `agent-transport-webrtc → agent-transport-ws`, `agent-session-analytics → agent-session`, `agent-session-replay → agent-session-analytics`, `agent-transport-ws → agent-framework`, that exactly the two sibling edges are reported, the two parent edges and the child → `agent-framework` edge are not (ruling 7), and that a family resolving to zero members is a finding; exits 1 if a parent or framework edge is reported or the zero-member case passes
- [ ] TC-02: at S1, `node scripts/harness/check-dependency-direction.mjs` → exits 0 and prints `::examined::` with the family-member count; after deleting any one entry from `scripts/harness/family-sibling-baseline.json` the same command → exits 1 naming that edge (red-proof: the prototype output in § Decision names all seven on `4b03d3248`)
- [ ] TC-03: with an entry added to the baseline whose edge does not exist in the tree, `node scripts/harness/check-dependency-direction.mjs` → exits 1 naming the stale entry
- [ ] TC-04: `node scripts/harness/check-dependency-direction.mjs 2>&1 | grep -c "Interface-package violation"` → prints the same number before and after S1 (the four `agent-interface-*` edges are judged by `INTERFACE-DEPS` only, once)
- [ ] TC-05: `node -e "const d=Object.keys(require('./packages/agent-transport/package.json').dependencies);process.exit(d.every(k=>k.startsWith('@robota-sdk/agent-interface-'))?0:1)"` → exits 0 (prints nothing), and `git grep -l -E "@robota-sdk/(agent-core|agent-framework)" -- packages/agent-transport/src ':!packages/agent-transport/src/__tests__'` → prints nothing
- [ ] TC-06: `git grep -l "from 'node:" -- packages/agent-transport/src ':!packages/agent-transport/src/node/' ':!packages/agent-transport/src/__tests__'` → prints nothing; `grep -c "./node/" packages/agent-transport/src/index.ts` → prints `0`; `node -e "const e=require('./packages/agent-transport/package.json').exports['./node'];process.exit(e&&e.browser===null?0:1)"` → exits 0 (the `CORE-028` shape); `node scripts/harness/scan-browser-package-node-subpath.mjs` → exits 0; and at S5 `test -d packages/agent-transport-protocol` → exits 1 and `git grep -l "agent-transport-protocol" | grep -vE "^\.agents/(tasks/completed|spec-docs/done|spec-docs/rejected|archive)/|^\.changeset/|^\.design/|^CHANGELOG\.md$" | wc -l` → prints `0`
- [ ] TC-07: at S5, `test -f scripts/harness/family-sibling-baseline.json` → exits 1 and `node scripts/harness/check-dependency-direction.mjs` → exits 0 with zero family-sibling findings
- [ ] TC-08: `git grep -l "agent-transport-gui" | grep -vE "^\.agents/(tasks/completed|spec-docs/done|spec-docs/rejected|archive)/|^\.changeset/|^\.design/|^CHANGELOG\.md$" | wc -l` → prints `0`, while the unfiltered count still prints the historical `38`; the same pair for `agent-transport-tui` → `0` / historical `158`; and `test -d packages/agent-ui-web -a -d packages/agent-ui-terminal` → exits 0
- [ ] TC-09: `pnpm --filter @robota-sdk/agent-cli --filter @robota-sdk/agent-transport --filter @robota-sdk/agent-framework --filter "@robota-sdk/agent-transport-*" test` → exits 0 at the end of every unit S1–S5
- [ ] TC-10: `pnpm harness:verify-like-ci` → exits 0 at the end of every unit S1–S5, including `ghost-package-refs`, `workspace-refs`, `publish`, `capability-placement`, `arch-map-paths`, and — per the scans table in § Decision — each scan listed for that unit (`scan-transport-admission`, `scan-deployment-matrix` at S3; `scan-tui-safe-text-boundary`, `check-capability-placement`, `check-agent-server-boundary`, `scan-transport-conformance`, `release-test-suites`, `changed-path-capabilities`, `check-sdk-public-surface`, `scan-guard-scope-fail-closed`, `scan-composition-neutrality` at S4)
- [ ] TC-11: `pnpm exec vitest run scripts/harness/__tests__/check-dependency-direction.test.mjs` → exits 0 asserting that a fixture `agent-transport → agent-transport-ws` (parent depending on a child) is reported, and that a fixture `agent-framework → agent-transport-ws` and `agent-core → agent-ui-web` are each reported (composer/core never import a transport or UI child); and `node scripts/harness/check-dependency-direction.mjs` → exits 0 on the real tree for both clauses at S1 (both are green today)
- [ ] TC-12: `node scripts/harness/check-dependency-direction.mjs` → exits 1 on a fixture whose `src/` imports `@robota-sdk/agent-transport` while its `package.json` declares no such dependency, naming the undeclared specifier; and on the real tree at S3 → exits 0, where "undeclared" means absent from **all three** of `dependencies`, `peerDependencies` and `devDependencies` (the complement `check-dep-kind.mjs:131` hands to the `deps` scan), so a type-only import satisfied by a `devDependency` is not a false positive
- [ ] TC-13: `pnpm exec vitest run scripts/harness/__tests__/scan-composition-neutrality.test.mjs` → exits 0 asserting that a fixture `@robota-sdk/agent-product` manifest declaring `@robota-sdk/agent-ui-terminal` (and one declaring `@robota-sdk/agent-ui-web`) yields a `findForbiddenDependencies` finding under the S4 policy and none under the pre-S4 policy (the red-proof of the silent narrowing); and `node -e "const c=require('./.agents/harness.config.json');const rules=JSON.stringify(c);process.exit(rules.split('\"@robota-sdk/agent-ui-\"').length>=3&&!/agent-transport-(tui|gui)/.test(c.purity?.map(r=>r.reason).join(''))?0:1)"` → exits 0 (both prefix lists carry `@robota-sdk/agent-ui-` and the `:24` reason no longer names the retired packages)

## Test Plan

Derived from `type: INFRA` with tags `typescript`, `cli`. The gate is tested as a contract over
synthetic package maps (the shape `check-dependency-direction.test.mjs` already uses); everything
else is a command-form check over the real tree.

| TC-ID | Test Type                         | Tool / Approach                                                                           | Notes                                                                                                                                                                   |
| ----- | --------------------------------- | ----------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Contract (fixture, 2 families)    | `pnpm exec vitest run` on `checkFamilySiblings` over synthetic maps                       | The parent-legal arm is the `DC-RULES` defect the rule must not have; zero-member arm closes the silent pass                                                            |
| TC-02 | Scan (red-proof)                  | `check-dependency-direction.mjs` on the tree, then with one entry removed                 | The prototype run in § Decision is the pre-implementation red-proof                                                                                                     |
| TC-03 | Scan (stale baseline)             | `check-dependency-direction.mjs` with a planted stale entry                               | A baseline that outlives its violation has stopped guarding                                                                                                             |
| TC-04 | Regression (delegation)           | `grep -c` over the scan's output before/after S1                                          | The interface family is judged once, by the map                                                                                                                         |
| TC-05 | Command (manifest purity)         | `node -e` over `package.json` + `git grep`                                                | Stays in the tree after this item as the parent's standing invariant                                                                                                    |
| TC-06 | Command (browser safety, removal) | `git grep`, `grep -c`, `test -d`                                                          | The `node:` builtins are reachable only through `./node`; the published package directory is gone                                                                       |
| TC-07 | Command (baseline retired)        | `test -f` + the scan's exit code                                                          | Zero findings with no baseline file is the only green end state                                                                                                         |
| TC-08 | Command (rename completeness)     | `git grep` with the historical-record exclusion                                           | Mirrors `STRUCT-011`'s own verification                                                                                                                                 |
| TC-09 | Suite                             | `pnpm --filter … test`                                                                    | Capability preservation for `agent-cli` headless/print paths and every transport                                                                                        |
| TC-10 | Suite                             | `pnpm harness:verify-like-ci`                                                             | The repository's full pre-merge gate, per unit                                                                                                                          |
| TC-11 | Contract (companion clauses)      | `pnpm exec vitest run` on fixtures + the scan on the tree                                 | Root never imports a child; `agent-framework`/`agent-core` never import a transport or UI child (Axis 5, 10/10)                                                         |
| TC-12 | Scan (undeclared import)          | `check-dependency-direction.mjs` on a fixture with an undeclared `src/` import + the tree | Undeclared = in none of the three manifest sections (`check-dep-kind.mjs:131`); the Turborepo-Boundaries hygiene check that keeps the manifest rule from being bypassed |
| TC-13 | Scan (red-proof, renamed prefix)  | `scan-composition-neutrality.mjs` fixture + `node -e` over `harness.config.json`          | The ARCH-005 gate must still see the UI family under its new name; a `startsWith` list is only as wide as its literals                                                  |

## User Execution Test Scenarios

Not applicable.

**Reason:** No end user can observe a package rename, a moved module, or a dependency-direction rule
through any runnable surface; the CLI, the terminal UI and the browser monitor present the same
sessions, the same messages and the same commands before and after this item, and the only thing
that changes for a person is which package name they type in an import statement.

## Out of scope — separate root items, labelled not absorbed

Recorded, not absorbed (`finding-depth.md`):

- `agent-provider-openai → agent-provider-openai-compatible` — the same defect class in the provider
  family (a lower layer wearing a sibling name); frozen in the S1 baseline with its own root item to
  be filed, since ruling 5's "absorb into the parent" has no parent to absorb into there (there is no
  bare `agent-provider` package).
- `agent-tool-defaults` — carries the naming class ruling 3 refuses; `STRUCT-011`'s completed record
  already names it as "the sibling item … which carries the identical defect".
- WebCrypto rewrite of `admission.ts` / `handoff-manifest.ts` to make the parent isomorphic without a
  subpath — a change to `SEC-008` admission, not a naming change.
- `agent-transport-webrtc-web` — after S4 the one remaining member whose family and dependencies
  contradict: a UI-family package by content (React components + hooks; deps `agent-ui-web` +
  `agent-remote-pairing`; no edge to `-webrtc`) under a transport name. Filed as its own root item,
  `.agents/tasks/STRUCT-013-agent-transport-webrtc-web-is-a-ui-family-member-under-a-transport-name.md`,
  which also carries two related facts as scope candidates (`-gui`/`-webrtc-web` declare no `browser`
  export condition, so `CORE-028` cannot refuse an `@robota-sdk/agent-transport/node` import from
  them; `agent-interface-tui` is a contract package carrying the old family word). The name is that
  item's USER-DECISION.

## USER-DECISION

None. Every decision this item needed from the owner was made on 2026-09-05 and is recorded verbatim
in § Disposition (rulings 1–11) and fixed in § Decision: the module placement (ruling 8), the
`agent-ui-web` / `agent-ui-terminal` names and "both now" (ruling 9), the `agent-framework`
`src/transport-host/` root-barrel shape and the registry leaving the parent (ruling 10), and the
deprecate-with-pointer release step at the successor's release (ruling 11). What the pipeline still
requires is GATE-APPROVAL on this document as the plan.

## Tasks

- [ ] `.agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md` — todo

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-05

**Status upgrade:** draft → review-ready

- GATE-WRITE — File begins with `---` YAML frontmatter block: file begins with a `---` frontmatter block
- GATE-WRITE — `status: draft` present in frontmatter: `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: `type: INFRA` is one of 11 allowed values
- GATE-WRITE — `tags:` field present in frontmatter (may be empty array `[]`): `tags:` present (2 value(s))
- GATE-WRITE — Contains a concrete symptom (specific command, output, or behavior that is wrong): § Problem quotes the enumeration output naming the six `agent-transport-*` sibling edges (five → `-protocol`, `-webrtc-web → -gui`), the `grep -n "from './ws-"` output showing the four `ws-` modules' non-WebSocket dependents, and a module-by-module coupling table of `packages/agent-transport/src` (three `node:` builtins, two `agent-framework` value imports). The `scratch/sibling-edges.mjs` / `sibling-gate-proto.mjs` scripts are not in the tree, so the guard re-measured from manifests at HEAD `4b03d3248`: exactly the same six edges over `dependencies`+`peerDependencies`; the same three `node:` imports (`headless/HeadlessInteractionChannel.ts:8`, `headless/print-terminal.ts:9`, `headless/headless-stream-json.ts:1`); the parent's manifest depends on `agent-core` + `agent-framework` and carries `-protocol` only as a `devDependency`; `-protocol` depends on six `agent-interface-*` packages and no transport package — all as stated
- GATE-WRITE — Contains a reproduction condition (when/where it occurs): measured on `develop` at `4b03d3248` (2026-09-05) over every workspace manifest, enumerated with `readdirSync` over `packages/` + `apps/`; the gap is located at `scripts/harness/check-dependency-direction.mjs` — `checkDagNodesLeaf` (`:303-330`) and `checkInterfacePackageDeps` (`:248-289`) are the only family rules, so the six edges are never red under `pnpm harness:scan`; guard confirmed at HEAD those are the only two family checks registered (`:608-609`) and no `agent-transport` rule exists
- GATE-WRITE — Does not contain "TBD", "TODO", or vague single-sentence descriptions: `## Problem` has no TBD/TODO; 15864 chars, 32 sentences
- GATE-WRITE — `## Prior Art Research` (or `## Research`) section present: `## Prior Art Research` section present
- GATE-WRITE — Section is substantiated: cites ≥1 documentation source (product/API/design doc, release notes, protocol spec): `scan-spec-research` reports the section substantiated or explicitly waived
- GATE-WRITE — OR an explicit `Waived: <reason>` line is present: `scan-spec-research` reports the section substantiated or explicitly waived (not waived — 5 axes, tagged sources table)
- GATE-WRITE — Research findings feed `Alternatives Considered` / `Decision` (evidence-based recommendation, not asserted): Alternative 3 is refused on `scan-interface-runtime.mjs` (`.agents/project-structure.md:306-311`); Alternatives 4 and 5 are refused on `VITE-TS` (a `node:` builtin at the root barrel is not tree-shaken); § Decision's gate shape cites `PA-DC` `$1` capture and `PA-JSB` `captured.family` negation, its undeclared-import companion cites `PA-TURBO`, companion clause (v) is derived from Axis 5 observed 9 (10/10 "framework never depends on a child"), the root-subpath substrate from observed 8 (tRPC `./shared`, Connect `./protocol*`, Hono `./adapter`), the `./node` subpath from `NODE-SUB` / observed 11, the `agent-ui-*` name from `NX-PDR` `ui-*`, and the S5 deprecation recipe from `NPM-DEP`/`NPM-DEPDOC`/`NPM-UNPUB`; § Constraints maps each adoption to the decision that uses it
- GATE-WRITE — All 4 checklist items are `[x]`: 5/5 checklist items `[x]`
- GATE-WRITE — Sibling scan item is `[x]` with either completion evidence or explicit `N/A: <reason>`: Sibling scan `[x]` with completion evidence
- GATE-WRITE — Alternatives Considered has at least 2 entries with pro/con for each: 7 numbered alternatives, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: Alternative 1 is chosen with its cost stated as "the largest option — 104 + 44 + 64 + 110 live files, one published package removed and one published package renamed, `agent-framework`'s surface grows" in exchange for a gate that "costs no declaration and cannot drift from one"; § Decision restates it ("Honest size: ~104 live files in one change — the same order as `STRUCT-011`'s 63"; S3 cannot be split because `checkPassthroughReexports` refuses a shim) and names why each cheaper option is refused and by which ruling or scan (2: ruling 2; 3: `scan-interface-runtime` — "passes only by disabling a gate"; 4/5: ruling 6 + `VITE-TS`; 6: ruling 5; 7: rulings 1–6)
- GATE-WRITE — **New-surface placement (conditional):** APPLICABLE — the spec reclassifies the family boundary (`-protocol` dissolved into the parent; runtime-host modules leave the parent for `agent-framework`; a new `agent-ui-*` family is created from the two renamed presentation packages). (a) Analog + classification stated: the substrate mirrors the existing `agent-transport` parent (ruling 5; Axis 5 "root = contract + runtime-neutral shared logic", 10/10); the runtime-host modules mirror `agent-framework`'s existing `buildRuntimeSession`/`startRuntimeHost` "Runtime host" seam (`ARCHITECTURE.md:41-42`) as `src/transport-host/`; `print-terminal`/`cli-input` go to `agent-cli` per `.agents/project-structure.md` § Implementation Owner Boundaries; the `./node` subpath with `"browser": null` mirrors `agent-core`'s own `./node` (`CORE-028`); `agent-ui-*` is classified as the UI/host layer (`@ai-sdk/react → ai` shape, `NX-PDR` `ui-*`) with "no existing family reads as its sibling", under the sibling rule from its first member. (b) Contract-level reuse shown: the parent's target `dependencies` = exactly the six `agent-interface-*` contract packages; protocol transports depend on root + `agent-interface-*`; hosts may depend on `agent-framework` (the composer) and never on a sibling; the one cross-family edge `-webrtc-web → agent-ui-web` is pre-existing, named, classified as a layer (`connect-fastify → connect-node` shape) and filed as STRUCT-013 rather than hidden. Checklist item 5 is `[x]` naming the analogs. Observation, not a finding: the checklist phrase "no new package is created" is loose (S4 creates `packages/agent-ui-web` and `packages/agent-ui-terminal` by `git mv`); the placement content stands regardless. The independent `proposal-reviewer` validation is not yet in this log — that is GATE-APPROVAL's conditional criterion, not this gate's
- GATE-WRITE — Every item has a `TC-N` prefix (TC-01, TC-02, …): 13 criteria, all `TC-NN:` prefixed
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: S1 gate + baseline → TC-01/02/03/04/11/12; S2 parent purification → TC-05/09; S3 substrate absorption + browser safety of `./node` → TC-06/12; S4 `agent-ui-*` rename + ARCH-005 prefix widening → TC-08/13; S5 removal + baseline retirement → TC-06/07; harness scans per unit (the scans table) → TC-10; package suites per unit → TC-09. The `npm deprecate` release step is declared a manual owner checklist item, not a plan item, and carries no TC by design
- GATE-WRITE — Each criterion uses Command form or Observable behavior form (no vague language): all 13 are `<command> → exits N / prints X` with the exact command quoted (TC-01..TC-13); TC-04's "prints the same number before and after S1" and TC-09/TC-10's "exits 0 at the end of every unit S1–S5" are observable exit/print conditions; no vague language found
- GATE-WRITE — No criterion uses: "works correctly", "no errors", "implemented", "displays correctly": none of "works correctly", "no errors", "implemented", "displays correctly" appears
- GATE-WRITE — `## Test Plan` section present: `## Test Plan` present
- GATE-WRITE — One row exists for each TC-N in Completion Criteria (count must match): 13 Test Plan rows = 13 TC criteria
- GATE-WRITE — Each row has a non-empty Test Type and Tool/Approach (no "TBD"): 13 rows with Test Type and Tool, no TBD
- GATE-WRITE — Rows where Tool is "manual" have a non-empty Notes entry explaining why automated test is not possible: 0 manual row(s)
- GATE-WRITE — Tasks section present with placeholder: `## Tasks` present
- GATE-WRITE — Evidence Log section present and empty (first GATE-WRITE run): `## Evidence Log` present with 0 prior entries (none from a later gate)
- GATE-WRITE — No `## Status` or `## Classification` sections in the body: no `## Status` / `## Classification` body sections

Sections checked: Frontmatter, Problem, Prior Art Research, Architecture Review (Sibling scan, Alternatives, Decision, Checklist), Completion Criteria, Test Plan, Structure — all PASS. TC-N count matches: 13 Completion Criteria = 13 Test Plan rows. Mechanical set: `node scripts/harness/gate.mjs judge --gate GATE-WRITE --lane L2` — 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN; the 7 semantic criteria judged by `backlog-gate-guard` above.

**Judged at:** HEAD `4b03d3248389` · base `origin/develop@4b03d3248389` · document `.agents/spec-docs/draft/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md` blob `af5f2c2dbd0c` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-05

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "현재 더이상 이방향으로 처리하지 말고 파운데이셔널 이슈로 로컬에 새로 생성하고 리팩터링 진행하세요"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** c0cf8959f530 (review 5b71c305, type/tags 277d9834)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c0cf8959f530) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the recorded instruction "현재 더이상 이방향으로 처리하지 말고 파운데이셔널 이슈로 로컬에 새로 생성하고 리팩터링 진행하세요" is an imperative in the catalogue's "진행해" form ("리팩터링 진행하세요"), names this item by role — the local foundational item this document identifies itself as at `:11` and in § Approval Authority, replacing the abandoned `INFRA-158` direction (ruling 4) — and authorizes the refactor this document plans. It is not an answer to a clarifying question, not silence, and not approval of another item. Every design ruling quoted in § Disposition (1–11) is an owner utterance, and the owner's answers to this document's own decision questions D1/D2/D5 — each the "(Recommended)" option, fixed as rulings 8/9/11 — are addressed to this document specifically. Observation, not a finding: the instruction pre-dates the document's text and the D1/D2/D5 answers are not quoted in this entry (the `--evidence` note was dropped — see the validation criterion below); the guard relies on the caller's statement of this conversation for them, and the verbatim instruction alone is direct and unambiguous
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry argues for: N/A — route is `DIRECT`; no `**Class:**` field is present and no registered class is cited, so there is no class boundary to evaluate. Noted for the record: neither registered class could cover this item — § Approval Authority states it removes/renames published packages (exclusion 2, a published contract) and adds a repository-wide dependency gate (exclusion 3), and the lane is L2
- GATE-APPROVAL — **Independent architecture validation (conditional):** FAIL — APPLICABLE: the spec introduces a new package family (`agent-ui-*`: S4 creates `packages/agent-ui-web` and `packages/agent-ui-terminal`), dissolves `agent-transport-protocol` into the parent, and reclassifies the runtime-host modules into `agent-framework/src/transport-host/` — a new surface and a product-family boundary reclassification, as the GATE-WRITE line above and checklist item 5 both state. Required: the Evidence Log MUST contain an independent `proposal-reviewer` verdict that ENDORSED the recommendation and explicitly covered the placement, and an `architecture-audit-fanout` structure-channel result retained for the new surface. Observed: the Evidence Log contains no `proposal-reviewer` verdict — `grep -n -i "proposal-reviewer\|ENDORSE\|Placement verdict"` over this document hits only `:824` (checklist item 5, which asserts the validation is "recorded in § Evidence Log"; it is not) and `:1000` (the GATE-WRITE line stating it "is not yet in this log"); no `architecture-audit-fanout` result is recorded either. Cause, verified: `scripts/harness/gate.mjs approve` appends `--evidence` only inside `if (route === 'CLASS')` (`gate.mjs:2391-2392`); on route DIRECT the note is discarded with no message, so the reviewer's three-pass record (v2 REVISE a–g applied, v3 REVISE three conditions applied, v4 ENDORSE) and its placement-coverage statement ("Placement verdict: all seven ENDORSED. REVIEW VERDICT: ENDORSE") exist only in the orchestrator's scratchpad note, not in this document. A verdict not in the log is a bare claim, which this criterion names as insufficient. Required instead: the independent review recorded in the Evidence Log itself — the reviewer, date, the seven placements it covered and its verdict, quoted, not summarised — plus the fanout structure-channel result; then re-run this gate
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation started before this gate): not triggered — HEAD `4b03d3248389` equals `origin/develop`, `git log origin/develop..HEAD` is empty, the tracked diff is empty, the working tree carries only this spec, its paired Task, the STRUCT-013 Task and the two lessons files, and `packages/` has no `agent-ui-*` directory

Guardian semantic set (`backlog-gate-guard`, 2026-09-05): 1 PASS, 1 N/A, 1 FAIL — gate verdict **FAIL** on the independent-architecture-validation criterion. The heading's `✅ PASS`, written by `gate.mjs approve` for the mechanical set (5/5), is corrected to `❌ FAIL` so the entry reads as the gate's outcome; the `**Status upgrade:**`, `**Review fingerprint:**` and `**Judged at:**` lines are left exactly as written and no status change follows from this entry.

**Judged at:** HEAD `4b03d3248389` · base `origin/develop@4b03d3248389` · document `.agents/spec-docs/backlog/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md` blob `98b9f28c54d3` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-05

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "현재 더이상 이방향으로 처리하지 말고 파운데이셔널 이슈로 로컬에 새로 생성하고 리팩터링 진행하세요"
**Given:** 2026-09-05, this conversation
**Review fingerprint:** c0cf8959f530 (review 5b71c305, type/tags 277d9834)

**Independent architecture validation:** `proposal-reviewer` (independent, read-only), three passes in this conversation on 2026-09-05 against HEAD `4b03d3248`: v2 → REVISE (amendments a–g: S3+S4 merged with no shim because `checkPassthroughReexports` refuses one; `print-terminal.ts`/`cli-input.ts` to `agent-cli`; the three `agent-command`-composing tests to `agent-cli`'s suite (DEV-CYCLE); `./node` with `"browser": null`; TC-12 "undeclared" = absent from all three manifest sections; two-segment depth semantics; `apps/remote-signaling` dropped and the retired-name scans enumerated per unit; `STRUCT-013` filed) — applied; v3 → REVISE (narrow: `STRUCT-013` on disk, ARCH-005 `forbiddenDependencyPrefixes` widened to `@robota-sdk/agent-ui-` with a red-proof TC-13, three contradicting sentences aligned) — applied; v4 → **ENDORSE**. Final placement-coverage statement, quoted: "This review covered the placement of: (1) the new `agent-ui-*` family (`agent-ui-web`, `agent-ui-terminal`) as UI hosts above `agent-framework`, mirroring the existing product-shell tier and the `@ai-sdk/react → ai` shape, reusing the shared substrate `agent-transport` at the contract/core level rather than a sibling product; (2) `agent-transport` reclassified as the family's pure substrate (`agent-interface-*` only) with `agent-transport-protocol` dissolved into it in one unit; (3) the `./node` subpath declared `"browser": null`, mirroring `@robota-sdk/agent-core/node` (CORE-028); (4) the four ex-`ws-*` modules in the parent under dependency-derived names; (5) the runtime-host modules in `agent-framework/src/transport-host/` (mirroring the existing `runtime-host.ts` seam) with `print-terminal.ts` / `cli-input.ts` in `agent-cli`, the tier that owns prompt intake and rendering; (6) the `FAMILY-SIBLINGS` gate as a name-capture rule with two-segment depth semantics, companion clauses (iv)/(v), and the undeclared-import check as the exact complement `check-dep-kind.mjs:131` hands to the `deps` scan; (7) the S1–S5 sequence, each unit green under the existing `RE-EXPORT`, `DEV-CYCLE`, and ARCH-005 rules, and the seven-edge shrink-only freeze. Placement verdict: all seven ENDORSED. … REVIEW VERDICT: ENDORSE".
**Owner decisions addressed to this document (AskUserQuestion, 2026-09-05, verbatim selections):** D1 "부모에 두고 의존 기준으로 개명 (Recommended)"; D2 "agent-ui-web / agent-ui-terminal, 둘 다 지금 (Recommended)"; D5 "후속 배포 시점에 deprecate + 포인터 (Recommended)". Owner design rulings quoted in § Disposition were uttered in this conversation: "패키지 이름을 계층적으로 구성한 이유는 이렇게 쉽게 위반사항을 검출하기 위한 것입니다"; "agent-transport-xxx가 참고하려면 agent-transport를 참고해야 합니다"; "agent-transport 는 framework같은거 품지말고 순수할수록 좋다."; "agent-transport-* 는 내부적으로 framework를 참조할 수 있지. agent-transport는 순수하면 좋다. 그리고 어차피 트리쉐이킹 한다."

**Structure-channel result (`arch-audit-structure`, independent, read-only, 2026-09-05, HEAD `4b03d3248`):** worklist 6 placements × 4 criteria = 24 cells, 23 covered; verdict on placement, quoted: "소유자 결정 하의 6개 배치는 기존 의존 방향 규칙·패키지 경계·공개 표면과 **구조적으로 충돌하지 않으며**, 7건 베이스라인·companion clause·`./node` 형태·부모 순수화 전제는 매니페스트와 소스로 재현된다." Re-derived from 92 manifests: exactly 11 same-family prod edges = interface 4 (ARCH-101 delegated) + provider 1 + transport 6, matching § Decision; `agent-framework`/`agent-core` carry 0 `agent-transport-*`/`agent-ui-*` edges in any section; 0 parent→child prod edges. `STRUCTURE CHANNEL: FINDINGS 9` (high 0, medium 3, low 6) — all nine are plan-completeness obligations on units, none is a placement conflict; each is carried as a sub-item of the unit that honours it in the Task's `## Plan` (`.agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`): S1 ← ST-4 (write clause (v) in `ARCHITECTURE.md` with bare `agent-ui-*`, not `@robota-sdk/agent-ui-*`, so `PACKAGE-NAME` does not cut a nonexistent token before S4), ST-9 (state the judged scope — `dependencies`+`peerDependencies` — in the `FAMILY-SIBLINGS` sentence); S2 ← ST-1 (add `packages/agent-framework/src/transport-host` to `scan-transport-conformance`'s target set + `transport-conformance.tsconfig.json` include and `scan-deployment-matrix`'s walk, keeping the `headless` subject/row), ST-2 (add `createHeadlessTransport`, `HeadlessInteractionChannel`, `createProgrammaticAgent`, `TransportRegistry`, `createFileTransportSettingsRepository` to ARCH-005 `forbiddenIdentifiers` for `agent-product`/`agent-capability-pack` with a fixture red-proof), ST-3 (re-freeze `check-sdk-public-surface` `agent-transport` count, move the three `no-fallback-swallow-baseline.json` keys and the `file-size-baseline.json` `transport-registry.ts` entry to the new paths, delete the two barrels `scan-public-project-authority` names), ST-5 (move the seven relative-import tests under `packages/agent-transport/src/__tests__/` with the code), ST-8 (Affected Files: `project-structure.md:286,325`, `content/guide/{sdk,cli,architecture}.md`, `packages/agent-cli/docs/SPEC.md`, `packages/agent-interface-transport/docs/SPEC.md`, `packages/agent-transport/README.md`, `.agents/specs/deployment-matrix.md:29`; `check-doc-examples.mjs:136` mapping for `./node`); S3 ← ST-6 (drop dead devDependencies `agent-transport-tui → agent-transport` and `agent-transport → agent-command` with the `-protocol` one), ST-7 (the undeclared-import check parses import declarations only — `^import` anchor per `check-dep-kind.mjs:51-52` — never JSDoc or template strings; TC-12 is read with that condition). S4 ← ST-3 (`scan-public-project-authority` `-tui` scope). Uncovered cell: whether `createWsHandler`/`ws-*` symbol names are hardcoded under `scripts/harness`/CI — measured at S3 by TC-08's unfiltered `git grep`.

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-05, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (c0cf8959f530) equals the document's current fingerprint
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS — the recorded `**Instruction (verbatim):**` "현재 더이상 이방향으로 처리하지 말고 파운데이셔널 이슈로 로컬에 새로 생성하고 리팩터링 진행하세요" is an imperative in the catalogue's "진행해" form ("리팩터링 진행하세요"); it directs the creation of exactly this item — the local foundational item this document identifies itself as at `:11` and in § Approval Authority, replacing the abandoned `INFRA-158` direction (§ Disposition ruling 4) — and authorizes the refactor this document plans. It is not an answer to a clarifying question, not silence, and not approval of another item. The design as written is confirmed by the owner to this document specifically: the three decision questions the document put to the owner (D1 module placement, D2 `agent-ui-*` names, D5 release step) carry verbatim selections in this entry ("부모에 두고 의존 기준으로 개명 (Recommended)", "agent-ui-web / agent-ui-terminal, 둘 다 지금 (Recommended)", "후속 배포 시점에 deprecate + 포인터 (Recommended)"), fixed as rulings 8/9/11, and § USER-DECISION is empty as a result. Verified where the guard can: the instruction text equals the orchestrator's instruction record byte-for-byte (`scratchpad/struct012-instruction.txt`), and the D1/D2/D5 selections and the four design rulings quoted in this entry equal the orchestrator's evidence note written before this entry (`scratchpad/struct012-evidence.txt`, 11:31). Observation, not a finding: the instruction pre-dates the document's text; what makes the approval address this document is the instruction naming the item to create plus the owner's design selections on the document's own questions — the guard cannot read the conversation itself and relies on the caller's statement and the two consistent records for the fact that they were given in this conversation on 2026-09-05
- GATE-APPROVAL — The item is inside the class as the registry defines it — a boundary the guard evaluates, not one the entry argues for: N/A — `**Approval route:**` is `DIRECT`; no `**Class:**` field is present and no registered class is cited, so there is no class boundary to evaluate. For the record, neither registered class could cover it: `LANE-L0-L1` — the lane is L2 (`lane: L2` in frontmatter); `BACKLOG-ZERO-MIGRATION` — this is a package-source refactor, which that row excludes; and § Approval Authority states it removes/renames published packages (exclusion 2) and adds a repository-wide dependency gate (exclusion 3)
- GATE-APPROVAL — **Independent architecture validation (conditional):** PASS — APPLICABLE: the spec creates a new package family (`agent-ui-*`: S4 creates `packages/agent-ui-web` and `packages/agent-ui-terminal`), dissolves `agent-transport-protocol` into the parent, and reclassifies the runtime-host modules into `agent-framework/src/transport-host/` — a new surface and a product-family boundary reclassification. Required: the Evidence Log MUST contain an independent `proposal-reviewer` verdict that ENDORSED the recommendation and explicitly covered the placement, plus an `architecture-audit-fanout` structure-channel result retained for the new surface. Observed in this entry: (a) `**Independent architecture validation:**` names the reviewer (`proposal-reviewer`, independent, read-only), the date (2026-09-05), the HEAD reviewed (`4b03d3248`), the three-pass history (v2 REVISE a–g applied; v3 REVISE three conditions applied; v4 **ENDORSE**), and quotes the placement-coverage statement enumerating seven placements — the quoted statement itself performs the two checks `spec-workflow.md` § New-Surface Architecture Placement (3) requires: (1) the mirrored analog ("as UI hosts above `agent-framework`, mirroring the existing product-shell tier and the `@ai-sdk/react → ai` shape"; `agent-framework/src/transport-host/` "mirroring the existing `runtime-host.ts` seam"; `./node` "mirroring `@robota-sdk/agent-core/node` (CORE-028)") and (2) contract-level reuse ("reusing the shared substrate `agent-transport` at the contract/core level rather than a sibling product"; the parent "`agent-interface-*` only") — and closes "Placement verdict: all seven ENDORSED. … REVIEW VERDICT: ENDORSE". This is a recorded verdict covering placement, not a bare "reviewed" claim. (b) `**Structure-channel result (`arch-audit-structure` …)**` is retained: placement verdict quoted (the six placements "구조적으로 충돌하지 않으며"), 24 cells / 23 covered with the one uncovered cell named and assigned to TC-08, and `FINDINGS 9` (high 0, medium 3, low 6) each stated as a plan-completeness obligation, not a placement conflict, and mapped to a unit. Verified by the guard: the nine findings are carried as sub-items of the paired Task's `## Plan` (`.agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md:127-162` — ST-4, ST-9 under S1; ST-1, ST-2, ST-3, ST-5, ST-8 under S2; ST-6, ST-7 under S3; ST-3 under S4); the structure channel's measurements reproduce from the manifests at HEAD `4b03d3248` (`dependencies`+`peerDependencies` over `packages/`+`apps/`): exactly 11 same-family sibling prod edges = interface 4 + provider 1 + transport 6, 0 parent→child prod edges, and `agent-framework`/`agent-core` carry 0 `agent-transport-*`/`agent-ui-*` edges in any section; the anchors the quoted verdicts rest on exist as cited — `check-dep-kind.mjs:51-52` is the `^import` value-import regex and `:131` is the "undeclared entirely → owned by the deps scan" hand-off, `packages/agent-core/package.json` `exports["./node"]` carries `"browser": null`, `ARCHITECTURE.md:41-42` is the `buildRuntimeSession`/`startRuntimeHost` runtime-host seam, and `CORE-028` is a completed Task. Observations, not findings: the structure channel's "92 manifests" does not reconcile with the guard's enumeration (62 `packages/` + 10 `apps/` = 72; 81 with `examples/`) — every derived number matches regardless; the reviewer's own output is not in the tree, so the verbatim-ness of the quoted coverage statement rests on the orchestrator's record — its condensed form in `scratchpad/struct012-evidence.txt` (written 11:31, before this entry) lists the same seven placements and the same verdict, and nothing contradicts it; checklist item 5's phrase "no new package is created" remains loose (S4 creates two directories by `git mv`), already noted at GATE-WRITE, and the item's "recorded in § Evidence Log" is now true
- GATE-APPROVAL — NON-COMPLIANCE trigger (implementation started before this gate): not triggered — HEAD `4b03d3248389` equals `origin/develop`, `git log origin/develop..HEAD` is empty, `git status` shows only the two auto-lessons files modified and five untracked `.agents/` documents (this spec, its paired Task, STRUCT-013's Task, RULE-024's draft and Task), `packages/` has no `agent-ui-*` directory and `packages/agent-framework/src/transport-host` does not exist

Guardian semantic set (`backlog-gate-guard`, 2026-09-05, re-run after the ❌ FAIL entry above): 2 PASS, 1 N/A — gate verdict **PASS**. Mechanical set re-run by the guard: `node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --lane L2 --doc <this document>` → 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN (the three judged above); ordering line PASS (`[GATE-WRITE] — ✅ PASS | 2026-09-05`; status `review-ready`). The heading's `✅ PASS` written by `gate.mjs approve` now agrees with the gate's outcome and is left as is; the `**Status upgrade:**`, `**Review fingerprint:**` and `**Judged at:**` lines are left exactly as written, and no status change is made by this entry.

**Judged at:** HEAD `4b03d3248389` · base `origin/develop@4b03d3248389` · document `.agents/spec-docs/backlog/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md` blob `146623c18a1f` (untracked)

### [GATE-IMPLEMENT] — ❌ FAIL | 2026-09-05

**Status remains:** approved
**Failed criteria:**

- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names 10/13 TC ids and carries 5 checkbox task(s)
  **Required action:** one task per TC-N
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : 3 path(s) outside the paired spec/Task: .agents/spec-docs/draft/RULE-024-name-the-package-name-hierarchy-reference-rule-and-make-every-owner-document-cite-it.md, .agents/tasks/RULE-024-name-the-package-name-hierarchy-reference-rule-and-make-every-owner-document-cite-it.md, .agents/tasks/STRUCT-013-agent-transport-webrtc-web-is-a-ui-family-member-under-a-transport-name.md
  **Required action:** commit, stash, or remove them before this gate

**Judged at:** HEAD `4b03d3248389` · base `origin/develop@4b03d3248389` · document `.agents/spec-docs/todo/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md` blob `6ffc59384593` (untracked)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-05

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-05; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (13)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 1732 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: not-applicable | 0`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "sequenced",
  "sequencedArtifacts": [
    "scripts/harness/check-dependency-direction.mjs",
    "scripts/harness/family-sibling-baseline.json",
    "packages/agent-transport/package.json",
    "packages/agent-transport/src/index.ts",
    "packages/agent-framework/src/index.ts",
    "packages/agent-transport-ws/package.json",
    "packages/agent-transport-gui/package.json",
    ".agents/project-structure.md",
    "ARCHITECTURE.md"
  ],
  "taskPath": ".agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md",
  "specPath": ".agents/spec-docs/todo/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md",
  "taskItems": [
    {
      "kind": "tc-id",
      "value": "TC-01"
    },
    {
      "kind": "tc-id",
      "value": "TC-02"
    },
    {
      "kind": "tc-id",
      "value": "TC-03"
    },
    {
      "kind": "tc-id",
      "value": "TC-04"
    },
    {
      "kind": "tc-id",
      "value": "TC-05"
    },
    {
      "kind": "tc-id",
      "value": "TC-06"
    },
    {
      "kind": "tc-id",
      "value": "TC-07"
    },
    {
      "kind": "tc-id",
      "value": "TC-08"
    },
    {
      "kind": "tc-id",
      "value": "TC-09"
    },
    {
      "kind": "tc-id",
      "value": "TC-10"
    },
    {
      "kind": "tc-id",
      "value": "TC-11"
    },
    {
      "kind": "tc-id",
      "value": "TC-12"
    },
    {
      "kind": "tc-id",
      "value": "TC-13"
    }
  ],
  "plan": {
    "outcome": "not-applicable",
    "count": 0
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md",
    ".agents/tasks/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged at:** HEAD `4b03d3248389` · base `origin/develop@4b03d3248389` · document `.agents/spec-docs/todo/STRUCT-012-refactor-the-transport-family-onto-its-name-hierarchy.md` blob `384edb2eb500` (untracked)
