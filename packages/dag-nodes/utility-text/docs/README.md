# Utility Text Nodes

`@robota-sdk/dag-node-utility-text` (internal) exports small, stateless text and JSON nodes (category
`Utility`). Each class is named after its node type, for example `text-join` →
`TextJoinNodeDefinition`. All ports are strings. The nodes make no AI or network calls, need no
environment variables, and estimate a cost of 0. All of them are in the default node set.

| Node type          | Inputs → output                                  | Config (defaults)                                                          |
| ------------------ | ------------------------------------------------ | -------------------------------------------------------------------------- |
| `string-to-number` | `text` → `number` (fails if not numeric)         | —                                                                          |
| `number-to-string` | `number` → `text`                                | —                                                                          |
| `text-join`        | `items` (one per line) → `text`                  | `separator` (`', '`)                                                       |
| `text-split`       | `text` → `items` (one per line)                  | `separator` (`'\n'`), `trim` (`true`)                                      |
| `text-replace`     | `text` → `text`                                  | `search` (`''`), `replacement` (`''`), `useRegex` (`false`), `flags` (`g`) |
| `text-length`      | `text` → `text` (string length)                  | —                                                                          |
| `text-upper`       | `text` → `text`                                  | —                                                                          |
| `text-lower`       | `text` → `text`                                  | —                                                                          |
| `text-trim`        | `text` → `text`                                  | `mode` (`both` \| `start` \| `end`, `both`)                                |
| `json-extract`     | `json` → `text` (value at a dot path)            | `path` (`''`), `fallback` (`''`)                                           |
| `conditional-text` | `condition`, `text_true`, `text_false`? → `text` | `operator` (`non-empty`), `operand` (`''`)                                 |
| `text-count-lines` | `text` → `text` (line count)                     | `skipEmpty` (`false`)                                                      |
| `text-repeat`      | `text` → `text`                                  | `times` (`2`), `separator` (`''`)                                          |
| `text-slice`       | `text` → `text`                                  | `start` (`0`), `end` (optional)                                            |

`conditional-text` tests `condition` with `non-empty`, `equals`, `contains`, `starts-with` or
`ends-with` against `operand`, and emits `text_true` or `text_false` (empty when absent).
`text-join`, `text-split`, literal `text-replace`, `text-upper`, `text-lower` and `text-repeat` check
their output against a UTF-8 byte ceiling (which the host can tighten) before building it.
`text-replace` with `useRegex` runs only through a regex operation the host supplies in the execution
context; without one it fails instead of running the regex inline.

Contract: [SPEC.md](SPEC.md).
