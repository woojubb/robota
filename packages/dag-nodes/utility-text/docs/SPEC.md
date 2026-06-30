# Utility Text Node Specification

## Scope

- Owns a collection of stateless text and data utility DAG node definitions in the `Utility` category.
- Provides zero-cost, zero-dependency string and JSON transformation primitives for use in DAG pipelines.

## Boundaries

- All node definitions extend `AbstractNodeDefinition` from `@robota-sdk/dag-node`.
- No external dependencies beyond `@robota-sdk/dag-core` and `@robota-sdk/dag-node`.
- No AI or network calls — all transformations are pure synchronous logic.

## Architecture Overview

All nodes in this package follow the same pattern: one or two string input ports, one string output port, optional Zod config schema, and a zero-credit cost estimate.

| Node class                      | nodeType           | Description                                                 |
| ------------------------------- | ------------------ | ----------------------------------------------------------- |
| `StringToNumberNodeDefinition`  | `string-to-number` | Parses a string to a number (via `Number()`)                |
| `NumberToStringNodeDefinition`  | `number-to-string` | Converts a number string to text                            |
| `TextJoinNodeDefinition`        | `text-join`        | Joins newline-separated items with a configurable separator |
| `TextSplitNodeDefinition`       | `text-split`       | Splits text by a separator into newline-separated items     |
| `TextReplaceNodeDefinition`     | `text-replace`     | Replaces substrings (literal or regex)                      |
| `TextLengthNodeDefinition`      | `text-length`      | Emits character count of text input                         |
| `TextUpperNodeDefinition`       | `text-upper`       | Converts text to uppercase                                  |
| `TextLowerNodeDefinition`       | `text-lower`       | Converts text to lowercase                                  |
| `TextTrimNodeDefinition`        | `text-trim`        | Trims whitespace (both/start/end)                           |
| `JsonExtractNodeDefinition`     | `json-extract`     | Extracts a value by dot-path from a JSON string             |
| `ConditionalTextNodeDefinition` | `conditional-text` | Selects text_true or text_false based on a condition        |
| `TextCountLinesNodeDefinition`  | `text-count-lines` | Counts lines in text (optionally skipping empty)            |
| `TextRepeatNodeDefinition`      | `text-repeat`      | Repeats text N times with a separator                       |
| `TextSliceNodeDefinition`       | `text-slice`       | Slices text by character index range                        |

## Type Ownership

All node definition classes are defined and exported from `src/index.ts`.

## Public API Surface

All 14 node definition classes listed above are exported from the package index.

## Extension Points

- Each node exposes a typed Zod config schema for per-instance configuration.
- `TextReplaceNodeDefinition`: supports literal and regex (`useRegex`, `flags`) replacement.
- `ConditionalTextNodeDefinition`: supports operators `non-empty`, `equals`, `contains`, `starts-with`, `ends-with`.
- `JsonExtractNodeDefinition`: dot-path notation for nested object traversal, with configurable fallback string.
