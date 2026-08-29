# Frontmatter Decoder Design

Realizes the internal metadata-loading responsibilities of the
[`@robota-sdk/agent-framework` SPEC](../SPEC.md). The decoder is private in SECURITY-002;
[issue #2094](https://github.com/woojubb/robota/issues/2094) and
[issue #2095](https://github.com/woojubb/robota/issues/2095) own connecting it to observable
skill/plugin and agent-loading paths.

## Context & Goal

Skill, bundle-skill, and agent definition files originate outside the runtime's trust boundary. Three
loaders currently carry separate YAML-like line parsers that coerce values, ignore malformed or
unknown fields, and cast partial records. This component provides one internal boundary that either
returns a complete typed metadata variant and the untouched body suffix, or a structured non-empty
diagnostic set with no partial metadata.

The goal is to centralize syntax handling, profile vocabulary, primitive validation, and source
coordinates before any loader migration. This design deliberately does not change discovery,
precedence, fallback, public exports, or user-visible error projection.

## Constraints

- The implementation stays private to `agent-framework`; lower packages do not acquire file-format
  knowledge and the package entry points do not export the decoder.
- The caller selects `skill`, `bundle-skill`, or `agent`. A file path never infers a profile.
- YAML is untrusted input. Duplicate keys, aliases, merge keys, invalid roots, unsupported shapes,
  malformed syntax, and unterminated delimiter blocks fail closed.
- Profile top-level keys are closed. The skill `metadata` field is the only extensible map and accepts
  only string keys with string, finite-number, or boolean scalar values; prototype-named keys remain
  ordinary data and cannot reach object prototypes.
- Skill metadata retains the existing optional `model` field consumed by the command contract.
- Skill effort imports `TModelEffort` from `agent-core`; the local runtime guard is contained under
  `BEHAVIOR-009` until that owner exposes the runtime vocabulary alongside the type.
- The decoder preserves LF/CRLF body bytes after the closing delimiter. Consumer-specific trimming
  remains a loader concern.
- No compatibility parser or partial-value fallback is permitted for the prerelease formats.

## Internal Structure

| Module                                  | Responsibility                                                                                                  |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| `frontmatter-decoder.ts`                | Orchestrate delimiter slicing, YAML parsing, profile decoding, and all-or-nothing result assembly               |
| `frontmatter-types.ts`                  | Own private profile metadata, result, diagnostic, and shared decoder contracts                                  |
| `frontmatter-document.ts`               | Slice exact delimiters, parse YAML, reject structural hazards, and map source coordinates                       |
| `frontmatter-primitives.ts`             | Validate non-empty strings, exact booleans, lists, effort, context, positive safe integers, and scalar metadata |
| `frontmatter-profile-fields.ts`         | Map validated YAML fields into the closed skill, bundle-skill, and agent vocabularies                           |
| `frontmatter-profiles.ts`               | Accumulate schema diagnostics and select caller-provided profile definitions                                    |
| `__tests__/frontmatter-decoder.test.ts` | Verify behavior through the decoder facade without coupling tests to implementation modules                     |

`yaml` owns syntax parsing and AST locations only. Profile tables and primitive decoders remain the
semantic owner; a syntactically valid YAML document is not trusted until those checks complete.

## Key Flows

### Document without frontmatter

1. Read the first physical line without normalizing line endings.
2. If it is not exactly `---`, return the profile's empty metadata and the original content as body.
3. Do not invoke YAML parsing or infer intent from a prefix such as `--- text`.

### Valid frontmatter

1. Slice the header between exact opening and closing delimiter lines and retain the exact suffix.
2. Parse the header into a YAML document with line tracking and duplicate-key checks.
3. Reject parser errors, warnings, aliases, and merge keys.
4. Select the caller-provided profile table and visit top-level pairs in source order.
5. Apply shared primitive validation and assign only successful values to an internal typed object.
6. Return metadata only when the diagnostic set is empty; otherwise discard the internal object.

### Structural failure

1. An unterminated delimiter is reported at the opening delimiter.
2. YAML errors use the parser offset translated to the original file line by adding the delimiter
   line.
3. A structural failure stops profile validation because the mapping cannot be interpreted reliably.

### Schema failure

1. Unknown keys and invalid field values produce diagnostics at key or value AST ranges.
2. Independent top-level failures accumulate in source order.
3. The failure result contains a statically non-empty diagnostic tuple and no metadata property.

## Test Approach

- A focused Vitest file drives the design through the public-to-this-module function only.
- Minimal and complete success cases cover all three profiles, actual repository keys, both explicit
  list notations, imported effort typing, and exact LF/CRLF/no-header body behavior.
- Table-driven negative cases cover delimiters, YAML syntax, duplicates, aliases, merge keys, root
  shapes, unknown keys, wrong scalar/list/map shapes, context, effort, and every invalid `maxTurns`
  class.
- Diagnostics are asserted against exact source, line, column, and field where those coordinates
  exist. The authority-widening boolean typo is explicitly proven to fail rather than become `false`.
- A scope check confirms the three existing loaders and the package entry point do not change in this
  leaf. Package typecheck, lint, tests, build, affected scans, and the design-doc gate run on the final
  tree.

## Alternatives / Trade-offs

- Tightening each loader parser avoids a dependency but keeps semantic duplication and drift. It was
  rejected in favor of one boundary.
- A decoder in `agent-core` or `agent-interface-command` would be easier to export but would reverse
  ownership by placing framework file-format knowledge below its consumers.
- The `yaml` dependency is larger than a line splitter, but it correctly handles the checked-in quoted,
  block-scalar, inline-list, nested-map, comment, and CRLF forms while providing trustworthy ranges.
- Scalar comma/whitespace lists remain an explicitly validated notation alongside YAML sequences so
  existing supported documents are representable without a compatibility fallback parser.

## Open Questions

None for SECURITY-002. Loader error projection and discovery behavior are owned by
[issue #2094](https://github.com/woojubb/robota/issues/2094) and
[issue #2095](https://github.com/woojubb/robota/issues/2095). If those migrations make diagnostic
codes or metadata fields consumer-visible, the owning package SPEC must promote and define that
contract before wiring it.
