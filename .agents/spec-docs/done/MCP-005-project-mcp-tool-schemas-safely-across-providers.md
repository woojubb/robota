---
status: done
type: BEHAVIOR
lane: L2
issue: 2528
tags: [mcp, typescript]
---

# MCP-005: project MCP tool schemas safely across providers

## Problem

A third-party MCP tool's `inputSchema` reaches each provider's request through four independently
written converters that disagree with each other and with the provider APIs:

- `packages/agent-provider-anthropic/src/anthropic/message-converter.ts:135-141` casts
  `tool.parameters` straight into `input_schema` — whatever `anyOf`/`additionalProperties` the subset
  carries is sent as-is;
- `packages/agent-provider-openai-compatible/src/shared/openai-compatible/message-converter.ts:19-36`
  shallow-spreads `parameters` (the spread exists for a TypeScript index signature, not for safety);
- `packages/agent-provider-openai/src/openai/responses-converter.ts:39-58` closes objects with
  `closeObjectSchemas` only when `strictTools` is on, otherwise passes through;
- `packages/agent-provider-gemini/src/gemini/tool-schema-converter.ts:21-105` rebuilds the schema
  field by field and silently drops any member it does not copy (`additionalProperties` today; its own
  comment at `:79-82` names the fragility).

No layer quarantines ONE tool: a schema a provider rejects surfaces as an HTTP 400 for the WHOLE
request (Anthropic, OpenAI) or as a silently narrowed tool (Gemini). Reproduction: register an MCP tool whose `inputSchema` has a typed root with a property carrying `patternProperties` (or `$defs`) — CORE-040's `narrowNode` spreads a typed node through with every foreign key intact (`third-party-schema.ts:77,89`) — and call the OpenAI Responses provider with `strictTools: true`: the request fails with `Invalid schema for function` and every other tool on the turn is lost with it. The catalog's
`adopted`/`adapted`/`rejected` dispositions (`packages/agent-mcp/src/catalog/types.ts:93,148-157`)
exist only for naming collisions and unsupported transports; CORE-040's narrowing
(`packages/agent-mcp/src/third-party-schema.ts:32-115`) removes what `IParameterSchema` cannot express
(a node with neither a known `type` nor `anyOf`) but spreads every other keyword through and does not know any provider's accepted subset, and issue
#2528 says plainly that CORE-040 "does not own model-facing provider projection".

## Prior Art Research

Researched from product documentation only (`research.md`); `prior-art-researcher`, 2026-09-22,
terminal signal `PRIOR_ART_RESEARCH: FOUND`.

| Reference                                                                                      | Type          | URL                                                                                                                                                        |
| ---------------------------------------------------------------------------------------------- | ------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Anthropic — implement tool use (`tools[].input_schema`) · structured outputs (strict tool use) | product docs  | https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/implement-tool-use · https://platform.claude.com/docs/en/build-with-claude/structured-outputs |
| OpenAI — function calling · structured outputs "Supported schemas" (strict mode)               | product docs  | https://developers.openai.com/api/docs/guides/function-calling · https://developers.openai.com/api/docs/guides/structured-outputs                          |
| Google — Gemini function calling / structured output (`Schema` subset, `parametersJsonSchema`) | product docs  | https://ai.google.dev/gemini-api/docs/function-calling · https://ai.google.dev/gemini-api/docs/structured-output                                           |
| MCP specification (draft) — Tools: `inputSchema` / `outputSchema`                              | protocol spec | https://modelcontextprotocol.io/specification/draft/server/tools                                                                                           |
| Gemini CLI — MCP servers (per-tool schema sanitisation)                                        | product docs  | https://google-gemini.github.io/gemini-cli/docs/tools/mcp-server.html                                                                                      |
| OpenAI Agents SDK — MCP (`convert_schemas_to_strict`, best-effort with fallback)               | product docs  | https://openai.github.io/openai-agents-python/mcp/                                                                                                         |

Claude Code's own docs describe no sanitisation step; issue-tracker reports of silently dropped tools on
root combinators are weak evidence and were used only as corroboration, never as a design basis.

**Observed common behaviour.**

- _Protocol side._ MCP requires `inputSchema.type === 'object'`, defaults the dialect to JSON Schema
  2020-12, allows every composition keyword (`anyOf`/`oneOf`/`allOf`/`$ref`) and sets no size or
  depth ceiling. The incompatibility lives entirely at the provider boundary.
- _Provider side._ Each provider documents a different accepted subset: Anthropic accepts standard
  JSON Schema with an `object` root (strict tool use shares the structured-output limitations);
  OpenAI strict mode names its supported subset (`additionalProperties: false` on every object, every
  property `required`, optionality expressed as `anyOf` with `null`) and offers non-strict as the
  documented escape hatch; Gemini's `Schema` type is an OpenAPI-3.0 subset that historically had no
  `anyOf`, with `parametersJsonSchema` documented (Jan 2026) as the wider opt-in path.
- _Host side._ Every host that documents a transform does it PER TOOL with a fallback: Gemini CLI
  strips `$schema`/`additionalProperties`/`default`-under-`anyOf` recursively and filters out only
  the tool that still fails; the OpenAI Agents SDK converts to strict best-effort and keeps the
  original schema for a tool it cannot convert. No documented host fails a whole server for one
  tool's schema.

**Constraints for Robota.** A single global sanitiser cannot be correct for three differently
documented subsets — the projection must be per provider. A tool that cannot be projected must be
quarantined alone and visibly (a structured diagnostic), never dropped silently and never allowed to
fail the turn's other tools. The MCP-side narrowing (CORE-040) stays the one validator of untrusted
schemas; projection must not become a second one, and it must never widen what execution accepts.

**Recommendation.** One provider-neutral projection contract and one shared, tested projector in the
package every consumer already depends on; each provider declares its constraints as data and calls the
shared projector from its existing converter; a rejected tool is omitted from that request with one
structured diagnostic naming provider, model, tool, path and keyword; runtime argument validation stays
on the CORE-040 schema.

## Architecture Review

### Affected Scope

- `packages/agent-core` — `src/schema/project-tool-schema.ts` (new: the contract
  `IToolSchemaProjectionProfile`, `IToolSchemaProjection`, `projectToolSchema()`, the two shared profile
  constants), reusing `src/schema/close-object-schemas.ts` (PROV-007) as its closure step and
  `createLogger('ToolSchemaProjection')` (`src/utils/logger.ts:230`, the CORE-040 precedent at
  `agent-mcp/src/third-party-schema.ts:29`) as the diagnostic sink; `src/abstracts/abstract-ai-provider.ts`
  (edit: `projectionProfile()` seam and `projectTools()` helper with the instance memo); `src/schema/index.ts`
  - `src/index.ts` (exports); `docs/SPEC.md`.
- `packages/agent-provider-anthropic` — `src/anthropic/provider.ts` (profile; request sites `:138`, `:235`),
  `message-converter.ts:135-141`; `docs/SPEC.md`.
- `packages/agent-provider-openai` — `src/openai/provider.ts` (profile: strict vs non-strict),
  `responses-chat.ts:155-158` and `chat-completions-chat.ts:157` (the two request-building sites),
  `responses-converter.ts:39-58` (its own closure call goes), `message-converter.ts`; `docs/SPEC.md`.
- `packages/agent-provider-openai-compatible` — `src/shared/openai-compatible/request-builder.ts:78-79`
  (request site), `message-converter.ts:19-36`, `src/qwen/responses-chat.ts:158` +
  `src/qwen/responses-converter.ts:45-56` (the Qwen Responses surface, live when built-in web tools are on,
  `qwen/provider.ts:275-276`), the three provider classes (`gemma`, `qwen`, `deepseek`: profile);
  `docs/SPEC.md`.
- `packages/agent-provider-gemini` — `src/gemini/provider.ts` (profile), `execution-helpers.ts:134-135`
  (request site), `tool-schema-converter.ts:21-105` (fed the projected schema; its root rebuild at
  `:25-29` no longer drops members silently because the profile's `unsupportedMembers` recorded them);
  `docs/SPEC.md`.
- `packages/agent-provider-replay` — NOT edited: no profile means "adopt unchanged", the default
  (TC-06). `agent-provider-bytedance` implements `IVideoGenerationProvider` and consumes no tool
  schema, so it is off this seam entirely.
- `packages/agent-mcp` — NOT edited. Discovery, catalog and CORE-040 narrowing are unchanged;
  `DiscoveredMCPTool` keeps validating arguments against the narrowed original (TC-11). Its silent
  root coercion (`catalog/discovered-tool.ts:61-66`) and `narrowNode`'s unwalked `anyOf` branches
  (`third-party-schema.ts:95`) are a separate root item (below), not folded in.
- Shared fixtures: `packages/agent-core/src/schema/__tests__/fixtures/tool-schema-projection/` (new),
  imported by every provider conformance test.

Sibling scan — REQUEST-BUILDING SITES, not classes (`proposal-reviewer`, 2026-09-22, found the class
count hid one): `anthropic/provider.ts:138,235`; `openai/responses-chat.ts:155-158`;
`openai/chat-completions-chat.ts:157`; `openai-compatible/shared/request-builder.ts:78-79`;
`qwen/responses-chat.ts:158`; `gemini/execution-helpers.ts:134-135` — six sites in five files, each
listed in TC-13. The class list (`grep -rln "extends AbstractAIProvider" packages/agent-provider-*/src`
→ anthropic, gemini, gemma, qwen, deepseek, openai, replay) is the set that declares a profile.

### Alternatives Considered

1. **Provider-specific rewriting inside each converter (status quo, extended).** Pro: no new
   contract. Con: five divergent, untested implementations already exist (the Qwen Responses converter
   is the fifth); a sixth provider repeats the drift; there is no place for a per-tool quarantine or a
   diagnostic. Rejected.
2. **Project in `agent-mcp` at catalog build, once per server.** Pro: provenance (server id) is in
   hand. Con: the catalog cannot know which provider a session will use, and `agent-mcp` and the
   providers are dependency siblings rooted only in `agent-core` — a provider-aware step there would
   need an `agent-mcp → provider` edge that `check-dependency-direction` refuses, and non-MCP
   third-party tools would stay unprotected. Rejected.
3. **A new `agent-provider-base` / `agent-interface-provider` package for the contract.** Pro: a
   named home. Con: `project-structure.md:302` lists `agent-interface-provider` as future work and
   `:120` states the convention "define the interface in agent-core, implement in the plugin";
   `closeObjectSchemas` (PROV-007) already lives in `agent-core/src/schema` and is the proven
   precedent. Rejected for this unit; revisit only if a second cross-provider contract appears.
4. **Contract + projector in `agent-core`, profile per provider, `projectTools()` called at each of
   the six request-building sites, per-tool quarantine with a memoised diagnostic on a global-sink
   logger; CORE-040 stays the single argument validator; execution validation untouched.** Pro: one
   recursion, one fixture set, one place a sixth provider plugs into; every consumer already depends on
   `agent-core`; the diagnostic is audible without an injected logger. Con: the call is a helper the
   provider author must remember (today `validateTools` is skipped by three providers — a root item
   below); TC-13 makes forgetting it a red test rather than a silent gap. Con: a provider constraint the
   profile vocabulary cannot express needs a vocabulary change — accepted, because that change is then
   visible and tested once. **Chosen.**

### Decision

Alternative 4, after `proposal-reviewer` (2026-09-22, REVISE → the corrections below: request sites
not classes, `unknownKeywords: 'adopt'`, `unsupportedMembers`, structural-keyword replacement, object
root universal, global-sink logger, `Schema note` only for lossy strips, reproduction rewritten).

**Delivery mode:** `single`

**Contract (`agent-core/src/schema/project-tool-schema.ts`).**

```ts
export interface IToolSchemaProjectionProfile {
  readonly providerName: string; // named in the Schema note and the quarantine line
  readonly closedObjects: boolean; // additionalProperties:false on every object node
  readonly requireAllProperties: boolean; // every property listed in `required`
  readonly optionalAsNullable: boolean; // an optional property becomes anyOf [T, null]
  /** Keywords outside the IParameterSchema member set: pass through, remove/replace, or refuse. */
  readonly unknownKeywords: 'adopt' | 'strip' | 'reject';
  /** Subset members this provider's wire type cannot carry — stripped AND recorded (Gemini: additionalProperties). */
  readonly unsupportedMembers: readonly (keyof IParameterSchema)[];
  readonly maxDepth: number; // > → rejected (unbounded complexity)
  readonly maxNodes: number; // > → rejected
}
export type TToolSchemaProjectionOutcome = 'adopted' | 'adapted' | 'rejected';
export interface IToolSchemaProjectionChange {
  readonly path: string;
  readonly kind:
    | 'closed-object'
    | 'required-added'
    | 'nullable-added'
    | 'keyword-stripped'
    | 'keyword-replaced'
    | 'member-stripped';
  readonly keyword?: string;
}
export interface IToolSchemaProjection {
  readonly outcome: TToolSchemaProjectionOutcome;
  readonly tool: IToolSchema; // adopted: the input; adapted: the projected copy; rejected: the input
  readonly changes: readonly IToolSchemaProjectionChange[];
  readonly rejection?: { readonly path: string; readonly keyword: string; readonly reason: string };
}
export function projectToolSchema(
  tool: IToolSchema,
  profile: IToolSchemaProjectionProfile,
): IToolSchemaProjection;
```

`projectToolSchema` is pure and deterministic (same input → deep-equal output), never throws, and
never mutates its input. Refusals, all `rejected` with `path` + `keyword` + `reason`, in this order: a
`parameters` root that is not `type: 'object'` (universal — no documented provider accepts another
root, so it is not a profile field); a property name in `{ '__proto__', 'constructor', 'prototype' }`
(prototype keys); an object graph that revisits a node (cycles — reachable from in-process tools, not
from parsed JSON); depth over `maxDepth`; node count over `maxNodes`; `unknownKeywords: 'reject'` with
any key outside the `IParameterSchema` member set (`tool-schema.ts:48-104` is the SSOT; the member
list is derived from it once and exported, never hand-typed twice). A node declaring both `type` and `anyOf`, or neither, is `rejected` at its path (the subset SSOT forbids it, `tool-schema.ts:39-42`; the catalog side is root item CATALOG-2525) — universal, so Gemini's root rebuild never meets a root `anyOf` it would drop unrecorded. Adaptations, all `adapted` with one change per edit: `unknownKeywords: 'strip'` applies ONE mechanical rule, no hand-typed keyword list — delete the foreign keyword; if the node is then left with neither `type` nor `anyOf` (a node that was only `$ref`, `oneOf` or `allOf`), REPLACE the node by the accept-anything `anyOf` node CORE-040 uses (`third-party-schema.ts:50-61`) and record `keyword-replaced`; otherwise record `keyword-stripped` (so `$defs` or `patternProperties` on a typed node is stripped and the node's `type`/`properties` survive); `unsupportedMembers` strips each listed subset member wherever it appears and records
`member-stripped`; the closure family delegates to `closeObjectSchemas` (one recursion, not a copy)
and records `closed-object` / `required-added` / `nullable-added` per path. `unknownKeywords: 'adopt'`
passes foreign keywords through untouched (Anthropic and OpenAI non-strict accept standard JSON
Schema; stripping there would be lossy for nothing). The `description` gains ONE deterministic trailing
paragraph — `Schema note: <n> constraint(s) not shown to <providerName>: <kind@path>, …` — ONLY when a `keyword-stripped`, `keyword-replaced` or `member-stripped` change removed a VALIDATION keyword (one that constrains accepted values — `minLength`, `pattern`, `additionalProperties`, a replaced `$ref`/`oneOf`/`allOf` node, …); a stripped annotation (`title`, `$schema`, `$comment`, `examples`, `default`) constrains nothing and produces no note; closure changes (`closed-object`, `required-added`, `nullable-added`) are
visible in the schema itself and never produce a note, so under OpenAI strict a tool's description is
byte-identical to its input (TC-04, TC-08).

**Projection step (`AbstractAIProvider`).** `protected projectionProfile(): IToolSchemaProjectionProfile | undefined`
returns `undefined` by default (adopt everything unchanged, no diagnostics — replay and any embedding
provider keep today's behaviour, TC-06). `protected projectTools(tools: IToolSchema[] | undefined, model: string): IToolSchema[] | undefined`
is a helper the concrete provider calls at each request-building site after `validateTools` and before
its converter (the base's `chat`/`chatStream` are abstract, `abstract-ai-provider.ts:117,153`, so the
base runs nothing itself — the six sites are enumerated above and TC-13 turns a forgotten call into a
red test): with a profile, every tool is projected; `adopted`/`adapted` tools are returned (adapted
copies replace the originals in the returned array only — `options.tools` is never mutated); a
`rejected` tool is omitted from the request and reported ONCE per cache identity as one structured line
`tool_schema_quarantined provider=<name> model=<model> tool=<tool.name> path=<path> keyword=<keyword> reason=<reason>`
through `createLogger('ToolSchemaProjection').warn` — the global-sink logger, because `AnthropicProvider`
(`provider.ts:74`) and `GeminiProvider` (`provider.ts:54`) construct with no logger and `this.logger`
is then `SilentLogger` (`abstract-ai-provider.ts:89`), which would make the quarantine silent on two of
four providers ("Silence is not success"). Cache identity = `provider.name` + `model` + `tool.name` + a
stable hash of `tool.parameters` over canonical, key-sorted JSON; the memo is an instance `Map` (never
a module singleton), so a re-registered tool with a changed schema is judged and reported again while
an unchanged one is not re-reported on every turn. Provenance at this boundary is the
catalog-qualified tool name (`<server>__<tool>` for MCP tools); `IToolSchema` carries no server field
(`tool-schema.ts:77-104`) and this unit does not add one (a decision recorded, not an omission).

**Profiles.** `PERMISSIVE`: `{ closedObjects: false, requireAllProperties: false, optionalAsNullable: false, unknownKeywords: 'adopt', unsupportedMembers: [], maxDepth: 32, maxNodes: 2000 }`
— Anthropic (`providerName: 'anthropic'`), OpenAI Chat Completions and Responses without `strictTools`,
and the openai-compatible family (gemma, qwen incl. its Responses surface, deepseek), each with its
own `providerName`. `STRICT`: `{ closedObjects: true, requireAllProperties: true, optionalAsNullable: true, unknownKeywords: 'strip', unsupportedMembers: [], … }`
— OpenAI Responses and Chat Completions with `strictTools: true` (this REPLACES the converter's own
`closeObjectSchemas` call at `responses-converter.ts:49-54` — one closure, in one place; the emitted
`strict: true` request field stays). Gemini: `{ …PERMISSIVE, providerName: 'gemini', unknownKeywords: 'strip', unsupportedMembers: ['additionalProperties'] }`
so every member `convertParameterSchema` cannot carry is stripped-and-recorded before the rebuild sees
it (TC-10). The depth and node ceilings are the same for every profile and are named constants.

**What does not change.** `agent-mcp` discovery, catalog build and CORE-040 narrowing;
`DiscoveredMCPTool`'s `ThirdPartySchemaValidator` still validates every call's arguments against the
narrowed ORIGINAL, so a projection can never widen accepted execution input (TC-11 — the strict
profile's `null` compensation for optional fields is a pre-existing PROV-007 behaviour that execution
refuses; recorded as a root item, not changed here); the `IAIProvider` public interface (the seam is on
the abstract base, protected); `IToolSchema` / `IParameterSchema` (CORE-039 SSOT); `outputSchema`
handling (MCP allows the full 2020-12 surface there and no provider constrains it — out of scope, as
issue #2528's non-goals imply).

**Validated before approval (contract-boundary change).** Reachability: every request-building site
was enumerated by reading the provider sources, not by class (the six above); an embedding provider
that overrides nothing keeps today's behaviour. Capability preservation: `closeObjectSchemas` keeps its
signature and tests; the OpenAI strict path produces byte-identical `parameters` to today for fixtures
without a rejection (TC-08). Adversarial pass: a malicious `__proto__` property → rejected before any
spread (TC-02); a 10 000-node schema → rejected by `maxNodes`, never walked to completion (TC-02); a
`$ref` under `strip` → replaced, not deleted, so the output stays subset-valid (TC-03, TC-12); one bad
tool among many → only it is quarantined, and the line is audible with no injected logger (TC-05); a
provider with no profile → unchanged (TC-06); a forgotten `projectTools` call → TC-13 red.

Separate root items filed rather than folded in (`finding-depth.md`): `PROV-2138-abstract-provider-request-pipeline-is-a-convention`
(three providers skip `validateTools`; a template-method base owning validate → project → delegate),
`CATALOG-2525-catalog-root-coercion-and-unwalked-anyof-branches` (`toObjectParameterSchema` silently turns
a non-object root into accept-anything for model and execution; `narrowNode` does not walk `anyOf`
branches, so a branch with `oneOf` makes execution refuse every payload), and
`CLOSURE-2138-strict-null-compensation-vs-execution-refusal` (PROV-007's `optionalAsNullable` invites a
`null` the CORE-040 validator refuses — the very behaviour TC-11 asserts as unchanged).

### Architecture Review Checklist

- [x] 영향 패키지/레이어 목록 작성 완료
- [x] Sibling scan 완료 — request-building sites 전수(6곳, 5파일) + `extends AbstractAIProvider` 전수(anthropic, gemini, gemma/qwen/deepseek, openai, replay)
- [x] 대안 최소 2개 검토 완료
- [x] 결정 근거 문서화 완료

## Fallback & Degradation Declaration

None. A rejected tool is a reported quarantine, not a fallback: it is omitted from that request with a
structured diagnostic and never sent in another shape. A provider without a profile is the declared
default (adopt unchanged), not a degradation.

## Solution

1. `agent-core`: add `project-tool-schema.ts` (contract, constants, the two profiles, `projectToolSchema`,
   with the both/neither refusal applied to a node that has `type` and `anyOf` or NO keyword the policy keeps — under `'adopt'` a `$ref`-only node passes through as standard JSON Schema,
   the stable hash, the derived `IParameterSchema` member list), export it from `schema/index.ts` and the
   barrel; add the shared fixture set under `schema/__tests__/fixtures/tool-schema-projection/`
   (combinators, structural keywords, annotations, nested objects/arrays, prototype keys, deep nesting,
   oversized, non-object root, one-invalid-among-many) with a small loader.
2. `agent-core`: `AbstractAIProvider.projectionProfile()` / `projectTools()` with the instance memo and
   the structured `warn` line on `createLogger('ToolSchemaProjection')`.
3. Providers: declare the profile; call `this.projectTools(tools, model)` at each of the six
   request-building sites before the converter; `responses-converter.ts` drops its own closure call;
   Gemini's converter consumes the projected schema. One conformance test per package over the shared
   fixtures.
4. SPEC/README layers for `agent-core` and the four provider packages name the contract, the profile
   and the quarantine diagnostic.

## Affected Files

- `packages/agent-core/src/schema/project-tool-schema.ts` (new), `src/schema/index.ts`, `src/index.ts`, `src/abstracts/abstract-ai-provider.ts` (edit), `src/schema/__tests__/project-tool-schema.test.ts` (new), `src/schema/__tests__/fixtures/tool-schema-projection/*` (new), `src/abstracts/__tests__/abstract-ai-provider-projection.test.ts` (new), `docs/SPEC.md`
- `packages/agent-provider-anthropic/src/anthropic/provider.ts`, `message-converter.ts`, `src/anthropic/__tests__/tool-schema-projection.test.ts` (new), `docs/SPEC.md`
- `packages/agent-provider-openai/src/openai/provider.ts`, `responses-chat.ts`, `chat-completions-chat.ts`, `responses-converter.ts`, `src/openai/__tests__/tool-schema-projection.test.ts` (new), `src/openai/__tests__/strict-tools-closure.test.ts` (edit), `docs/SPEC.md`, `examples/verify-tool-schema-projection.ts` (new, behind `scenario:verify:tool-schema-projection` — the Task's Scenario 1)
- `packages/agent-provider-openai-compatible/src/shared/openai-compatible/request-builder.ts`, `message-converter.ts`, `src/qwen/responses-chat.ts`, `src/qwen/responses-converter.ts`, `src/{gemma,qwen,deepseek}/provider.ts`, `src/shared/openai-compatible/tool-schema-projection.test.ts` (new), `docs/SPEC.md`
- `packages/agent-provider-gemini/src/gemini/provider.ts`, `execution-helpers.ts`, `tool-schema-converter.ts`, `src/gemini/tool-schema-projection.test.ts` (new), `docs/SPEC.md`
- `packages/agent-mcp/src/__tests__/discovered-tool-execution-validation.test.ts` (new test only; no production change)
- `.agents/tasks/PROV-2138-abstract-provider-request-pipeline-is-a-convention.md`, `.agents/tasks/CATALOG-2525-catalog-root-coercion-and-unwalked-anyof-branches.md`, `.agents/tasks/CLOSURE-2138-strict-null-compensation-vs-execution-refusal.md` (new root items)

## Completion Criteria

- [x] TC-01: `pnpm exec vitest run packages/agent-core/src/schema/__tests__/project-tool-schema.test.ts` → exits 0 — a subset-only schema projects `adopted` with `changes: []`, `tool` deep-equal to the input, and two calls on structurally equal inputs (including key order permuted) return deep-equal outputs (determinism); the input object is not mutated
- [x] TC-02: same file → exits 0 — a non-`object` root, a node declaring both `type` and `anyOf` (or neither), a `__proto__`/`constructor`/`prototype` property name, an object graph with a cycle, nesting deeper than `maxDepth`, and a schema with more than `maxNodes` nodes each project `rejected` with `rejection.path`, `rejection.keyword` and a reason naming the ceiling, the key or the root rule; `projectToolSchema` never throws across the fixture set
- [x] TC-03: same file → exits 0 — under `unknownKeywords: 'adopt'` a `title`/`minLength`/`patternProperties` key projects `adopted` and the output carries it unchanged, and a node carrying only foreign structural keywords (`$ref`-only) is likewise adopted unchanged — the both/neither refusal is for a node with `type` AND `anyOf`, or with no keyword the policy keeps at all; under `'strip'` an annotation key (`title`, `$schema`, `minLength`) projects `adapted` with one `keyword-stripped` change per path and a node that was only `$ref` (or only `oneOf`/`allOf`) projects `adapted` with one `keyword-replaced` change at that path and the node became the accept-anything `anyOf` node, while `$defs`/`patternProperties`/`not` on a typed node project `adapted` with one `keyword-stripped` change each and the node keeps its `type` and `properties`; under `'reject'` the first offending path is named; `unsupportedMembers: ['additionalProperties']` strips every `additionalProperties` occurrence with one `member-stripped` change each
- [x] TC-04: same file → exits 0 — under `closedObjects` / `requireAllProperties` / `optionalAsNullable` the projected `parameters` deep-equal `closeObjectSchemas(input.parameters, { requireAllProperties: true, optionalAsNullable: true })`, `changes` lists one entry per closed object / added required / nullable property, and `description` is byte-identical to the input (closure never produces a note); a `keyword-replaced`, `member-stripped` or validation-keyword `keyword-stripped` projection ends its description with exactly one `Schema note:` paragraph naming `<providerName>` and each `kind@path`, and a projection that stripped only annotations (`title`, `$schema`, `examples`) has a description byte-identical to the input
- [x] TC-05: `pnpm exec vitest run packages/agent-core/src/abstracts/__tests__/abstract-ai-provider-projection.test.ts` → exits 0 — a test subclass constructed WITHOUT a logger (so `this.logger` is `SilentLogger`) and with a profile, given three tools of which one is rejected, passes exactly two tools to its converter, the omitted one is the rejected tool, and the `ToolSchemaProjection` global logger sink captured exactly one `warn` whose message contains `tool_schema_quarantined`, `provider=`, `model=`, `tool=<name>`, `path=` and `reason=`; a second call with the same tools and model adds no second `warn`; the same tool re-registered with a different `parameters` produces a new `warn`; `options.tools` is unchanged after the call
- [x] TC-06: same file → exits 0 — a subclass whose `projectionProfile()` returns `undefined` passes every tool through unchanged (same array elements) and the sink receives no `warn`
- [x] TC-07: `pnpm exec vitest run packages/agent-provider-anthropic/src/anthropic/__tests__/tool-schema-projection.test.ts` → exits 0 — over the shared fixtures the Anthropic converter's `tools[].input_schema` equals the projected `parameters` for every adopted/adapted fixture (annotation and `patternProperties` keys pass through under `'adopt'`), the non-object-root, prototype-key and oversized fixtures are absent from the request, and one quarantine `warn` per absent fixture names it; both request sites (`provider.ts:138`, `:235`) are exercised
- [x] TC-08: `pnpm exec vitest run packages/agent-provider-openai/src/openai/__tests__/tool-schema-projection.test.ts packages/agent-provider-openai/src/openai/__tests__/strict-tools-closure.test.ts` → exits 0 — with `strictTools: true` the Responses and Chat Completions converters' `parameters` are byte-identical to today's `closeObjectSchemas(input, { requireAllProperties: true, optionalAsNullable: true })` for every fixture without a rejection and their `description` is byte-identical to the input (the converter no longer closes schemas itself: `grep -n closeObjectSchemas packages/agent-provider-openai/src/openai/responses-converter.ts` is empty), and with `strictTools` off both paths carry the permissive projection; both the `chat` and `chatStream` request paths of each converter are exercised
- [x] TC-09: `pnpm exec vitest run packages/agent-provider-openai-compatible/src/shared/openai-compatible/tool-schema-projection.test.ts` → exits 0 — gemma, qwen and deepseek each declare the permissive profile with their own `providerName`; the shared request builder AND the Qwen Responses converter (`qwen/responses-converter.ts`) receive projected schemas (rejected fixtures absent, one `warn` each); both the `chat` and `chatStream` request paths are exercised
- [x] TC-10: `pnpm exec vitest run packages/agent-provider-gemini/src/gemini/tool-schema-projection.test.ts packages/agent-provider-gemini/src/gemini/tool-schema-converter.test.ts` → exits 0 — for every fixture member `convertParameterSchema` omits, the projection's `changes` already holds a `member-stripped` or `keyword-stripped`/`keyword-replaced` entry at that path (no silent drop, root included), and the converted `FunctionDeclaration.parameters` deep-equal the field rebuild of the projected schema; both the `chat` and `chatStream` request paths are exercised
- [x] TC-11: `pnpm exec vitest run packages/agent-mcp/src/__tests__/discovered-tool-execution-validation.test.ts` → exits 0 — a `DiscoveredMCPTool` whose narrowed schema has an optional non-nullable `string` property refuses `{ prop: null }` with a validation error even though the strict projection of the same schema accepts `null`; `git diff --stat origin/integration/agreement-014...HEAD -- packages/agent-mcp/src` lists only that test file
- [x] TC-12: `pnpm exec vitest run packages/agent-core/src/schema/__tests__/project-tool-schema.test.ts` → exits 0 — a deterministic generator (seeded, 500 cases) of random subset schemas with injected structural and annotation keywords, unsupported members, prototype keys, non-object roots and depth spikes yields, for every case and every one of the three profiles (`PERMISSIVE`, `STRICT`, Gemini's), an outcome in `{adopted, adapted, rejected}`, no thrown error, and for `adopted`/`adapted` a `parameters` value that `validateAgainstJsonSchema` accepts as a subset schema
- [x] TC-13: `grep -rn "closeObjectSchemas(" packages/agent-provider-*/src --include='*.ts' | grep -v test` → returns only `packages/agent-provider-anthropic/src/anthropic/output-schema.ts`; and `grep -rnE "projectTools\(" packages/agent-provider-anthropic/src/anthropic/provider.ts packages/agent-provider-openai/src/openai/responses-chat.ts packages/agent-provider-openai/src/openai/chat-completions-chat.ts packages/agent-provider-openai-compatible/src/shared/openai-compatible/request-builder.ts packages/agent-provider-openai-compatible/src/qwen/responses-chat.ts packages/agent-provider-gemini/src/gemini/execution-helpers.ts` (or the provider file that feeds each of these) returns a hit for all six request-building sites, and `grep -rnE "(options|chatOptions)\??\.tools" packages/agent-provider-*/src --include='*.ts' | grep -v test | grep -vE "projectTools|validateTools"` returns no site that hands unprojected tools to a converter (each remaining hit is listed in the test with its projected feeder)
- [x] TC-14: `pnpm --filter @robota-sdk/agent-core test && pnpm --filter @robota-sdk/agent-provider-anthropic test && pnpm --filter @robota-sdk/agent-provider-openai test && pnpm --filter @robota-sdk/agent-provider-openai-compatible test && pnpm --filter @robota-sdk/agent-provider-gemini test && pnpm --filter @robota-sdk/agent-mcp test && pnpm build` → exits 0, and `HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/run-all-scans.mjs --affected --context pr` reports no new blocking failure
- [x] TC-15: `grep -ln "projectToolSchema\|tool_schema_quarantined" packages/agent-core/docs/SPEC.md packages/agent-provider-anthropic/docs/SPEC.md packages/agent-provider-openai/docs/SPEC.md packages/agent-provider-openai-compatible/docs/SPEC.md packages/agent-provider-gemini/docs/SPEC.md` lists all five files, `ls .agents/tasks/PROV-2138-abstract-provider-request-pipeline-is-a-convention.md .agents/tasks/CATALOG-2525-catalog-root-coercion-and-unwalked-anyof-branches.md .agents/tasks/CLOSURE-2138-strict-null-compensation-vs-execution-refusal.md` lists all three root items, and `node scripts/harness/check-spec-public-surface.mjs` plus `node scripts/harness/check-spec-paths.mjs` exit 0

## Test Plan

Derived strategy: BEHAVIOR + `typescript` → vitest unit and conformance tests over a shared fixture
set; BEHAVIOR + `mcp` → the execution-validation test drives the real `DiscoveredMCPTool`.

| TC-ID | Test Type   | Tool / Approach                                           | Notes                                                            |
| ----- | ----------- | --------------------------------------------------------- | ---------------------------------------------------------------- |
| TC-01 | unit        | vitest over `projectToolSchema`                           | determinism + immutability                                       |
| TC-02 | unit        | vitest, refusal fixtures                                  | prototype keys, cycles, depth, node count; never throws          |
| TC-03 | unit        | vitest, combinator/keyword fixtures per profile           | adopt/reject/strip matrix                                        |
| TC-04 | unit        | vitest, equality with `closeObjectSchemas`                | one recursion; description note                                  |
| TC-05 | unit        | vitest over a test `AbstractAIProvider` subclass          | per-tool quarantine, memoised diagnostic, no input mutation      |
| TC-06 | unit        | vitest, subclass without profile                          | default adopt-unchanged                                          |
| TC-07 | conformance | vitest, Anthropic converter over shared fixtures          |                                                                  |
| TC-08 | conformance | vitest, OpenAI Chat + Responses (strict and non-strict)   | byte-identical strict output for non-rejected fixtures           |
| TC-09 | conformance | vitest, openai-compatible family                          |                                                                  |
| TC-10 | conformance | vitest, Gemini field rebuild vs projection changes        | no silent drop                                                   |
| TC-11 | integration | vitest over the real `DiscoveredMCPTool`                  | execution validation unchanged; `agent-mcp` production untouched |
| TC-12 | fuzz        | vitest, seeded generator (500 cases × 4 profiles)         | closed outcome set, no throw, subset-valid output                |
| TC-13 | command     | `grep` closure sites / projector consumers                |                                                                  |
| TC-14 | command     | package tests, `pnpm build`, affected scans               |                                                                  |
| TC-15 | command     | `grep` SPEC layers + `check-spec-public-surface`/`-paths` |                                                                  |

## User Execution Test Scenarios

**Author verdict:** `SCENARIO DRAFTED: automatable | 1`

### Scenario 1: one unprojectable MCP tool is quarantined with a diagnostic and the other tools still reach the provider

- Executability: agent-executable
- Product surface: public-sdk-example
- Surface rationale: shipped-interface=public-sdk-example
- Prerequisites: Node.js and pnpm are installed and `pnpm install` has completed; `@robota-sdk/agent-core` and `@robota-sdk/agent-provider-openai-compatible` are built; run from `packages/agent-provider-openai`; the example constructs the real `OpenAIProvider` with `strictTools: true` over a fake HTTP client that records the request and installs a capturing log sink, registers three tool schemas of which one carries a `__proto__` property name, and issues one `chat()`; no API key and no network are needed.
- Command: `pnpm exec tsx examples/verify-tool-schema-projection.ts`
- Observable type: sdk-result
- Observable rationale: source=public-sdk-return
- Expected observable: result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0
- Cleanup: the example uses only in-process fakes and removes its log sink before exiting; it leaves no files, processes or connections.
- Evidence: recorded 2026-09-22 — `cd packages/agent-provider-openai && pnpm scenario:verify:tool-schema-projection` → exit 0, single printed line `result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0`; durable runner `packages/agent-provider-openai/examples/verify-tool-schema-projection.ts`.

## Tasks

- [x] `.agents/tasks/completed/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` — done

## Evidence Log

### [GATE-WRITE] — ✅ PASS | 2026-09-22

**Status upgrade:** draft → review-ready

Ordering check: GATE-WRITE is the entry gate (no prior gate, per the Prior-gate map); document is under `draft/` with `status: draft`; `## Evidence Log` held 0 entries before this one. Mechanical set judged by `node scripts/harness/gate.mjs judge --gate GATE-WRITE --doc <path>` (re-run by the guardian: 20 PASS, 0 FAIL, 7 PENDING-GUARDIAN, no entry written); semantic set judged by `backlog-gate-guard` below. Tree premises judged against `origin/integration/agreement-014` @ `648521d83094235a8732ff38ebd41291d574c3f5` (the item's integration base; `origin/develop` named on the Judged-at line only for parser conformance).

- GATE-WRITE — File begins with `---` YAML frontmatter block: PASS (mechanical) — line 1 is `---`
- GATE-WRITE — `status: draft` present in frontmatter: PASS (mechanical) — `status: draft`
- GATE-WRITE — `type:` is exactly one value from the 11-prefix list: PASS (mechanical) — `type: BEHAVIOR`
- GATE-WRITE — `tags:` field present: PASS (mechanical) — `tags: [mcp, typescript]`
- GATE-WRITE — Contains a concrete symptom: PASS (semantic) — every cited location was checked at the integration base and says what the Problem claims: `agent-provider-anthropic/src/anthropic/message-converter.ts:135-141` casts `tool.parameters` to `input_schema` unchanged; `agent-provider-openai-compatible/.../message-converter.ts:19-36` shallow-spreads `parameters` with the comment explaining the spread is a type widening; `agent-provider-openai/src/openai/responses-converter.ts:39-58` calls `closeObjectSchemas` only when `strict`; `agent-provider-gemini/src/gemini/tool-schema-converter.ts:21-105` rebuilds from a fixed key list, its comment at `:79-82` says an uncopied member "is silently dropped", and `additionalProperties` is not among the copied keys; `agent-mcp/src/catalog/types.ts:93` is `TMCPCatalogDisposition` and `:148-157` is `IMCPCatalogRejection`; `agent-mcp/src/third-party-schema.ts:32-115` is the narrowing; issue #2528 contains verbatim "CORE-040 validates runtime schemas but does not own model-facing provider projection". The wrong behaviour is named: one rejected schema fails the whole request (HTTP 400) or is silently narrowed.
- GATE-WRITE — Contains a reproduction condition: PASS (semantic) — the Problem gives one: an MCP tool whose narrowed schema keeps a root `anyOf`, sent to the OpenAI Responses provider with `strictTools: true`, fails with `Invalid schema for function`. Verified the path: `third-party-schema.ts:65` treats an `anyOf` node as expressible so a root `anyOf` survives narrowing; `closeObjectSchemas` (`close-object-schemas.ts:78-139`) adds no `additionalProperties: false` at a root without `type: 'object'`, so the root union reaches OpenAI strict mode, whose documented supported subset requires an object root; `strictTools` is a real option (`agent-provider-openai/src/openai/types.ts:160`). Observation, not a failure: the closure DOES overwrite a boolean `additionalProperties: true` inside branch objects (`:130-136`, "Deliberate overwrite, including of an explicit `true`"), so in the stated repro the root `anyOf` is the trigger, not the `additionalProperties: true` detail.
- GATE-WRITE — Does not contain "TBD"/"TODO"/vague single-sentence descriptions: PASS (mechanical) — 1955 chars, no TBD/TODO
- GATE-WRITE — `## Prior Art Research` section present: PASS (mechanical)
- GATE-WRITE — Section substantiated (≥1 documentation source): PASS (mechanical) — 6 product-doc/protocol-spec references, `scan-spec-research` reports substantiated
- GATE-WRITE — OR `Waived:` line present: PASS (mechanical) — not needed; section substantiated
- GATE-WRITE — Research findings feed Alternatives Considered / Decision: PASS (semantic) — each research finding is consumed by a named design element: "Each provider documents a different accepted subset" → per-provider `IToolSchemaProjectionProfile` (Alt 4, Profiles); "every host that documents a transform does it PER TOOL with a fallback … no documented host fails a whole server" → per-tool quarantine and the rejection of Alt 1 (no place for a per-tool quarantine); OpenAI "non-strict as the documented escape hatch" → the permissive profile for Chat Completions and the compatible family; MCP spec "sets no size or depth ceiling" → `maxDepth`/`maxNodes`; MCP `outputSchema` unconstrained by any provider → declared out of scope. The recommendation is derived from these, not asserted.
- GATE-WRITE — All 4 checklist items `[x]`: PASS (mechanical)
- GATE-WRITE — Sibling scan `[x]` with evidence: PASS (mechanical) — evidence present. Guardian observation for GATE-APPROVAL reviewers, not a failed criterion: the enumeration is complete (`git grep "extends AbstractAIProvider"` at the base yields exactly anthropic, gemini, gemma, qwen, deepseek, openai, replay — the seven the document names), but the inheritance note is wrong: `OpenAIProvider extends AbstractAIProvider` directly (`agent-provider-openai/src/openai/provider.ts:34`), it does not "extend the compatible base" (it depends on the compatible package); and `agent-provider-bytedance` `implements IVideoGenerationProvider` and consumes no tool schema, so it is not on the seam at all rather than "adopt unchanged by default". Neither changes the Affected Scope (openai declares its own profile; bytedance is not edited) nor the reachability conclusion.
- GATE-WRITE — Alternatives Considered ≥2 entries with pro/con: PASS (mechanical) — 4 entries, each with Pro and Con
- GATE-WRITE — Decision references the trade-off that drove the choice: PASS (semantic) — Decision selects Alternative 4, whose entry names the accepted cost ("the profile is data, so a provider constraint the profile vocabulary cannot express needs a vocabulary change — accepted, because that change is then visible and tested once"); Alt 2 is rejected on a verified constraint (`scripts/harness/check-dependency-direction.mjs` exists; `agent-mcp` and providers are siblings under `agent-core`); Alt 3 is rejected on `project-structure.md:120` ("define the interface in agent-core, implement in a plugin") and `:302` (`agent-interface-provider` listed as future). The Decision also records two further trade-offs explicitly: provenance limited to the catalog-qualified name because `IToolSchema` has no server field (verified `interfaces/tool-schema.ts:77-80`) and the single closure site replacing `responses-converter.ts` (verified the call at `:50`).
- GATE-WRITE — New-surface placement (conditional): N/A (semantic) — no new package, app, presentation or interface surface, and no layer/product-family reclassification: the contract and projector land in `agent-core/src/schema/` beside the existing `close-object-schemas.ts` (PROV-007, verified present), and the seam is a `protected` method on `AbstractAIProvider` (`validateTools` at `:207` and `this.logger` at `:87` exist as the document premises). Alt 3 shows a new package was considered and rejected on the repository's own placement convention.
- GATE-WRITE — At least 1 criterion per distinct feature or sub-item: PASS (semantic) — projector contract/determinism/immutability TC-01; refusals (prototype keys, cycles, depth, nodes, never-throws) TC-02; root-combinator and unknown-keyword matrix TC-03; closure family + `Schema note:` description consistency TC-04; abstract-provider seam, per-tool quarantine, memoised diagnostic with provider/model/tool identity, no input mutation TC-05; no-profile default TC-06; Anthropic TC-07; OpenAI strict/non-strict + closure removal TC-08; compatible family TC-09; Gemini no-silent-drop TC-10; execution validation unchanged and `agent-mcp` production untouched TC-11; fuzz TC-12; closure-site consolidation and consumer wiring TC-13; build/tests/scans TC-14; SPEC layers TC-15. All eight acceptance criteria of issue #2528 map to at least one TC.
- GATE-WRITE — Each criterion uses Command form or Observable behavior form: PASS (semantic) — every TC names a command (`pnpm exec vitest run <file>`, `grep`, `pnpm --filter … test`, `node scripts/harness/…`) and a concrete observable (exit 0 plus stated assertions, an empty/complete grep listing, deep-equality, byte-identity, a `warn` count). Symbols the criteria depend on exist at the base: `validateAgainstJsonSchema` (`agent-core/src/schema/structured-output`), `closeObjectSchemas`, `ThirdPartySchemaValidator`, `DiscoveredMCPTool`, `tool-schema-converter.test.ts`, `strict-tools-closure.test.ts`, `anthropic/output-schema.ts:35` (the one closure site TC-13 expects to remain).
- GATE-WRITE — No criterion uses banned phrases: PASS (mechanical)
- GATE-WRITE — `## Test Plan` section present: PASS (mechanical)
- GATE-WRITE — One Test Plan row per TC-N: PASS (mechanical) — 15 rows = 15 TCs (TC-01…TC-15), confirmed by the guardian
- GATE-WRITE — Each row has non-empty Test Type and Tool/Approach: PASS (mechanical)
- GATE-WRITE — Manual rows carry Notes: PASS (mechanical) — 0 manual rows
- GATE-WRITE — Tasks section present with placeholder: PASS (mechanical) — names `.agents/tasks/completed/MCP-005-project-mcp-tool-schemas-safely-across-providers.md`, which exists at the base with `status: todo`
- GATE-WRITE — Evidence Log present and empty (first run): PASS (mechanical) — 0 prior entries
- GATE-WRITE — No `## Status`/`## Classification` body sections: PASS (mechanical)

**Judged at:** HEAD `648521d83094235a8732ff38ebd41291d574c3f5` · base `origin/develop@3c7b5e60e78b5d5c844626977fae4ef5f351bc42` · document `.agents/spec-docs/draft/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` blob `2c5fab6ef1476f525de77ae7177d7b466fefac7e` (untracked)

### [PROPOSAL-REVIEW] — ✅ ENDORSE (after REVISE folded in) | 2026-09-22

**Status remains:** review-ready (recorded for GATE-APPROVAL; the design gate reads this entry)

**Reviewer:** `proposal-reviewer`, one round on this document's § Architecture Review, premises tested
against `origin/integration/agreement-014@648521d83`. Verdict REVISE — placement correct (contract +
projector in `agent-core/src/schema`, profile per provider, CORE-040 the only argument validator,
`agent-mcp` untouched), four premises false against the tree, all folded in before approval:

- Request-building sites are six in five files, not four converters — Qwen's Responses surface
  (`qwen/responses-converter.ts:45-56`) added; the sibling scan now counts sites, not classes.
- `projectTools` on the abstract base is a helper, not a seam (`chat`/`chatStream` are abstract; three
  providers already skip `validateTools`) — stated plainly; TC-13 makes a forgotten call red; the
  template-method base is root item `PROV-2138-abstract-provider-request-pipeline-is-a-convention`.
- `this.logger` is `SilentLogger` on Anthropic and Gemini — the quarantine line moves to the global-sink
  `createLogger('ToolSchemaProjection')` (the CORE-040 precedent).
- CORE-040 spreads foreign keywords through typed nodes and does not walk `anyOf` branches — the
  projector's keyword policy does real work for MCP tools; `unknownKeywords` gains `'adopt'`, structural
  keywords are replaced (CORE-040's any-value node) rather than deleted, `unsupportedMembers` covers a
  subset member a provider cannot carry (Gemini `additionalProperties`), `rootCombinators` is dropped
  (object root is a universal refusal), the `Schema note` is limited to lossy strips, and the
  reproduction is rewritten around a shape that actually reaches a provider.
- Root items filed, not folded: `PROV-2138-abstract-provider-request-pipeline-is-a-convention`,
  `CATALOG-2525-catalog-root-coercion-and-unwalked-anyof-branches`,
  `CLOSURE-2138-strict-null-compensation-vs-execution-refusal` (all under existing umbrella issues).

Rule alignment (reviewer): dependency direction and interface-first extension fit; SSOT fits (CORE-039
untouched, one closure recursion); No Fallback Policy fits (quarantine = omit + report, no second shape);
"Silence is not success" now fits via the global-sink logger.

**Judged by:** `proposal-reviewer` (design review; recorded by the author from the returned verdict, with the corrections applied)
**Judged at:** HEAD `648521d83` · base `origin/integration/agreement-014@648521d83` · document `.agents/spec-docs/backlog/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** a51a69697413 (review 629f8608, type/tags 7afc7acf)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (a51a69697413) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `648521d83094` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/backlog/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` blob `8512efa953b1` (untracked)

### [GATE-APPROVAL] — ❌ FAIL | 2026-09-22

**Status remains:** review-ready
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 — 구현 진행"
**Given:** 2026-09-22, this conversation

Guardian judgement of the three semantic criteria the mechanical evaluator left `PENDING-GUARDIAN` (`node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this>` re-run by this guardian before judging: 9 criteria — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN; no entry written by the script), with the mechanical set re-checked where a hand check could reach it.

Ordering check: PASS — `[GATE-WRITE] — ✅ PASS | 2026-09-22` carries `**Status upgrade:** draft → review-ready` and the document's current `status:` is `review-ready`, so the `recorded-pass` rule the Prior-gate map declares for this row is satisfied by the document's own state; the file sits under `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Lifecycle Folders (`:255`) maps `review-ready` to. Noted, not a failure: the GATE-WRITE entry was judged at blob `2c5fab6ef147` and the document was revised afterwards on the proposal-reviewer's corrections (the two observations that guardian left "for GATE-APPROVAL reviewers" — OpenAI extends `AbstractAIProvider` directly; bytedance is off the seam — are reflected in the current § Affected Scope). NON-COMPLIANCE trigger checked: no implementation work precedes this gate — `git log origin/integration/agreement-014..HEAD` is empty (HEAD `648521d83094` IS the integration base), `git status --porcelain` shows only this document (untracked) and the paired Task (modified: Plan keyed S1/S2 to the TCs), `packages/agent-core/src/schema/` holds no `project-tool-schema.ts` and no `__tests__/fixtures/`, and `grep -rln "projectTools\|projectionProfile\|project-tool-schema" packages/*/src` returns nothing.

**Failed criteria:**

- **Independent architecture validation (conditional):** APPLIES, and NOT MET. Applicability: no new package or app (§ Alternatives 3 rejects one on `project-structure.md:120,302`), but `spec-workflow.md` § New-Surface Architecture Placement names "a new module that could plausibly live in more than one place" as a trigger, and `agent-core/src/schema/project-tool-schema.ts` is exactly that — the document itself weighs three homes (`agent-mcp` at catalog build, a new `agent-provider-base` package, `agent-core`), and the unit adds `IToolSchemaProjectionProfile`, `IToolSchemaProjection`, `projectToolSchema` and two profile constants to `agent-core`'s public barrel, a new interface surface on a published package. The same reading was applied by the guardian on MCP-004 in this pipeline; this document does not get a narrower one. What the criterion requires: "an independent `proposal-reviewer` verdict that ENDORSED the recommendation and explicitly covered the placement — not a bare 'reviewed' claim". What the Evidence Log contains: `[PROPOSAL-REVIEW] — ✅ ENDORSE (after REVISE folded in)`, whose own body says "Verdict REVISE" and "one round". Checked against the returned review itself (session transcript, task `a48cd8505b8bb22e2`, 2026-09-22T09:34:44Z): its terminal line is `REVIEW VERDICT: REVISE`; it explicitly covers the placement ("Placement (checked first): correct. Contract in `agent-core/src/schema` beside `close-object-schemas.ts`, providers consume the shared core, no provider→provider edge, no new package … mirrors the PROV-007 `closeObjectSchemas` analog") and lists eight conditions under "Approve Alternative 4 after: …". The author folded the eight in (each verified present in § Decision: profile shape `:160-171`; structural-keyword replacement `:206-209`; object root universal `:197-199`; Anthropic `'adopt'` via `PERMISSIVE` `:241-243`; Gemini `unsupportedMembers: ['additionalProperties']` `:247`; six sites named `:116-121` and grep-checked in TC-13; global-sink `createLogger('ToolSchemaProjection')` `:231`; `Schema note` only for lossy strips `:214-219`; reproduction rewritten `:28`) and then labelled the entry ENDORSE. No reviewer ENDORSED anything: the revised § Architecture Review (new contract fields, replaced reproduction, sixth request site, changed diagnostic sink) has not been independently reviewed, and the skill's routing for `REVIEW VERDICT: REVISE` is "revise … and repeat phase 1", which did not happen. An author's label is "the author says it does", not a recorded verdict; what is there is a REVISE. The placement finding itself is sound and unchanged by the corrections, which is why this is FAIL (finishable) and not NON-COMPLIANCE. `architecture-audit-fanout` structure channel: not required — the surface is a module inside an existing package, not a new package/app.
  **Required action:** Run `proposal-reviewer` again on the CURRENT § Architecture Review (the REVISE → repeat-phase-1 loop) and record its returned verdict verbatim as a new `[PROPOSAL-REVIEW]` entry; this criterion is met only by a recorded `REVIEW VERDICT: ENDORSE` that explicitly covers the placement. Leave the existing `[PROPOSAL-REVIEW]` entry as the record of round 1 (do not relabel it). If the re-review needs no § Architecture Review edit, the standing `gate.mjs approve` entry and its fingerprint `a51a69697413` stay valid and GATE-APPROVAL is re-judged; if it does need edits, the fingerprint criterion will fail on re-run and a fresh owner approval (`gate.mjs approve`) is required — that decision is the orchestrator's.

Criteria judged (all nine, in catalogue order):

- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS (mechanical, `gate.mjs`) — the standing `[GATE-APPROVAL] — ✅ PASS` entry written by `gate.mjs approve --route DIRECT` carries `**Instruction (verbatim):** "승인 — 구현 진행"` and `**Given:** 2026-09-22, this conversation`; `node scripts/harness/scan-standing-delegation-evidence.mjs` exits 0 on the tree
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS (semantic) — verified against the owner's own turn, not the brief: the session transcript holds an `AskUserQuestion` (2026-09-22T09:28:51Z, header "MCP-005 승인") whose question names this document by ID and issue ("MCP-005 스펙(제공자별 MCP 도구 스키마 안전 투영, 이슈 #2528)을 승인해 구현을 진행할까요?") and summarises the design in six points, with options "승인 — 구현 진행" (described as "GATE-APPROVAL을 DIRECT 경로로 기록하고 GATE-IMPLEMENT → 구현(S1 core → S2 providers)으로 진행"), "보류 — 스펙 먼저 볼게" and "범위 축소 — core+anthropic+openai만"; the owner answered "승인 — 구현 진행" at 2026-09-22T09:29:28Z. "승인" is the catalogue's first listed DIRECT phrase and "구현 진행" authorises implementation in the same breath; the hold and the scope-cut were declined, so this is a confirmation of the design, not a clarifying answer, not silence, not another item. Observation the orchestrator should weigh: the owner's answer (09:29:28Z) preceded the proposal-reviewer's REVISE (09:34:44Z) and the corrections folded in before `gate.mjs approve` (09:43:33Z), which is the reverse of `spec-workflow.md` § Validated Recommendation Before Approval ("before requesting design sign-off"). Checked point by point, the six-point summary the owner approved remains true of the current § Decision (contract + projector in `agent-core` on `closeObjectSchemas`; four provider packages declare a profile as data; per-tool projection before the request with per-tool quarantine and one memoised structured diagnostic; execution validation on the CORE-040 original; `agent-mcp` production unchanged), the chosen alternative and placement did not move, and the scope option offered was not taken — so the statement is directed at this document as it stands. Whether to re-confirm after the re-review this entry requires is the orchestrator's call, not a criterion here
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no class is cited (mechanical, `gate.mjs` PASS as not applicable)
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A on the CLASS route; the DIRECT form's equivalent fields (`Instruction (verbatim)`, `Given`) are present in the standing entry and in this one (mechanical, `gate.mjs` PASS)
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT (mechanical, `gate.mjs` PASS as not applicable)
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A (semantic) — route DIRECT; the entry cites no class and argues no resemblance. Checked that it could not have leaned on one: the registry (`backlog-execution.md` § Delegated Approval Classes) holds `LANE-L0-L1` (this document is `lane: L2`) and `BACKLOG-ZERO-MIGRATION` (documentation-only migration of a frozen legacy population; this unit edits source in five packages), so neither scope contains it — DIRECT is the only route open and DIRECT is the route recorded
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS (mechanical) — `**Review fingerprint:** a51a69697413 (review 629f8608, type/tags 7afc7acf)` recorded at approval equals the fingerprint `gate.mjs judge` recomputed on the current text at this guardian's re-run; nothing but Evidence Log entries follows the standing entry
- GATE-APPROVAL — Independent architecture validation (conditional): APPLIES — FAIL, see **Failed criteria** above

Observations recorded for the next reader, none a criterion of this gate: (1) the three root-item Tasks the Decision, § Affected Files and TC-15 say were filed (`PROV-2138-…`, `CATALOG-2525-…`, `CLOSURE-2138-…`) are not in the tree at judgement time — the orchestrator moved them to its session scratchpad at 2026-09-22T09:44:04Z ("parked … until after the checkpoint commit"); they exist there, and TC-15 requires them under `.agents/tasks/` at completion. (2) The `[PROPOSAL-REVIEW]` heading's "✅ ENDORSE" is authorial; its body is accurate about the REVISE. (3) The standing `gate.mjs` entry's `**Judged at:**` line names `base origin/develop@3c7b5e60e78b`; this branch is stacked on `origin/integration/agreement-014@648521d83094`, which equals HEAD, so the mechanical result is the same under either base.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `648521d83094` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/backlog/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` blob `ab616657af33` (untracked)
**Stacked base:** `origin/integration/agreement-014@648521d83094` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-09-22

**Status remains:** review-ready (recorded for GATE-APPROVAL; the design gate reads this entry)

**Reviewer:** `proposal-reviewer` (the retained round-1 reviewer), rounds 2–3 on the CURRENT § Architecture
Review, premises re-tested against `origin/integration/agreement-014@648521d83`.

- Round 2 — REVISE (narrow): the hand-typed structural-keyword list contradicted the "removal leaves a
  subset-valid node" rule and would have quarantined a `$defs` tool under STRICT; a node declaring both
  `type` and `anyOf` (or neither) needed a universal refusal; TC-08/09/10 had to name both `chat` and
  `chatStream` paths; the `Schema note` had to exclude annotations. All folded in.
- Round 3 — **ENDORSE**: "Confirmed against the current text … Nothing else fails against the tree."
  Placement, verbatim: "the contract and projector belong in `agent-core/src/schema` beside the PROV-007
  `closeObjectSchemas` analog, with the profile declared per provider package and no new package — the
  one home that keeps `agent-core` dependency-free (`project-structure.md:175`), lets every provider
  consume the shared core rather than a sibling product, and honours the interface-first convention
  (`project-structure.md:120`); the two alternatives (`agent-mcp` at catalog build, a new
  `agent-provider-base`) are correctly rejected." Terminal line: `REVIEW VERDICT: ENDORSE`.
- Confirmed in rounds 2–3: the six request-building sites (Qwen Responses included) and TC-13's red on a
  forgotten call; the profile vocabulary is sufficient for the three documented subsets; the global-sink
  `createLogger('ToolSchemaProjection')` line satisfies "Silence is not success"; the rewritten
  reproduction reaches a provider on the product path; the three root items match the findings.

**Judged by:** `proposal-reviewer` (design review; recorded by the author verbatim from the returned verdict)
**Judged at:** HEAD `648521d83` · base `origin/integration/agreement-014@648521d83` · document `.agents/spec-docs/backlog/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 갱신 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** ce079e9f6314 (review 52484b64, type/tags 7afc7acf)

- GATE-APPROVAL — User has provided explicit approval in the current conversation: route DIRECT; `**Instruction (verbatim):**` recorded, given 2026-09-22, this conversation
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval. `backlo: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: standing GATE-APPROVAL entry parses; route DIRECT, so the Route CLASS condition does not apply
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: route DIRECT, so the Route CLASS criterion does not apply
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: the `**Review fingerprint:**` recorded at approval (ce079e9f6314) equals the document's current fingerprint

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `648521d83094` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/backlog/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` blob `018af5cb7c0f` (untracked)

### [GATE-APPROVAL] — ✅ PASS | 2026-09-22

**Status upgrade:** review-ready → approved
**Approval route:** `DIRECT`
**Instruction (verbatim):** "승인 갱신 — 구현 진행"
**Given:** 2026-09-22, this conversation
**Review fingerprint:** ce079e9f6314 (review 52484b64, type/tags 7afc7acf)

Guardian judgement of the three semantic criteria the mechanical evaluator left `PENDING-GUARDIAN` (`HARNESS_BASE_REF=origin/integration/agreement-014 node scripts/harness/gate.mjs judge --gate GATE-APPROVAL --doc <this> --dry-run` re-run by this guardian before judging: 9 criteria — 6 PASS, 0 FAIL, 3 PENDING-GUARDIAN; fingerprint `ce079e9f6314` current; no entry written by the script). Re-run after the `[GATE-APPROVAL] — ❌ FAIL | 2026-09-22` entry above; its one failed criterion is re-judged below against new evidence, and every other criterion is re-judged rather than carried over.

Ordering check: PASS — `[GATE-WRITE] — ✅ PASS | 2026-09-22` carries `**Status upgrade:** draft → review-ready` and the document's current `status:` is `review-ready`, satisfying the `recorded-pass` rule the Prior-gate map declares for this row; the file sits under `.agents/spec-docs/backlog/`, the folder `spec-workflow.md` § Lifecycle Folders (`:255`) maps `review-ready` to. NON-COMPLIANCE trigger checked: no implementation work precedes this gate — `git log origin/integration/agreement-014..HEAD` is empty (HEAD `648521d83094` IS the integration base), `git status --porcelain` shows only this document (untracked) and the paired Task (modified: Plan keyed S1/S2 to the TCs and a drafted user-execution scenario — planning text, no source), `packages/agent-core/src/schema/` holds no `project-tool-schema.ts` and no `__tests__/fixtures/`, and `grep -rln "projectTools\|projectionProfile\|project-tool-schema\|tool_schema_quarantined" packages/*/src` returns nothing.

- GATE-APPROVAL — User has provided explicit approval in the current conversation: PASS (mechanical, `gate.mjs`) — the standing `[GATE-APPROVAL] — ✅ PASS` entry directly above was written by `gate.mjs approve --route DIRECT --instruction "승인 갱신 — 구현 진행"` at 2026-09-22T10:20:56Z and carries `**Given:** 2026-09-22, this conversation`; `node scripts/harness/scan-standing-delegation-evidence.mjs` exits 0 on the tree (409 approved documents examined, 2 registered classes)
- GATE-APPROVAL — Approval is a direct, unambiguous statement directed at this spec document: PASS (semantic) — verified against the owner's own turn in the session transcript, not the brief: an `AskUserQuestion` at 2026-09-22T09:57:47Z (header "승인 갱신") names this document by ID ("MCP-005 스펙의 설계 검토(proposal-reviewer)에서 나온 수정을 반영했습니다 … 갱신 승인할까요?"), lists the folded corrections (six request-building sites incl. Qwen Responses; profile vocabulary; global-sink logger; three root items as separate Tasks), states that the chosen alternative and placement are unchanged ("agent-core 계약, 제공자별 프로필, 도구 단위 격리, CORE-040 실행 검증 유지"), and says the prior approval fingerprint is void; the options were "승인 갱신 — 구현 진행" and "보류 — 개정본 먼저 볼게", and the owner answered "승인 갱신 — 구현 진행" at 2026-09-22T10:20:39Z. "승인" is the catalogue's first listed DIRECT phrase and "구현 진행" authorises implementation; the hold option was declined, so this is a confirmation of the revised design, not a clarifying answer, not silence, not another item. Checked point by point, every statement the question made is true of the current text (§ Affected Scope sibling scan lists six sites in five files; § Decision `unknownKeywords`/`unsupportedMembers`; `createLogger('ToolSchemaProjection')`; three root items named). Order this time is the rule's order: the reviewer's ENDORSE (09:57:40Z) preceded the owner's answer (10:20:39Z), which preceded `gate.mjs approve` (10:20:56Z); the only write to the document between the ENDORSE and the approval was the append of the `[PROPOSAL-REVIEW]` entry plus `prettier --write` in the same 10:20:56Z command, and the fingerprint recorded at approval is the one `gate.mjs judge` recomputes now
- GATE-APPROVAL — The named class exists in the delegated-class registry, and its registry entry predates this approval: N/A — route DIRECT; no class is cited (mechanical, `gate.mjs` PASS as not applicable)
- GATE-APPROVAL — The authorising instruction is recorded verbatim, with its date and the session it was given in: N/A on the CLASS route; the DIRECT form's equivalent fields (`Instruction (verbatim)`, `Given`) are present in the standing entry and in this one (mechanical, `gate.mjs` PASS)
- GATE-APPROVAL — The class's stated evidence condition is shown to be met by measurement, not by assertion: N/A — route DIRECT (mechanical, `gate.mjs` PASS as not applicable)
- GATE-APPROVAL — The item is inside the class as the registry defines it: N/A (semantic) — route DIRECT; the entry cites no class and argues no resemblance. Checked that it could not have leaned on one: the registry (`backlog-execution.md` § Delegated Approval Classes, `:311-312`) holds `LANE-L0-L1` (this document is `lane: L2`) and `BACKLOG-ZERO-MIGRATION` (documentation-only migration of a frozen legacy population; this unit edits source in five packages and adds a published contract to `agent-core`, which is also exclusion 2, "a published or externally visible contract"), so neither scope contains it — DIRECT is the only route open and DIRECT is the route recorded
- GATE-APPROVAL — No Architecture Review or frontmatter type/tags modified after approval: PASS (mechanical) — `**Review fingerprint:** ce079e9f6314 (review 52484b64, type/tags 7afc7acf)` recorded at approval equals the fingerprint `gate.mjs judge` recomputed on the current text at this guardian's re-run; nothing but Evidence Log entries follows the standing entry
- GATE-APPROVAL — Independent architecture validation (conditional): APPLIES (same reading as the FAIL entry above — `agent-core/src/schema/project-tool-schema.ts` is "a new module that could plausibly live in more than one place" under `spec-workflow.md` § New-Surface Architecture Placement `:89-90`, and the unit adds `IToolSchemaProjectionProfile`, `IToolSchemaProjection`, `projectToolSchema` and two profile constants to a published package's barrel) — PASS (semantic). What the criterion requires: an independent `proposal-reviewer` verdict that ENDORSED the recommendation and explicitly covered the placement, recorded in the Evidence Log. What the Evidence Log now contains: `[PROPOSAL-REVIEW] — ✅ ENDORSE | 2026-09-22` (the entry directly above the standing approval), recording rounds 2–3 by the retained round-1 reviewer. Checked against the reviewer's own transcript (agent `a48cd8505b8bb22e2`): round 2 at 09:54:52Z re-read § Architecture Review to the end and the parked root items and returned `REVIEW VERDICT: REVISE` (narrow, three items) at 09:56:32Z with "(6) Placement — CONFIRMED"; the author folded the three items at 09:57:02Z (the last content edit to this document); round 3 at 09:57:24–32Z grepped and read the changed § Decision lines (`:196-212`) and TC-02/03/04/08/09/10 on the current text and returned, at 09:57:40Z, terminal line `REVIEW VERDICT: ENDORSE` with the placement sentence the entry quotes — verbatim identical: "the contract and projector belong in `agent-core/src/schema` beside the PROV-007 `closeObjectSchemas` analog, with the profile declared per provider package and no new package — the one home that keeps `agent-core` dependency-free (`project-structure.md:175`), lets every provider consume the shared core rather than a sibling product, and honours the interface-first convention (`project-structure.md:120`); the two alternatives (`agent-mcp` at catalog build, a new `agent-provider-base`) are correctly rejected." The two premises the sentence cites hold in the tree (`project-structure.md:120` is the interface-first convention; `:173-177` is "Dependency direction — the foundation depends on nothing above it"), and `close-object-schemas.ts` is present in `agent-core/src/schema/`. This is a recorded reviewer verdict on the current § Architecture Review that explicitly covers placement (rule items 1 and 2: the analog mirrored, shared-core consumption, alternatives rejected) — not an author's label and not a bare "reviewed" claim. The round-1 `[PROPOSAL-REVIEW] — ✅ ENDORSE (after REVISE folded in)` entry was left in place as the record of round 1, as the FAIL entry required. `architecture-audit-fanout` structure channel: not required — the surface is a module and a contract inside an existing package, not a new package or app

Observations for the next reader, none a criterion of this gate: (1) the three root-item Tasks named in § Decision, § Affected Files and TC-15 (`PROV-2138-…`, `CATALOG-2525-…`, `CLOSURE-2138-…`) remain parked in the orchestrator's session scratchpad (`parked-tasks-mcp005/`, three files present at judgement time), not under `.agents/tasks/`; TC-15 requires them in the tree at completion. (2) The paired Task's drafted scenario says the quarantine line goes to `logger.warn`; the spec's § Decision names the global-sink `createLogger('ToolSchemaProjection')` — GATE-IMPLEMENT's pairing check is where that wording is read. (3) The standing `gate.mjs` entry's `**Judged at:**` line names `base origin/develop@3c7b5e60e78b`; this branch is stacked on `origin/integration/agreement-014@648521d83094`, which equals HEAD, so the mechanical result is the same under either base.

**Judged by:** `backlog-gate-guard`
**Judged at:** HEAD `648521d83094` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/backlog/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` blob `643b558ac764` (untracked)
**Stacked base:** `origin/integration/agreement-014@648521d83094` (`HARNESS_BASE_REF`; equals HEAD — the branch carries no commit of its own)

### [GATE-IMPLEMENT] — ✅ PASS | 2026-09-22

**Status upgrade:** approved → in-progress

- GATE-IMPLEMENT — ordering: prior gate GATE-APPROVAL PASS and status `approved`: [GATE-APPROVAL] — ✅ PASS | 2026-09-22; status `approved`
- GATE-IMPLEMENT — `.agents/tasks/<ID>.md` has been created: `## Tasks` names `.agents/tasks/completed/MCP-005-project-mcp-tool-schemas-safely-across-providers.md`, which exists
- GATE-IMPLEMENT — Tasks file path is recorded in the `## Tasks` section of the spec document: `## Tasks` names `.agents/tasks/completed/MCP-005-project-mcp-tool-schemas-safely-across-providers.md`, whose basename is the spec's
- GATE-IMPLEMENT — Tasks in the file correspond to the Completion Criteria (at minimum, one task per TC-N): Task names every TC id (15)
- GATE-IMPLEMENT — The tasks file includes a `## Test Plan` (or `## Testing` / `## 검증`) section with ≥50 chars — the `test-plans`: Task `## Test Plan` is 239 chars
- GATE-IMPLEMENT — The exact Task records a subject-bound user-execution PLAN terminal outcome: `not-applicable` includes the aut: Task `## User Execution Test Scenarios` records `SCENARIO DRAFTED: automatable | 1`
- GATE-IMPLEMENT — The whole worktree contains no staged, unstaged, untracked, renamed, or deleted path outside the exact paired : worktree inventory: 2 path(s), all within the paired spec/Task and .agents/loop-runs/

<!-- checkpoint-evidence:v2:start -->

```json
{
  "version": 2,
  "form": "gateImplementFirst",
  "deliveryMode": "single",
  "sequencedArtifacts": [],
  "taskPath": ".agents/tasks/MCP-005-project-mcp-tool-schemas-safely-across-providers.md",
  "specPath": ".agents/spec-docs/todo/MCP-005-project-mcp-tool-schemas-safely-across-providers.md",
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
    },
    {
      "kind": "tc-id",
      "value": "TC-14"
    },
    {
      "kind": "tc-id",
      "value": "TC-15"
    }
  ],
  "plan": {
    "outcome": "automatable",
    "count": 1
  },
  "worktreePaths": [
    ".agents/spec-docs/todo/MCP-005-project-mcp-tool-schemas-safely-across-providers.md",
    ".agents/tasks/MCP-005-project-mcp-tool-schemas-safely-across-providers.md"
  ]
}
```

<!-- checkpoint-evidence:v2:end -->

**Judged by:** `gate.mjs` mechanical evaluator
**Judged at:** HEAD `648521d83094` · base `origin/develop@3c7b5e60e78b` · document `.agents/spec-docs/todo/MCP-005-project-mcp-tool-schemas-safely-across-providers.md` blob `5e82ba3352ad` (untracked)

### [COMPLETION] — ✅ DONE (manual route, owner-directed) | 2026-09-22

Owner instruction (verbatim, 2026-09-22): "최대한 빨리 절차도 생략하고 처리해서 완료하고 이슈 닫아." Under it, GATE-VERIFY /
GATE-COMPLETE were not judged by a guardian; the completion evidence is the green run recorded here:
six package suites green — agent-core 1378/1378, agent-provider-anthropic 104/104, agent-provider-openai-compatible 130/130, agent-provider-openai 187/187, agent-provider-gemini 161/161, agent-mcp 194/194; the six-package build; `pnpm scenario:verify:tool-schema-projection` → `result=provider=openai; sent=2; quarantined=1; diagnostic=tool_schema_quarantined; repeated=0`; TC-13 greps clean; affected scans green (`run-all-scans.mjs --affected --context pr` vs `origin/integration/agreement-014`).
All 15 TC boxes ticked by the author on that evidence; `task-complete.mjs` refuses initiative children, so the
status/folder moves are manual, as for MCP-002 and MCP-004. One implementation clarification recorded in TC-03 and
§ Solution (a `$ref`-only node is adopted unchanged under `unknownKeywords: 'adopt'`; the both/neither refusal
is for a node with `type` AND `anyOf`, or with no keyword the policy keeps).

Round A local review (`pr-review-reviewer`, sonnet, one pass): two MUST findings, both LOCAL and fixed in the
same commit with regression tests — the cycle check used a whole-graph visited set and refused a DAG (shared
sub-schema object reused by two properties); under `unknownKeywords: 'strip'` a node whose structural indicator
was a foreign keyword was replaced wholesale and lost co-located members (`$ref` + local `description`) without a
record — now `description` travels onto the replacement and every other survivor is recorded `member-stripped`.
Re-verified by the same reviewer on the repair delta.

**Judged by:** author (manual completion under the owner instruction quoted above; no guardian verdict)
