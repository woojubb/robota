# agent-preset Specification

## Scope

Owns the preset contract for the Robota SDK: the `IPreset` definition shape, the resolved
framework-option subset (`TResolvedPresetOptions`), the built-in `default` preset, and the
`resolvePreset` / `listPresets` / `getPreset` resolver. A preset is a named, pre-tuned bundle of
framework option overrides (persona, model/effort, permission posture, command-module selection,
execution capabilities, autonomy). This package produces option data only; it performs no session
assembly.

## Boundaries

- Does **not** assemble sessions, synthesize system prompts, apply permission modes, or select
  command modules — those belong to `agent-framework` (assembly), `agent-core`/`agent-executor`
  (execution capability), and `agent-command` (module selection).
- Does **not** parse CLI flags, read settings, or render active-preset UI — that is `agent-cli`
  (shell) and `agent-transport` (TUI render).
- Does **not** re-export `agent-framework` (no pass-through re-export). It depends on the framework
  only to consume option types as the single source of truth.
- Depends on exactly one workspace package: `@robota-sdk/agent-framework` (option types).

## Architecture Overview

```
agent-framework            ← neutral assembly + option-type SSOT
  └── agent-preset         ← this package: IPreset contract + resolvePreset + built-in presets
        ├── preset-types.ts              ← IPreset / TResolvedPresetOptions / enums (SSOT for the preset shape)
        ├── presets/default.ts           ← neutral baseline preset (no overrides — pure no-op)
        ├── presets/autonomous-builder.ts← opinionated preset: persona + effort/autonomy/parallel/self-verify mechanism
        ├── presets/careful-reviewer.ts  ← opinionated preset: ask-first reviewing posture
        ├── presets/neutral-executor.ts  ← opinionated preset: thin, steerable, literal-execution posture
        └── resolve-preset.ts            ← registry + listPresets/getPreset/resolvePreset + DEFAULT_AGENT_NAME
```

`resolvePreset(id, context)` merges three layers by precedence (LOW → HIGH):
preset options < `context.cliOverrides` < `context.explicit`. Later layers win; `undefined` values
are skipped. The identity triple (`id`/`title`/`description`) is stripped before merging. Because the
`default` preset carries no overrides, resolving it returns the merged overrides unchanged
(no-regression guarantee).

## Type Ownership

Types owned by this package (SSOT):

| Type                     | Location            | Purpose                                                                |
| ------------------------ | ------------------- | ---------------------------------------------------------------------- |
| `IPreset`                | `preset-types.ts`   | Named preset: identity triple + `TResolvedPresetOptions` overrides     |
| `TResolvedPresetOptions` | `preset-types.ts`   | Framework-facing option subset a preset resolves into                  |
| `TPresetEffort`          | `preset-types.ts`   | Effort dial: `'low' \| 'medium' \| 'high' \| 'xhigh' \| 'max'`         |
| `TPresetAutonomy`        | `preset-types.ts`   | Behaviour posture: `'ask-first' \| 'balanced' \| 'act-first'`          |
| `TPresetTrustLevel`      | `preset-types.ts`   | Trust profile: `'safe' \| 'moderate' \| 'full'`                        |
| `TPresetPermissionMode`  | `preset-types.ts`   | Reused from `ICreateSessionOptions['permissionMode']` (framework SSOT) |
| `IPresetSummary`         | `resolve-preset.ts` | `{ id, title, description }` discovery view of a preset                |
| `IResolvePresetContext`  | `resolve-preset.ts` | `{ cliOverrides?, explicit? }` override layers for `resolvePreset`     |

`TPresetPermissionMode` reuses `agent-framework`'s `ICreateSessionOptions['permissionMode']` via
indexed access rather than redefining the permission-mode union.

## Public API Surface

| Export                    | Kind      | Description                                                                                                                                     |
| ------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `IPreset`                 | Interface | Preset definition shape (identity + option overrides)                                                                                           |
| `TResolvedPresetOptions`  | Interface | Resolved framework-option subset                                                                                                                |
| `TPresetEffort`           | Type      | Effort dial union                                                                                                                               |
| `TPresetAutonomy`         | Type      | Autonomy posture union                                                                                                                          |
| `TPresetTrustLevel`       | Type      | Trust-level union                                                                                                                               |
| `TPresetPermissionMode`   | Type      | Permission-mode union (reused from framework)                                                                                                   |
| `IPresetSummary`          | Interface | `{ id, title, description }` summary                                                                                                            |
| `IResolvePresetContext`   | Interface | Override layers for resolution                                                                                                                  |
| `DEFAULT_AGENT_NAME`      | Const     | Default agent identity (`'robota-cli'`), owned by this package                                                                                  |
| `defaultPreset`           | Const     | Built-in neutral baseline preset                                                                                                                |
| `autonomousBuilderPreset` | Const     | Opinionated preset: proactive/self-verifying persona + `effort: 'high'`, `autonomy: 'act-first'`, `enableParallelSubagents`, `selfVerification` |
| `resolvePreset`           | Function  | `(id, context?) => TResolvedPresetOptions`; throws on unknown id                                                                                |
| `listPresets`             | Function  | `() => readonly IPresetSummary[]`                                                                                                               |
| `getPreset`               | Function  | `(id) => IPreset \| undefined`                                                                                                                  |

## Extension Points

| Extension Point          | Kind      | How to extend                                                              |
| ------------------------ | --------- | -------------------------------------------------------------------------- |
| `IPreset`                | Interface | Author a new preset object conforming to `IPreset`; add it to the registry |
| `TResolvedPresetOptions` | Interface | Extended by `IPreset`; consumers pass instances as override layers         |

New built-in presets are added to the internal registry in `resolve-preset.ts`. Future work
(PRESET-007) may load user/external presets; that loader will validate against `IPreset`.

## Error Taxonomy

| Condition                  | Behaviour                                                                    |
| -------------------------- | ---------------------------------------------------------------------------- |
| `resolvePreset` unknown id | Throws `Error("Unknown preset: \"<id>\". Available presets: <comma-list>.")` |

No custom error classes are defined; the single failure mode throws a plain `Error` with a message
listing the available preset ids.

## Test Strategy

`src/__tests__/resolve-preset.test.ts` (vitest) covers: default-preset no-op resolution (TC-05),
precedence merging — `explicit` > `cliOverrides` > preset (TC-06), `listPresets()` containing the
`default` entry (TC-07), the `{ id, title, description }` summary shape, `getPreset` lookup, and the
unknown-preset error message. It also covers the `autonomous-builder` preset (PRESET-005): non-empty
persona with the portable behaviour-guide keywords, `effort: 'high'`, `autonomy: 'act-first'`,
`enableParallelSubagents`, `selfVerification`, and its `listPresets()` entry. The `test` script runs
`vitest run --passWithNoTests`.

### Built-in preset catalog

| Preset               | Identity                | Resolved overrides                                                                                                                                               |
| -------------------- | ----------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `default`            | neutral baseline        | none (pure no-op — reproduces standard agent behaviour)                                                                                                          |
| `autonomous-builder` | opinionated builder     | `persona` (portable proactive/self-verifying block) + `effort: 'high'`, `autonomy: 'act-first'`, `enableParallelSubagents: true`, `selfVerification: true`       |
| `careful-reviewer`   | opinionated reviewer    | `persona` (portable read-first/plan-first block) + `effort: 'high'`, `autonomy: 'ask-first'`, `enableParallelSubagents: false`, `selfVerification: true`         |
| `neutral-executor`   | thin steerable executor | `persona` (portable literal/minimal-scope/terse block) + `effort: 'medium'`, `autonomy: 'balanced'`, `enableParallelSubagents: false`, `selfVerification: false` |

The `autonomous-builder` persona carries portable behavioural principles only (proactivity,
scope-constraint, self-verification, tool-result grounding, non-sycophantic honesty, concise output).
It holds no runtime/environment content — working directory, tool schemas, product identity, dates,
and permission text remain the framework RUNTIME layer's responsibility. The identifier is generic; a
work-style sourcing footnote appears only in `description`.

The `careful-reviewer` preset is the deliberate counterpart to `autonomous-builder` on the autonomy
axis: `autonomy: 'ask-first'` maps (PRESET-004) onto the ask-on-write permission posture, and the
portable persona guides read/analyse-first → propose a plan → wait for confirmation, conservative
scope, and trade-off explanation. It runs focused (`enableParallelSubagents: false`) and self-verifies.
Like every shipped persona it holds portable behavioural content only — no runtime/environment tokens —
and its identifier is generic with no work-style attribution in source.

The `neutral-executor` preset is a thin, steerable counterpart to `default`: where `default` pins
behaviour in no direction, `neutral-executor` actively pins a terse, literal, minimal-scope posture
for predictable scripted/automation use. Its portable persona follows the system/user instructions
literally, editorialises little, stays strictly in scope, and keeps output terse; it turns capability
_off_ (`enableParallelSubagents: false`, `selfVerification: false`) at `effort: 'medium'` with
`autonomy: 'balanced'`. Identifier is generic — any work-style attribution is confined to `description`.

## Class Contract Registry

This package contains no classes. It exports interfaces, type unions, two constants, and three pure
functions. The only intra-package inheritance is `IPreset extends TResolvedPresetOptions`. No
abstract classes or cross-package port implementations are defined here.

## Dependencies

- `@robota-sdk/agent-framework` — consumed for the `ICreateSessionOptions` option type
  (`TPresetPermissionMode` indexed access). No other workspace dependency.
