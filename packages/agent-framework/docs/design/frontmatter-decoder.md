# Frontmatter Decoder Design

Realizes the internal metadata-loading responsibilities of the
[`@robota-sdk/agent-framework` SPEC](../SPEC.md): the frontmatter of skill, bundle-skill and agent
definition files is decoded through one private, fail-closed boundary.

## Context & Goal

Skill, bundle-skill and agent definition files come from outside the runtime's trust boundary. The
decoder is the one place that reads their YAML frontmatter. It returns either a complete, typed
metadata record together with the untouched body after the frontmatter, or a non-empty list of
structured diagnostics and no metadata at all. There is no partial result.

Centralizing it keeps syntax handling, the field vocabulary of each profile, primitive validation
and source coordinates in one place. The skill, bundle-plugin and agent-definition loaders keep
their own discovery precedence and their no-frontmatter behaviour, and refuse a file with invalid
frontmatter before it is registered. A refused file is skipped and reported once per process. It
still claims its file or directory name (its own `name:` cannot be read once refused), so a
lower-priority definition with the same name cannot stand in for it, and one broken file shared with
another host never stops the session. There is no public frontmatter parser.

## Constraints

- The implementation stays private to `agent-framework`: lower packages do not learn the file
  formats, and the package entry points do not export the decoder.
- The caller selects the profile (`skill`, `bundle-skill` or `agent`). A file path never implies a
  profile.
- YAML is untrusted input. Duplicate keys, aliases, merge keys, invalid roots, unsupported shapes,
  malformed syntax and unterminated delimiter blocks fail closed.
- A profile validates only the keys it owns and ignores the rest: `.claude` definitions are shared
  with hosts that define their own fields, and a key Robota does not read grants nothing. A malformed
  value of an owned key still fails closed. The skill `metadata` map keeps string keys with string,
  finite-number or boolean values and ignores nested entries; prototype-named keys stay ordinary data
  and cannot reach object prototypes.
- Skill metadata accepts `model` only together with `context: fork`; otherwise a field-path
  diagnostic rejects the file before registration. A fork model is used by the child session and
  does not change the parent's model or provider.
- `effort` is validated against the effort vocabulary that `agent-core` exports (`isModelEffort`,
  `MODEL_EFFORT_VALUES`) and typed as its `TModelEffort`.
- The decoder preserves the body's LF/CRLF bytes after the closing delimiter. Trimming is left to
  each loader.
- There is no compatibility parser and no partial-value fallback.

## Internal Structure

| Module                                  | Responsibility                                                                                                 |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| `frontmatter-decoder.ts`                | Orchestrate delimiter slicing, YAML parsing, profile decoding and all-or-nothing result assembly               |
| `frontmatter-types.ts`                  | Own the private profile metadata, result, diagnostic and shared decoder contracts                              |
| `frontmatter-document.ts`               | Slice exact delimiters, parse YAML, reject structural hazards and map source coordinates                       |
| `frontmatter-primitives.ts`             | Validate non-empty strings, exact booleans, lists, effort, context, positive safe integers and scalar metadata |
| `frontmatter-profile-fields.ts`         | Map validated YAML fields into the closed skill, bundle-skill and agent vocabularies                           |
| `frontmatter-profiles.ts`               | Accumulate schema diagnostics and select the caller-provided profile definition                                |
| `frontmatter-error.ts`                  | `FrontmatterDecodeError`: keep structured diagnostics and format paths/codes without echoing untrusted values  |
| `frontmatter-refusal-report.ts`         | Warn once per process that a skill or agent definition was refused and skipped (used by the discovery loaders) |
| `__tests__/frontmatter-decoder.test.ts` | Verify behaviour through the decoder facade without coupling tests to the implementation modules               |

`yaml` owns syntax parsing and AST locations only. The profile tables and primitive decoders own the
meaning; a syntactically valid YAML document is not trusted until those checks pass.

## Key Flows

### Document without frontmatter

1. Read the first physical line without normalizing line endings.
2. If it is not exactly `---`, return the profile's empty metadata and the original content as the
   body.
3. Do not invoke YAML parsing or infer intent from a prefix such as `--- text`.

An empty header, or one that parses to nothing, also yields the profile's empty metadata.

### Valid frontmatter

1. Slice the header between the exact opening and closing delimiter lines and keep the exact suffix.
2. Parse the header into a YAML document with line tracking and duplicate-key checks.
3. Reject parser errors, warnings, aliases and merge keys.
4. Select the caller-provided profile table and visit the top-level pairs in source order.
5. Apply the shared primitive validation and assign only successful values to an internal typed
   object.
6. Return metadata only when the diagnostic list is empty; otherwise discard the internal object.

### Structural failure

1. An unterminated delimiter is reported at the opening delimiter.
2. YAML errors use the parser offset translated to the original file line by adding the delimiter
   line.
3. A structural failure stops profile validation, because the mapping cannot be interpreted
   reliably.

### Schema failure

1. Invalid values of owned fields produce diagnostics at the value's AST range; unowned keys are
   ignored.
2. Independent top-level failures accumulate in source order.
3. The failure result carries a non-empty diagnostic tuple and no metadata property.

## Test Approach

- A focused Vitest file drives the design through the decoder function only.
- Minimal and complete success cases cover all three profiles, the keys used in the repository,
  both list notations, effort typing, and exact LF/CRLF/no-header body behaviour.
- Table-driven negative cases cover delimiters, YAML syntax, duplicates, aliases, merge keys, root
  shapes, wrong scalar/list/map shapes, context, effort and every invalid `maxTurns` class.
- Diagnostics are asserted against exact source, line, column and field where those coordinates
  exist. A typo in a boolean that would widen authority is proven to fail rather than become
  `false`.

## Alternatives / Trade-offs

- Tightening each loader's own parser avoids a dependency but keeps semantic duplication and drift.
  It was rejected in favour of one boundary.
- A decoder in `agent-core` or `agent-interface-command` would be easier to export, but it would
  reverse ownership by placing framework file-format knowledge below its consumers.
- The `yaml` dependency is larger than a line splitter, but it correctly handles the quoted,
  block-scalar, inline-list, nested-map, comment and CRLF forms found in real files, and it gives
  trustworthy ranges.
- Comma- or whitespace-separated scalar lists remain an explicitly validated notation alongside YAML
  sequences, so existing documents stay representable without a compatibility parser.

## Error projection

Loader error projection and discovery behaviour are specified in the framework SPEC. The skill,
bundle-plugin and agent loaders share `FrontmatterDecodeError`; its structured diagnostics preserve
the decoder result, while operator-facing messages omit untrusted received values. Bundle-plugin
inspection publishes only the path, location, code and field.
