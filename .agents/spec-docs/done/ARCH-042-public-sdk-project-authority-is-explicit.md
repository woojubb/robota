---
status: done
completed: 2026-08-22
type: SECURITY
tags: [typescript, auth]
---

# ARCH-042: public SDK project authority is explicit and non-ambient

## Problem

Published SDK entry points can currently turn a project path into filesystem authority without a prior trust
decision. For example, `createProjectSessionStore(cwd)` supplies a default `NodeFileSystem`,
`ProjectMemoryStore(cwd)` and `EditCheckpointStore({ cwd })` open `.robota/*` directly,
`loadTaskContext(cwd)` defaults to raw Node I/O, prompt-file resolution creates a `NodeFileSystemAsync` when no
reader is provided, and settings/provider helpers derive project paths before reading them. `agent-session` and
`agent-provider-replay` repeat the pattern for session logs and external payloads by accepting a filename and
opening it with Node filesystem globals.

The reproduction condition is any direct SDK consumer, resume/replay path, or newly added project loader that
passes an untrusted checkout path without a framework-minted workspace authority. That call can consume project
settings, prompts, task metadata, memory, sessions, checkpoints, or replay payloads even when the higher-level CLI
is in Restricted Mode. Optional readers do not close the boundary because absence currently means “construct an
ambient Node adapter,” while a generic `IFileSystem` proves only that the host can perform I/O—not that the project
was authenticated or trusted.

This is a foundational blocker for `SECURITY-001`: a CLI trust gate cannot make Restricted Mode true while the
published SDK continues to expose capabilityless project loaders.

## Prior Art Research

### References consulted

- [VS Code Workspace Trust](https://code.visualstudio.com/docs/editing/workspaces/workspace-trust) and its
  [Extension API guide](https://code.visualstudio.com/api/extension-guides/workspace-trust) centralize the trust
  decision, open unfamiliar folders in Restricted Mode, suppress trust-sensitive workspace settings, and disable
  extensions unless they declare full or limited untrusted-workspace support. Extensions receive trust state and
  change events instead of implementing independent trust stores.
- [Claude Code security](https://code.claude.com/docs/en/security) requires trust verification for first-time
  codebases, bounds filesystem access by the working directory plus explicit additional directories, and fails
  sensitive operations closed to approval. Its non-interactive compatibility switches do not establish that an
  ambient public-SDK path is safe.
- [Claude Agent SDK secure deployment](https://code.claude.com/docs/en/agent-sdk/secure-deployment) recommends
  security boundaries, least privilege, mounting only required directories—preferably read-only—and keeping
  credentials outside the agent boundary behind a proxy.
- [OpenAI Agents SDK sandbox concepts](https://openai.github.io/openai-agents-js/guides/sandbox-agents/concepts/)
  and [sandbox clients](https://openai.github.io/openai-agents-js/guides/sandbox-agents/clients/) describe
  workspace content through a manifest and attached capabilities. Manifest paths are workspace-relative and
  cannot escape through absolute paths or `..`; outside access requires the smallest explicit path grant, and
  resumption revalidates identity, manifest, environment, and grants.
- [Git `safe.directory`](https://git-scm.com/docs/git-config#Documentation/git-config.txt-safedirectory) refuses
  ownership-mismatched repository configuration and hooks until explicitly allowed, and honors the allowlist only
  from protected configuration so a repository cannot declare itself trusted.
- [`cap-std` filesystem API](https://docs.rs/cap-std/latest/cap_std/fs/index.html) and
  [`AmbientAuthority`](https://docs.rs/cap-std/latest/cap_std/struct.AmbientAuthority.html) replace free functions
  over bare paths with capability-bearing directory handles and make entry into the process-wide namespace a
  separately named, explicit operation.

### Observed common behavior

1. Project content is untrusted by default; trust-sensitive configuration and execution remain disabled,
   restricted, or approval-gated.
2. The trust decision is centralized and stored outside project control. Consumers do not independently infer
   trust, and repository content cannot grant trust to itself.
3. Access is conveyed by a bounded capability or execution context, not by a path alone. Operations are relative
   to an already-authorized root; outside access requires a separate grant.
4. Missing authority does not fall back to broader authority. Products stay restricted or fail early, and I/O
   errors are not silently reclassified as missing content.
5. Persisted or resumed state does not prove current authority; identity and grants are revalidated at lifecycle
   boundaries.
6. Host-owned prebuilt content and explicit generic adapters remain usable without pretending to confer project
   trust.
7. Ambient access, where retained, is conspicuous and separately named rather than hidden behind a convenience
   overload.

### Constraints for Robota

- A trust boolean is insufficient because loaders execute in the same Node process and can still call `node:fs`.
  The authority must mediate operations, not merely describe an earlier decision.
- Settings, provider profiles, prompts, task context, sessions, memory, checkpoints, and project replay payloads
  must share one project-authority model. Securing only startup composition leaves published bypasses.
- Direct SDK use is commonly non-interactive, so capabilityless calls need deterministic restricted/refused
  behavior rather than a CLI prompt.
- Host applications must retain prebuilt-content and generic filesystem/storage seams, but those contracts must
  not satisfy or imply workspace authority.
- `agent-session` and `agent-provider-replay` are below `agent-framework`; they cannot import a framework-owned
  trust contract without reversing the dependency graph.

### Recommendation

Adopt one opaque, immutable `WorkspaceProjectAuthority` in `agent-framework`, minted only by the host-owned
workspace trust service after current identity and trust validation. It yields narrow, relative-only read and
named project-state facets. Bounded project mutation and project-settings writes require distinct capabilities
composed with the applicable permission/command intent; trust-to-read does not imply arbitrary mutation. Bare root
paths, booleans, raw filesystems, and optional readers are not substitutes.

Keep lower packages authority-neutral and preserve current SSOT ownership. `agent-interface-transport` continues
to own `IInteractiveSessionRecord` and `IInteractiveSessionStore`; `agent-session` owns their persistence
mechanism plus explicit log/payload source and sink ports. `agent-provider-replay` consumes those ports or
host-supplied, already-hydrated entries. Framework project adapters implement lower ports from valid authority
facets. A separately named host filesystem adapter remains possible, but is explicit, has no default construction
path, and cannot be passed where `WorkspaceProjectAuthority` is required.

Every public stateless project API and every initial session/query construction entry point must require the
authority or a facet derived from it. High-level construction without a valid grant enters a typed Restricted
state and does not instantiate project loaders. During the pre-release migration, remove capabilityless overloads
in that scope instead of wrapping them around `node:fs`. Add a public-surface/type guard that rejects bare project
roots, optional authority, generic-filesystem-as-trust, and ambient fallbacks. `ARCH-043` then carries the accepted
decision immutably across lazy session commands; ARCH-042 does not introduce a temporary per-call substitute.

## Architecture Review

### Affected Scope

- `packages/agent-framework/src/workspace-trust/` — owns the opaque authority, restricted decision, relative
  project-reader facet, named project-state-storage facets, bounded mutation/settings capabilities, runtime-private
  non-copyable instance registry, production mint/assert boundary, and adapters from authority facets to lower
  package ports. Tests obtain
  authority through the production trust service with isolated identity/store dependencies; no shipped testing
  issuer can register a production-accepted instance. `SECURITY-001` remains responsible for concrete protected stores,
  platform identity adapters, CLI trust lifecycle, and Restricted Mode presentation.
- `packages/agent-framework/src/interactive/` — initial high-level session/query construction receives an explicit
  trusted-or-restricted project-access decision. Restricted construction does not create project-backed stores or
  loaders. Project session log append/flush/sidecar ports and transcript-reference conversion are composed at the
  construction boundary rather than reopened from reusable paths. Retaining the decision and derived facets across
  later commands is deliberately deferred to `ARCH-043`.
- `packages/agent-framework/src/config/` and `src/command-api/provider/` — project settings/provider reads and
  writes use discriminated managed/user/project source contracts. Project reads require the reader facet and
  project writes require a bounded settings-writer capability; a host path cannot masquerade as a project layer.
- `packages/agent-framework/src/context/`, `src/commands/`, and `src/agents/` — context walk-up, prompt references,
  task context, skills, commands, and agent definitions consume the relative reader facet without optional
  `IFileSystem` defaults. Project ancestor traversal stops at the authenticated worktree root. Parent/organization
  context, when supplied by a host, uses a separate host-context source. Git branch/worktree metadata comes from
  the trust identity/Git adapter rather than following a project `.git` file outside the root.
- `packages/agent-framework/src/memory/`, `src/checkpoints/`, and `src/interactive/session-persistence.ts` —
  project memory and its pending queue adapt named state storage to the existing `IMemoryStore`; project session
  records/logs and checkpoint snapshots use named storage; checkpoint capture uses the reader; checkpoint restore
  and deletion require a separate permission-gated project-mutation capability. Existing user-local storage stays
  a separate host-owned boundary.
- `packages/agent-interface-transport/src/session-contracts.ts` — remains the SSOT for session record/store
  contracts. Remove `getFilePath` as reusable authority; transcript/log references come from the logger/source
  owner and are resolved to a host path only by a trusted host adapter at the hook boundary.
- `packages/agent-session/src/` — session record/log/external-payload code becomes authority-neutral core plus
  explicit sources/sinks. Cover live append, buffering, flush, payload sidecars, parsing, hydration, and integrity.
  Separately named Node adapters are explicitly injected; no public path-only overload creates one by default.
- `packages/agent-provider-replay/src/` — parsed entries/prebuilt responses remain supported; file-backed replay
  requires an explicit session-log source and external-payload source rather than a bare filename with ambient
  I/O. `ReplayProvider({ entries })` is I/O-free and rejects unresolved payload references unless an explicit
  payload source is supplied.
- Stateless and initial-construction consumers in `packages/agent-cli`, `agent-command`,
  `agent-command-workflows`, `agent-transport`,
  `agent-transport-tui`, framework examples/testing, diagnose/eval/session-analysis, and provider/session startup
  paths migrate in the same item; none retains a path-only compatibility call within that scope. Lazy
  `InteractiveSession` command transitions remain an explicit SECURITY-001 blocker until `ARCH-043` consumes this
  contract.
- `packages/{agent-interface-transport,agent-framework,agent-session,agent-provider-replay}/docs/SPEC.md` and
  relevant package READMEs/examples — record generic filesystem ownership versus project authority, public API
  migration, errors, ancestor behavior, transcript references, and failure/degradation semantics.
- `scripts/harness/` — add a TypeScript-AST/public-surface guard for project APIs and ambient adapter defaults.
- `.agents/specs/architecture-map/` — record the framework authority owner and the lower-package neutral port
  direction without duplicating individual public API inventories.

The item deliberately does not choose immutable per-session propagation (`ARCH-043`), child wire shape
(`ARCH-044`), provider credential/destination ownership (`ARCH-045`), or contribution inventory derivation
(`ARCH-046`). It provides the authority/facet contract those items consume. Execution order is load-bearing:
`ARCH-043` consumes ARCH-042 before SECURITY-001 may claim end-to-end Restricted Mode or secure lazy session
transitions.

### Alternatives Considered

1. **Framework-owned opaque authority plus authority-neutral lower ports (selected).** Project interpretation and
   trust remain in the SDK assembly owner; lower packages accept explicit content/storage sources and never infer
   project trust. **Pro:** preserves dependency direction, separates host data from project authority, and makes
   ambient fallbacks structurally unnecessary. **Con:** breaks several convenience APIs and requires a coordinated
   migration across framework, session, replay, tests, and documentation.
2. **Move the workspace authority contract into `agent-core`.** Every affected package can import one shared
   interface directly. **Pro:** simplest type reachability. **Con:** the zero-dependency provider/runtime
   foundation would acquire repository-trust semantics, and generic session/replay primitives would begin
   treating an SDK assembly concern as their own authority model.
3. **Place the authority in `agent-interface-transport`.** The package already owns transport-facing execution
   workspace contracts. **Pro:** pure shared types are reachable without a cycle. **Con:** filesystem authority is
   intentionally non-serializable and not a transport projection; placing it beside wire/session data invites
   path/token serialization and conflates execution-workspace observation with project filesystem authority.
4. **Keep per-loader optional readers or explicit raw filesystem parameters.** Tighten each loader locally and
   document that callers must pass a safe adapter. **Pro:** smallest source migration and maximum host
   flexibility. **Con:** generic I/O still masquerades as trust, absence retains inconsistent fallback semantics,
   and every new loader can recreate the bypass.

### Decision

Select Alternative 1. `agent-framework` is the lowest correct owner for project interpretation and workspace
trust: every product/direct SDK consumer can reach it, while lower session/replay packages need only explicit,
domain-owned content/storage ports. This follows the existing ports-and-adapters split: framework policy owns the
port usage and composition, `agent-interface-transport` retains the session record/store SSOT, `agent-session`
owns neutral persistence/log/payload mechanisms, and concrete Node or workspace-authority adapters remain
imperative-shell implementations.

The public authority is a runtime capability, not a data DTO. A trusted access decision contains an opaque,
frozen authority whose exact instance identity is registered in module-private, closure-owned state such as a
`WeakSet`/`WeakMap` or an inaccessible JavaScript private-field check. Production validation never trusts a symbol,
property, prototype, structural shape, or reflected/copied marker. A restricted decision contains a typed reason
and no authority. No package export, including `/testing`, exposes a production-accepted issuer. Tests drive the
production service with isolated identity/store dependencies.

The trusted authority yields read and named application-state facets. Project settings mutation and checkpoint
restore use separate bounded capabilities created only after both workspace authority and the applicable
command/permission decision are present; read trust is never promoted into arbitrary write authority. Facets
accept only root-relative operations. Absolute paths are display/provenance values, not reusable authority.
`IInteractiveSessionStore.getFilePath` is removed from its canonical contract; logger-owned transcript references
are converted to a host path only by the trusted hook adapter when project hooks are allowed.

Project context traversal intentionally narrows at the authenticated worktree root. A host may inject parent or
organization context through a separately typed host-context source. Task branch/worktree metadata is supplied by
the host-owned Git identity adapter, so a project `.git` indirection is never followed as ordinary project content.
An I/O failure through an authority remains a typed access failure and never becomes empty/missing unless the
mediated operation proves absence.

Lower-package capability preservation is explicit:

- session save/load/list/delete stays on the `agent-interface-transport` port and maps to explicit
  `agent-session` storage adapters;
- live log append/buffer/flush and external-payload sidecar writes map to explicit log/payload sinks; parsing and
  hydration map to content and relative-payload sources;
- replay from already-hydrated entries is I/O-free, while replay from files composes the explicit session sources;
- project settings use discriminated source layers and a bounded settings writer; context/tasks/prompts/skills/
  commands/agents map to the relative reader with the root/host-context split above;
- project memory and pending candidates adapt named state storage to `IMemoryStore`;
- project session/checkpoint data maps to named state storage, checkpoint capture reads source bytes, and restore/
  delete uses the distinct permission-gated project-mutation capability;
- user-owned settings, user-local memory, caller-supplied parsed entries, and explicit generic filesystem adapters
  remain distinct host-owned APIs and do not satisfy project-authority parameters.

Reachability was checked against current and planned consumers: CLI provider/session startup, command modules,
workflow authoring, TUI model persistence, diagnose/eval/session analysis, transports, examples, functional
harnesses, and direct SDK hosts already depend on `agent-framework`; `agent-session` and replay stay below it and
receive only their own neutral ports. This item defines stateless and initial-construction authority contracts,
not a temporary per-call authority. It does not claim to secure lazy operations such as provider switching or
permission callbacks that currently retain/reconstruct project access; those remain a known SECURITY-001 blocker.
`ARCH-043` must consume this contract, make the decision immutable and session-owned across those transitions,
and pass before end-to-end Restricted Mode is claimed. `ARCH-044` owns child wire/codec exclusion, `ARCH-045`
binds provider credentials to destinations, and `ARCH-046` derives contribution categories without changing
this contract.

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — framework settings/context/task/prompt/session/memory/checkpoint APIs; interface-transport session SSOT; session store/logger/payload mechanisms; replay helpers; CLI/command/workflow/TUI/transport/example consumers; and user-local/prebuilt-content siblings were inventoried
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료 — dependency reachability and capability-preservation mapping are recorded above; independent adversarial validation is required before approval

## Fallback & Degradation Declaration

- **Restricted project access.** Trigger: initial high-level construction receives an untrusted, stale, unavailable, or
  otherwise non-authorized project decision. Behavior: no project contribution reader, state store, settings
  writer, or mutation capability is constructed; low-level project APIs return/throw the typed
  `WorkspaceAuthorityRequired` refusal, while initial high-level SDK construction continues with an observable
  Restricted status. This is the intended safe product mode, not an ambient fallback. Lazy-session preservation is
  owned by `ARCH-043`; this declaration is covered by TC-02 and TC-09 for ARCH-042's stateless/construction scope.
- **Best-effort session logging.** Trigger: the explicitly configured session log/payload sink cannot initialize,
  append, externalize, or flush. Behavior: emit a structured warning and disable/drop only diagnostic logging;
  the session turn continues. This preserves the existing sanctioned logging contract and does not apply to
  session records, settings, memory, or checkpoints. Each implementation site carries `// allow-fallback:` and is
  covered by TC-05.

## Solution

1. Define the trusted/restricted project-access decision, opaque authority, non-copyable module-private instance
   registry, and production trust-service mint in `agent-framework`. Tests exercise that service with isolated
   identity/store dependencies; no public or testing issuer can mint a production-accepted authority directly,
   and reflection/property/prototype copying cannot transfer acceptance to another object.
2. Expose least-authority relative-reader and named application-state facets. Add separately minted bounded
   settings-writer and project-mutation capabilities; they require the workspace authority plus the applicable
   command/permission decision. Paths are relative, normalized, containment-checked, and purpose-labelled.
3. Replace every framework public stateless project entry point and initial session/query construction entry point
   with an authority-bearing signature. Remove overloads in that scope that accept only `cwd`, optional project
   authority/readers, generic filesystem-as-trust, or default Node access. High-level construction consumes the
   trusted/restricted decision and announces Restricted state when needed.
4. Introduce discriminated settings sources so managed/user paths and project authority cannot be confused.
   Bound project writes to settings files and intentionally stop project ancestor traversal at the authenticated
   root; inject host context and Git metadata through separate host-owned ports.
5. Preserve `agent-interface-transport` session record/store ownership and remove `getFilePath` from that port.
   Refactor `agent-session` into explicit storage adapters, log/payload sources, and log/payload sinks covering
   append, buffer, flush, sidecar, parse, hydrate, and integrity behavior. Keep Node adapters explicit.
6. Adapt authority state to the existing `IMemoryStore`, including pending-candidate mutation. Compose checkpoint
   capture from reader + state storage and restore/delete from state storage + the permission-gated mutation
   capability.
7. Make replay consume already-hydrated parsed entries or explicit session log/payload sources. Remove the
   path-only helper, constructor base-directory escape, and the existing double assertion between replay/session
   log entry contracts.
8. Migrate all stateless and initial-construction CLI, command, workflow, TUI, transport, example, harness,
   diagnose, eval, session-analysis, and startup consumers in the same item. No compatibility shim reconstructs
   ambient authority in that scope. Record current lazy `InteractiveSession.executeCommand` provider switching
   and retained permission callbacks as unresolved until `ARCH-043`; do not implement a per-call workaround.
9. Add compile-time contract tests and an AST/public-surface scan. The scan rejects exported project APIs with a
   bare root/cwd path and no authority, optional authority/reader fields, generic-filesystem-as-trust, production
   test issuers, or direct `node:fs` access outside separately named host adapters.
10. Update owner SPECs, architecture docs, READMEs, examples, and migration notes before source implementation.
    Distinguish project content, project application state, permission-gated mutation, user state, and host-owned
    prebuilt/generic sources.

## Affected Files

- `packages/agent-framework/src/workspace-trust/{types,project-authority,project-reader,project-state-storage,project-settings-writer,project-mutation,index}.ts`
- `packages/agent-framework/src/{interactive,config,command-api/provider,context,commands,agents,memory,checkpoints}/**/*.ts`
- `packages/agent-framework/src/index.ts`, framework examples, and framework testing/functional harness consumers
- `packages/agent-interface-transport/src/{session-contracts,index}.ts` and contract tests
- `packages/agent-session/src/{session-store,session-logger,session-log-payload,session-log-replay,external-payload-resolver,external-payload-file-reader,index}.ts`
- `packages/agent-session/src/{session,permission-types,session-run,session-components,permission-enforcer,tool-hook-helpers,session-lifecycle}.ts`
  for removal of `getFilePath` propagation and trusted hook-boundary transcript conversion
- `packages/agent-provider-replay/src/{index,replay-provider}.ts`
- `packages/agent-cli/src/{cli,startup,eval,session-analyzer}/**/*.ts`,
  `packages/agent-cli/src/modes/{serve-mode,print-mode}.ts`, and
  `packages/agent-cli/src/product/robota-plumbing.ts`
- `packages/agent-command/src/provider/**/*.ts`, `packages/agent-command-workflows/src/authoring/**/*.ts`
- `packages/agent-transport*/src/**/*.ts` consumers, including TUI model persistence;
  `packages/agent-transport/examples/**/*.ts`; framework and transport replay examples
- Affected tests under all migrated packages plus framework functional tests and public examples
- `packages/{agent-interface-transport,agent-framework,agent-session,agent-provider-replay}/docs/SPEC.md`
- Relevant package `README.md` / `docs/README.md` public examples
- `.agents/specs/architecture-map/` authority/dependency owner document
- `scripts/harness/scan-public-project-authority.mjs`, its tests/fixtures, harness registration, and CI mirror

## Completion Criteria

- [x] TC-01: Production trust-service tests mint the only production-accepted authority after a verified trusted
      decision; direct construction, structural lookalikes, serialized values, copied own keys/symbols, prototype
      spoofing, an object assembled from a legitimate authority's reflected properties, and every runtime/testing
      barrel issuer are rejected by type and non-copyable instance-identity checks.
- [x] TC-02: Capabilityless initial high-level SDK session/query construction reports typed Restricted project access and reads no
      project settings, provider profile, context, prompt reference, task, skill, command, or agent-definition
      canary; the test does not claim lazy-session preservation owned by `ARCH-043`.
- [x] TC-03: Settings tests preserve managed/user/project precedence through discriminated sources, reject a host
      path as a project source, and require the bounded settings-writer capability for every project settings write.
- [x] TC-04: Authority-backed context tests preserve in-root settings, prompt references, tasks, skills, commands,
      agents, and ancestor context while stopping at the authenticated root; parent context and Git metadata are
      readable only through their separately injected host sources.
- [x] TC-05: Session save/load/list/delete plus live log append/buffer/flush and payload sidecars use explicit
      authority-backed storage/sinks; `IInteractiveSessionStore` has no `getFilePath`, and sink failure produces
      the declared warning-only logging degradation without disabling session execution.
- [x] TC-06: Project memory tests preserve load/list/read/append/deduplication and pending approve/reject mutations
      by adapting named authority state to the existing `IMemoryStore`, with no ambient project read/write.
- [x] TC-07: Checkpoint tests preserve begin/capture/finalize/list/inspect/restore/delete by using reader + state for
      snapshots and a separately permission-gated project-mutation capability for restore/delete.
- [x] TC-08: `agent-session` host record/log/payload adapters remain workspace-neutral and replay from supplied
      hydrated entries is I/O-free; file-backed replay requires explicit sources, preserves payload
      depth/byte/hash checks, and cannot infer project trust from a path or `externalPayloadBaseDirectory`.
- [x] TC-09: Stateless and initial-construction CLI, command, workflow, TUI, transport, diagnose, eval,
      session-analysis, example, and functional harness builds/tests contain no path-only or optional-authority
      compatibility call and preserve their owned user-visible behavior under trusted and Restricted
      construction; the documented lazy-session paths remain gated on `ARCH-043`.
- [x] TC-10: `pnpm harness:scan` runs `public-project-authority` and fails fixtures that add a public project
      loader with bare `cwd`, optional authority/reader, generic-filesystem-as-trust, a production-capable test
      issuer, or ambient Node fallback.
- [x] TC-11: Owner SPECs, architecture docs, public API tables, READMEs, examples, targeted builds/typechecks/tests,
      framework functional scenarios, SSOT scan, `pnpm harness:scan`, and `pnpm harness:verify-like-ci` all agree
      with the authority model and exit 0.

## Test Plan

Derived SECURITY + auth strategy: auth/permission-boundary integration and compile-time public-contract tests,
supplemented by package integration and framework functional scenarios. Every criterion is automated.

| TC-ID | Test Type                       | Tool / Approach                                                                                                                              | Notes                                                                                                                                                                                                                                                                                              |
| ----- | ------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| TC-01 | Type/runtime security contract  | Production trust-service tests, copied-key/symbol/reflection/prototype adversarial fixtures, barrel scan, and compile-fail structural inputs | `packages/agent-framework/src/workspace-trust/workspace-project-authority.test.ts` > `rejects structural, reflected-property, serialized, and prototype forgeries`                                                                                                                                 |
| TC-02 | Permission-boundary integration | Scripted initial high-level session/query construction in a canary repository with project-loader and Node I/O spies                         | `packages/agent-framework/src/__tests__/query-project-access.test.ts` > `reports Restricted access when the host supplies no project decision`; maintained `verify-workspace-project-authority.ts` scenario                                                                                        |
| TC-03 | Security configuration contract | Managed/user/project source matrix plus compile/runtime tests for bounded project settings mutation                                          | `packages/agent-framework/src/config/__tests__/settings-source.test.ts` > `reads project layers only through a production-minted reader`; `settings-store.test.ts` > `reads and writes only the project target approved by the same authority`                                                     |
| TC-04 | Security context integration    | In-root/parent/Git-indirection fixtures with project reader and separate host-source spies                                                   | `packages/agent-framework/src/context/__tests__/prompt-file-references.test.ts` > `rejects references outside the workspace root`; `contributions/__tests__/contribution-source.test.ts` > host/project distinction; `interactive-session-authorized-context-refresh.test.ts` > authorized refresh |
| TC-05 | Session storage/log integration | Record CRUD, logger append/buffer/flush, payload-sidecar, transcript-reference, and sink-failure fixtures                                    | `packages/agent-framework/src/__tests__/session-store.test.ts` > authority-backed CRUD and warning-only degradation; `packages/agent-session/src/__tests__/session-logger-hot-path.test.ts` > ordered buffering and write-failure reporting                                                        |
| TC-06 | Memory storage integration      | Existing `IMemoryStore` contract suite plus project memory/pending queue authority fixtures                                                  | `packages/agent-framework/src/memory/__tests__/project-memory-store.test.ts` > load/append/dedup/list; `file-system-memory-store.test.ts` > `queues and transitions pending candidates through the port`                                                                                           |
| TC-07 | Mutation-boundary integration   | Checkpoint snapshot/restore/delete matrix with read/state/mutation capabilities and permission denials                                       | `packages/agent-framework/src/checkpoints/__tests__/edit-checkpoint-store.test.ts` > mismatched mutation rejection plus restore/delete/inspect matrix                                                                                                                                              |
| TC-08 | Replay/source integration       | Neutral session adapters and parsed/file replay with nested payload, byte budget, hash, base-directory rejection, and no-I/O spies           | `packages/agent-session/src/__tests__/session-log-source-contract.test.ts` > explicit neutral sources and bare-path rejection; `packages/agent-provider-replay/src/__tests__/replay-provider.test.ts` > explicit nested response hydration                                                         |
| TC-09 | Consumer integration            | Stateless/construction consumer compile/tests, CLI scenarios, functional harness, public examples, and ARCH-043 residual-path assertion      | `packages/agent-cli/src/startup/__tests__/workspace-project-composition.test.ts` > Restricted/trusted composition; `packages/agent-transport/src/__tests__/programmatic/programmatic-driver.test.ts` > trusted decision threading; transport/TUI recorded scenarios                                |
| TC-10 | Harness architecture scan       | RED/GREEN fixtures for `scan-public-project-authority.mjs`; `pnpm harness:scan`                                                              | `scripts/harness/__tests__/scan-public-project-authority.test.mjs` > seven RED fixtures, GREEN fixture, registration/live-tree assertions                                                                                                                                                          |
| TC-11 | Spec/release verification       | SPEC/reference/SSOT scans, affected builds/typechecks/tests, framework functional harness, `harness:scan`, `harness:verify-like-ci`          | `pnpm harness:verify-like-ci` passed all 12 stages; `pnpm build` and `pnpm test` independently exited 0 during GATE-VERIFY                                                                                                                                                                         |

## User Execution Test Scenarios

- **S-1 — capabilityless construction stays Restricted while an explicit grant enables only its project.**
  Agent-executable, offline, and provider-free through the maintained public SDK example
  `packages/agent-framework/examples/verify-workspace-project-authority.ts` and package script
  `scenario:verify:workspace-authority` delivered by this item. Run
  `pnpm --filter @robota-sdk/agent-framework scenario:verify:workspace-authority`; expect exit `0` and one JSON
  result showing no canaries with `WorkspaceAuthorityRequired`, both context/settings canaries after an explicit
  grant for the matching root, and `cleanupRemoved: true`. The exact prerequisites, failure conditions, cleanup,
  and post-implementation Evidence field are owned by
  `.agents/tasks/ARCH-042-public-sdk-project-authority-is-ambient.md` under the same scenario ID.

## Tasks

- [x] `.agents/tasks/completed/ARCH-042-public-sdk-project-authority-is-ambient.md` — completed Task;
      implementation and user-execution gates passed

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-08-22

**Status upgrade:** draft → review-ready

- Frontmatter: the document begins with YAML frontmatter containing `status: draft`, allowed `type: SECURITY`, and a present `tags` field.
- Problem: names concrete ambient-authority SDK behaviors and the direct-SDK/untrusted-checkout reproduction condition; it contains no TBD/TODO or vague one-sentence placeholder.
- Prior Art Research: cites product, API, protocol/design, and capability-filesystem documentation; the seven observed behaviors and Robota constraints drive Alternative 1 and the authority/facet Decision.
- Architecture Review: all four checklist items are checked; the sibling inventory evidence names framework/session/replay surfaces; four alternatives each state a pro and con; the Decision identifies dependency direction and capability preservation as the governing trade-off.
- New-surface placement: the new interface is classified as a framework-owned runtime capability rather than a DTO, mirrors the existing framework-policy/lower-package-port ports-and-adapters layering, and reuses `agent-session` contracts instead of depending on a sibling product.
- Completion Criteria: 10 criteria are present, each prefixed `TC-01` through `TC-10`, covering each declared migration/guard/documentation feature with command or observable behavior wording and none of the forbidden vague phrases.
- Test Plan: 10 non-empty rows exactly match the 10 Completion Criteria IDs; every row names a Test Type and Tool / Approach, and no row relies on manual verification.
- Structure: Tasks and Evidence Log sections are present, the Tasks placeholder names the existing ARCH-042 task, and no body `Status` or `Classification` section is present.

### [proposal-reviewer / architecture review] — ❌ REVISE | 2026-08-22

- **Placement:** endorsed `agent-framework` as the authority owner and rejected moving runtime authority into
  `agent-core` or transport DTO contracts; required preservation of `agent-interface-transport` as the existing
  session record/store SSOT.
- **Contract defects found:** the proposed testing issuer could forge a production capability; read/state facets
  could not preserve project settings writes, live log append/flush/payload sidecars, or checkpoint restore/delete;
  context ancestor and external Git metadata semantics were unspecified.
- **Scope gaps found:** CLI/command/workflow/TUI/transport/example consumers, `getFilePath`, memory pending state,
  parsed-entry payload I/O, and logger failure behavior were missing from the migration and tests.
- **Required revision applied:** runtime-private production minting, separate read/state/settings-write/mutation
  capabilities, the canonical session-port owner, explicit log/payload sources and sinks, bounded ancestor/Git
  sources, complete consumer migration, Restricted/logging degradation, and 11 matching completion/test criteria
  are now recorded.
- **Depth:** immutable session propagation (`ARCH-043`), child wire (`ARCH-044`), provider connection binding
  (`ARCH-045`), and contribution inventory ownership (`ARCH-046`) remain separate roots.
- **Verdict:** `REVIEW VERDICT: REVISE` — corrected proposal requires a fresh independent review before approval.

### [proposal-reviewer / architecture re-review] — ❌ REVISE | 2026-08-22

- **Resolved:** session-contract SSOT, separate read/state/settings/mutation capabilities, settings precedence,
  logger/payload behavior, memory pending state, checkpoints, context/Git boundaries, replay I/O, Restricted Mode,
  and lower-package placement now satisfy the architecture review.
- **Remaining defects found:** a symbol/property brand could be reflected and copied; absolute public-API and
  Restricted Mode claims conflicted with `ARCH-043`'s session-lifetime ownership; and the affected-file inventory
  omitted transcript-path propagation and concrete CLI/example consumers.
- **Required revision applied:** production validation now uses non-copyable module-private instance identity;
  ARCH-042 is explicitly bounded to stateless and initial-construction operations with `ARCH-043` required before
  end-to-end Restricted Mode; and the exact session, CLI, transport, and replay-example consumers are listed.
- **Verdict:** `REVIEW VERDICT: REVISE` — the three focused corrections require a fresh independent review before
  approval.

### [proposal-reviewer / architecture final review] — ✅ ENDORSE | 2026-08-22

- **Non-copyable runtime authority:** module-private instance validation, reflected/copied property and prototype
  attacks, and the absence of a production-capable testing issuer are specified and covered by TC-01.
- **ARCH-043 boundary:** ARCH-042 is bounded to stateless and initial-construction operations; lazy provider
  switching and retained permission callbacks remain explicit SECURITY-001 blockers, and end-to-end Restricted
  Mode cannot be claimed until ARCH-043 consumes this contract.
- **Consumer inventory:** `getFilePath` propagation, CLI modes/product plumbing, transport consumers/examples, and
  replay examples now agree with the implementation reachability scan.
- **Regression check:** framework authority ownership, transport session-contract SSOT, neutral lower-package
  ports, separate read/state/settings/mutation facets, capability preservation, and ARCH-044/045/046 separation
  remain valid; `pnpm harness:scan:deps` passed.
- **Verdict:** `REVIEW VERDICT: ENDORSE` — the proposal is ready for the explicit human approval boundary.

### [GATE-APPROVAL] — ✅ PASS | 2026-08-22

**Status upgrade:** review-ready → approved

- Ordering: the prior `GATE-WRITE` entry records `✅ PASS`, and the document is in
  `.agents/spec-docs/backlog/` with the expected input `status: review-ready`.
- Explicit approval: the user approved this exact ARCH-042 design in the current conversation with the verbatim
  statement **“승인함”** after being shown and asked to approve this spec for implementation.
- Approval targeting: the immediately preceding approval request named ARCH-042, linked this document, summarized
  its authority/port placement, and asked whether implementation under this design was approved; the response is
  therefore direct and unambiguous.
- Post-approval integrity: no Architecture Review content or frontmatter `type`/`tags` was modified after the
  approval; this gate invocation added only this Evidence Log entry.
- Independent architecture validation: the immediately preceding
  `[proposal-reviewer / architecture final review]` entry records `REVIEW VERDICT: ENDORSE`, specifically
  endorsing framework authority ownership, transport session-contract SSOT, neutral lower-package ports,
  separate capability facets, the ARCH-043 boundary, and the consumer inventory.
- Premature-implementation check: `git status --short` contains only the post-merge ledger and this spec document;
  no package, application, harness implementation, test, or owner-SPEC edit for ARCH-042 has started before this
  gate.

### [GATE-IMPLEMENT] — ✅ PASS | 2026-08-22

**Status upgrade:** approved → in-progress

- Ordering: the prior `[GATE-APPROVAL]` entry records `✅ PASS`; this document is in
  `.agents/spec-docs/todo/` with the expected input `status: approved`.
- Task record: `.agents/tasks/ARCH-042-public-sdk-project-authority-is-ambient.md` exists and is named exactly in
  this document's `## Tasks` section.
- TC-01 task: production-only non-copyable authority mint/assert plus adversarial type/runtime coverage.
- TC-02 task: Restricted capabilityless stateless/initial construction with no project-canary read.
- TC-03 task: discriminated settings precedence plus bounded project-settings mutation authority.
- TC-04 task: root-bounded context/contribution readers plus separate host context and Git sources.
- TC-05 task: neutral session record/log/payload ports, `getFilePath` removal, and logging degradation.
- TC-06 task: named authority state adapted to project memory and its pending queue through `IMemoryStore`.
- TC-07 task: checkpoint capture/state separated from permission-gated restore/delete mutation.
- TC-08 task: authority-neutral session/replay adapters, I/O-free hydrated replay, and explicit file sources.
- TC-09 task: stateless/initial consumer migration across CLI, command, workflows, TUI, transports, examples,
  harnesses, diagnose, eval, and session analysis without a path-only compatibility shim.
- TC-10 task: `public-project-authority` AST/public-surface guard registration and RED/GREEN fixtures.
- TC-11 task: owner documentation synchronization, affected verification, and preserved ARCH-043 dependency.
- Test Plan: the Task's `## Test Plan` contains substantive coverage for all TC-01 through TC-11 groups,
  including compile/runtime security contracts, integration suites, consumer verification, harness fixtures,
  SPEC/SSOT checks, and `harness:verify-like-ci`; it exceeds the required 50 characters.
- NON-COMPLIANCE check: the required Task record exists, so the “implementation commits but no tasks file”
  trigger does not apply.

### [GATE-VERIFY] — ✅ PASS | 2026-08-22

**Status upgrade:** in-progress → verifying

- Ordering: the prior `[GATE-IMPLEMENT]` entry records `✅ PASS`; this document has the expected input
  `status: in-progress` and remains in `.agents/spec-docs/active/`.
- Task completion: `.agents/tasks/ARCH-042-public-sdk-project-authority-is-ambient.md` contains TC-01 through
  TC-11 as 11 checked `[x]` implementation tasks; no implementation task is unchecked.
- Blocked/pending check: the Task contains no implementation task marked blocked or pending and no empty task
  checkbox, so no work item remains blocked or pending.
- Build: the guardian independently ran `pnpm build` from the repository root on 2026-08-22; all package
  JavaScript and ordered type builds completed and the command exited `0`.
- Tests: the guardian independently ran `pnpm test` from the repository root on 2026-08-22; the recursive
  workspace test run completed across the 104-project scope and the command exited `0`.

### [GATE-COMPLETE: TC-01] — ✅ PASS | 2026-08-22

- Command: pnpm --filter @robota-sdk/agent-framework exec vitest run
  src/workspace-trust/workspace-project-authority.test.ts.
- Result: exit 0; 1/1 test file and 6/6 tests passed, including production trust-state minting, structural and
  reflected-property serialization/prototype forgery rejection, relative-reader containment, closed state
  namespaces, bounded settings writes, and separate mutation authority.
- Test reference: packages/agent-framework/src/workspace-trust/workspace-project-authority.test.ts >
  "rejects structural, reflected-property, serialized, and prototype forgeries".

### [GATE-COMPLETE: TC-02] — ✅ PASS | 2026-08-22

- Commands: pnpm --filter @robota-sdk/agent-framework exec vitest run
  `src/__tests__/query-project-access.test.ts`; pnpm --filter @robota-sdk/agent-framework
  scenario:verify:workspace-authority.
- Result: both commands exited 0; 1/1 test file and 2/2 tests passed. The scenario emitted Restricted
  WorkspaceAuthorityRequired with no observed canaries, then trusted access with both ARCH-042 context/settings
  canaries, and cleanupRemoved true.
- Test reference: `packages/agent-framework/src/__tests__/query-project-access.test.ts` >
  "reports Restricted access when the host supplies no project decision"; maintained scenario:
  packages/agent-framework/examples/verify-workspace-project-authority.ts.

### [GATE-COMPLETE: TC-03] — ✅ PASS | 2026-08-22

- Command: pnpm --filter @robota-sdk/agent-framework exec vitest run
  `src/config/__tests__/settings-source.test.ts` `src/config/__tests__/settings-store.test.ts`.
- Result: exit 0; 2/2 test files and 6/6 tests passed, covering discriminated host/project sources, structural
  host-reader rejection, same-authority project targeting, and cross-authority writer rejection.
- Test references: `packages/agent-framework/src/config/__tests__/settings-source.test.ts` >
  "reads project layers only through a production-minted reader";
  `packages/agent-framework/src/config/__tests__/settings-store.test.ts` >
  "reads and writes only the project target approved by the same authority".

### [GATE-COMPLETE: TC-04] — ✅ PASS | 2026-08-22

- Command: pnpm --filter @robota-sdk/agent-framework exec vitest run
  `src/context/__tests__/prompt-file-references.test.ts`
  `src/contributions/__tests__/contribution-source.test.ts`
  `src/interactive/__tests__/interactive-session-authorized-context-refresh.test.ts`.
- Result: exit 0; 3/3 test files and 9/9 tests passed, including workspace-root escape rejection, explicit
  host/project source separation, and the authorized AGENTS.md refresh event.
- Test references: `packages/agent-framework/src/context/__tests__/prompt-file-references.test.ts` >
  "rejects references outside the workspace root";
  `packages/agent-framework/src/contributions/__tests__/contribution-source.test.ts` >
  "keeps explicitly named host content distinct from authority-backed project content";
  `packages/agent-framework/src/interactive/__tests__/interactive-session-authorized-context-refresh.test.ts` >
  "emits a refresh event after an authorized project context file changes".

### [GATE-COMPLETE: TC-05] — ✅ PASS | 2026-08-22

- Commands: pnpm --filter @robota-sdk/agent-framework exec vitest run `src/__tests__/session-store.test.ts`;
  pnpm --filter @robota-sdk/agent-session exec vitest run `src/__tests__/session-logger-hot-path.test.ts`.
- Result: both commands exited 0; the framework file passed 21/21 tests and the session logger file passed 6/6.
  Observed coverage includes authority-backed record CRUD, mismatched-facet rejection, replay fallback,
  warning-only linked-log degradation, ordered buffering, immediate semantic durability, and surfaced
  write/flush/directory failures.
- Test references: `packages/agent-framework/src/__tests__/session-store.test.ts` >
  "persists project session CRUD only through minted project state facets" and "warn-only disables logging when
  the authority-backed log target is linked";
  `packages/agent-session/src/__tests__/session-logger-hot-path.test.ts`
  > "keeps the file in the order the events happened" and "reports a failed write instead of swallowing it".

### [GATE-COMPLETE: TC-06] — ✅ PASS | 2026-08-22

- Command: pnpm --filter @robota-sdk/agent-framework exec vitest run
  `src/memory/__tests__/project-memory-store.test.ts` `src/memory/__tests__/file-system-memory-store.test.ts`.
- Result: exit 0; 2/2 test files and 16/16 tests passed, covering startup load, append, duplicate suppression,
  topic listing, pending approve/reject transitions, and the authority-backed IMemoryStore adapter.
- Test references: `packages/agent-framework/src/memory/__tests__/project-memory-store.test.ts` >
  "Given the same memory item already exists When appending again Then duplicate entries are skipped";
  `packages/agent-framework/src/memory/__tests__/file-system-memory-store.test.ts` >
  "queues and transitions pending candidates through the port".

### [GATE-COMPLETE: TC-07] — ✅ PASS | 2026-08-22

- Command: pnpm --filter @robota-sdk/agent-framework exec vitest run
  `src/checkpoints/__tests__/edit-checkpoint-store.test.ts`.
- Result: exit 0; 1/1 test file and 11/11 tests passed, covering mismatched mutation rejection, snapshot capture,
  inspection, restore, rollback, branch/list behavior, legacy migration, and active-branch restoration.
- Test reference: `packages/agent-framework/src/checkpoints/__tests__/edit-checkpoint-store.test.ts` >
  "rejects a mutation capability minted for a different project authority" and "Given checkpoints When
  inspecting a checkpoint Then captured files and restore plans are returned".

### [GATE-COMPLETE: TC-08] — ✅ PASS | 2026-08-22

- Commands: pnpm --filter @robota-sdk/agent-session exec vitest run
  `src/__tests__/session-log-source-contract.test.ts`; pnpm --filter @robota-sdk/agent-provider-replay exec
  vitest run `src/__tests__/replay-provider.test.ts`.
- Result: both commands exited 0; the neutral session-source contract passed 2/2 tests and replay passed 7/7,
  including explicit-source hydration, bare-path rejection, unresolved-reference rejection, and explicit nested
  response hydration.
- Test references: `packages/agent-session/src/__tests__/session-log-source-contract.test.ts` >
  "loads and hydrates through explicit neutral sources" and "does not accept a bare file path as project
  authority"; `packages/agent-provider-replay/src/__tests__/replay-provider.test.ts` >
  "ARCH-014: direct construction hydrates nested response references with an explicit base".

### [GATE-COMPLETE: TC-09] — ✅ PASS | 2026-08-22

- Commands: pnpm --filter @robota-sdk/agent-cli exec vitest run
  `src/startup/__tests__/workspace-project-composition.test.ts`; pnpm --filter
  @robota-sdk/agent-transport exec vitest run `src/__tests__/programmatic/programmatic-driver.test.ts`; pnpm --filter
  @robota-sdk/agent-transport scenario:verify; pnpm --filter @robota-sdk/agent-transport-tui scenario:verify.
- Result: all commands exited 0; CLI passed 3/3 tests and transport passed 4/4. The transport scenario observed
  contextRefreshFiles ["AGENTS.md"], explicit checkpoint/branch events and cleanup; the TUI scenario rendered
  "Context refreshed: AGENTS.md", preserved committed-operation failure reporting, and cleaned up.
- Test references: `packages/agent-cli/src/startup/__tests__/workspace-project-composition.test.ts` >
  "keeps project sources and state absent when the initial decision is restricted" and "derives project readers
  and state only from the supplied trusted authority";
  `packages/agent-transport/src/__tests__/programmatic/programmatic-driver.test.ts` >
  "passes an explicit trusted project decision through the programmatic runtime".
  Durable scenario records:
  packages/agent-transport/examples/scenarios/session-event-delivery.record.json and
  packages/agent-transport-tui/examples/scenarios/session-event-rendering.record.json.

### [GATE-COMPLETE: TC-10] — ✅ PASS | 2026-08-22

- Command: pnpm exec vitest run `scripts/harness/__tests__/scan-public-project-authority.test.mjs`.
- Result: exit 0; 1/1 test file and 10/10 tests passed. The suite passed seven RED rejection fixtures, the GREEN
  authority-derived-port fixture, examined-population reporting, and registration/live-governed-tree execution.
- Test reference: `scripts/harness/__tests__/scan-public-project-authority.test.mjs` >
  "public-project-authority AST guard", including "GREEN: accepts authority-derived ports, Restricted
  construction, and explicit host adapters" and "is registered and passes against the live governed tree".

### [GATE-COMPLETE: TC-11] — ✅ PASS | 2026-08-22

- Commands: pnpm harness:verify-like-ci; independent guardian corroboration with pnpm build and pnpm test.
- Result: the fresh repository verification exited 0 with all 12/12 stages passing, including format, scans,
  workspace build/typecheck/tests, affected verification, examples, binary E2E, and TUI PTY. The guardian's
  separate root pnpm build completed all package JavaScript/ordered type builds with exit 0, and pnpm test
  completed the recursive 104-project workspace scope with exit 0.
- Verification reference: the Test Plan's command-driven release row is satisfied by the exact commands above;
  package-level concrete test paths and names for TC-01 through TC-10 are recorded in their entries, and the
  checked owner SPEC/architecture/README/example changes are included in the fresh 12-stage run.

### [GATE-COMPLETE] — ✅ PASS | 2026-08-22

**Status upgrade:** verifying → done

- Ordering: the prior [GATE-VERIFY] entry records ✅ PASS; the document has the expected input
  status: verifying and remains in .agents/spec-docs/active/.
- Completion Criteria: TC-01 through TC-11 are all checked [x], and each has a matching
  [GATE-COMPLETE: TC-N] entry above with its exact command/action, observed result, and exit code.
- Test Plan: all 11 rows contain a concrete test path plus test/describe name, or the concrete command-driven
  release verification for TC-11; no TC is silently unaddressed and no manual skip is used.
- Tasks: the spec's checked Tasks pointer names
  .agents/tasks/ARCH-042-public-sdk-project-authority-is-ambient.md; that active Task exists, TC-01 through TC-11
  are all [x], and no task is blocked or pending.
- User execution: the Task records [DONE-GATE-STAGE-2] ✅ PASS with the maintained public-SDK scenario command,
  exact Restricted/trusted JSON observation, exit 0, durable example path, and successful cleanup.
- Post-PASS handoff: Task terminal status/date, Task archival, archived pointer, and the spec's active/verifying to
  done/done transition remain orchestrator-owned PASS outputs and were not performed by this guardian.
