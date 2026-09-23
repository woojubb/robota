# agent-preset Specification

## Scope

Owns the preset contract for the Robota SDK: the preset definition shape, the resolved
framework-option subset a preset resolves into, a small set of built-in presets, and an
instance-scoped registry resolver. A preset is a named, pre-tuned bundle of framework option
overrides (persona, model/effort, permission posture, command-module selection, execution
capabilities, autonomy). This package produces option data only; it performs no session assembly.

It also owns the provider-neutral output-style catalog: built-in style definitions, Markdown style
file parsing, and an instance-scoped registry with built-in-beats-external precedence.

## Boundaries

- Does **not** assemble sessions, synthesize system prompts, apply permission modes, or select
  command modules — those belong to the assembly package, the execution-capability packages, and
  the command-module package respectively.
- Does **not** parse CLI flags, read settings, or render active-preset UI.
- Does **not** re-export the framework package it depends on; it consumes the framework's option
  types as the single source of truth for the option shape rather than redefining them.
- Depends on exactly one workspace package, for option types only.

Preset resolution merges three layers by precedence (low to high): the preset's own options, then
CLI overrides, then explicit overrides. Later layers win; values left `undefined` are skipped. The
identity triple (id/title/description) is stripped before merging, so a preset with no overrides at
all resolves to the caller's overrides unchanged — a no-regression guarantee for the baseline
preset.

## Contract

### Command-module selection

A preset (or an override layer) may narrow the default command set with an allow-list and a
deny-list of module names. The deny-list is applied after the allow-list, so deny always wins over
allow. Both lists match against a module's canonical long-form name, not its short slash-command
name. This package only produces these field values — the actual filtering happens downstream. A
configured name that matches no known module is surfaced as a non-fatal notice to the caller rather
than being silently dropped.

### External preset loading

User-authored presets are loaded at runtime from a JSON file per preset in a conventional
directory (overridable). Each file is parsed and validated with a manual type-guard (no schema
library); the untrusted effort field is validated through the framework's shared parser so external
presets accept the same effort vocabulary as built-ins. Loading applies a conflict policy and
returns the survivors as a value — it registers nothing globally, so a second load in the same
process does not see a previous load's presets, and two products sharing a process each see only
their own.

Conflict policy:

- Built-ins always win — an external preset whose id collides with a built-in is rejected, and
  built-in ids can never be overridden. A duplicate id among external presets is also rejected,
  keeping the first.
- Per-file isolation — a parse or validation failure is recorded against its file and that file is
  skipped; the rest of the directory still loads. A missing directory yields an empty result, never
  an error.

The output-style registry applies the same shape of precedence for style files: built-in styles win
on id collision, and a per-file parse or validation failure is isolated rather than aborting the
whole load.

### Removed: `defaultTrustLevel`

The preset contract used to carry a `defaultTrustLevel` field that nothing read. It was removed by
owner decision rather than wired up, because a preset already states its trust/permission posture
three other ways (permission mode, default permission mode, and autonomy), and resolution already
promotes the latter two into the first — a fourth spelling would have been a second answer to a
question that already had one. The trust axis itself is untouched elsewhere in the system; only the
preset's own redundant copy of it is gone.

### Built-in presets

The built-ins span the autonomy spectrum deliberately: a neutral baseline that applies no
overrides at all (the no-op reference point), an opinionated proactive/self-verifying builder
posture, a deliberate ask-first/plan-first counterpart for careful review work, and a thin
literal-execution posture for predictable scripted use. Each shipped persona carries portable
behavioural content only (e.g. proactivity, scope discipline, self-verification, non-sycophantic
honesty) — none of them embed runtime/environment content such as working directory, tool schemas,
product identity, dates, or permission text, since that is the assembling framework's
responsibility to inject.

## Error Taxonomy

Looking up an unknown preset id throws a plain `Error` naming the id and listing the available
ids. No custom error classes are defined for this package's single failure mode.

## Dependencies

Depends on the framework package's session-option types (for the permission-mode type, via indexed
access) and no other workspace package.
