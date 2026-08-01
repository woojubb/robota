---
title: 'CLI-055: --json-schema flag functional but missing from help text'
status: done
created: 2026-06-10
completed: 2026-06-11
priority: low
urgency: later
area: packages/agent-cli
depends_on: []
---

# CLI-055: `--json-schema` flag functional but undocumented

## Problem

`--json-schema` is parsed (`packages/agent-cli/src/utils/cli-args.ts:40,152,198`) and wired into
the appended system prompt (`packages/agent-cli/src/startup/append-system-prompt.ts:26-29` —
"Respond with valid JSON only, matching this JSON schema..."), but `printHelp()`
(`packages/agent-cli/src/utils/cli-args.ts:57-95`) does not list it. The feature works but is
undiscoverable from `robota --help`, and the SPEC flag table should be checked for the same gap.

## Expected Behavior

`robota --help` lists `--json-schema <schema>` with a one-line description and the SPEC flag
table includes it; or, if intentionally internal, the flag is removed from the public parser.

## Test Plan

- Help output snapshot test includes the flag.
- SPEC flag table updated in the same change (three-doc-layer sync where applicable).
- `pnpm --filter @robota-sdk/agent-cli build && pnpm --filter @robota-sdk/agent-cli test`

## User Execution Test Scenarios

- Prerequisite: built CLI binary. Environment already exists.
- Steps: run `robota --help`.
- Expected observable result: the `--json-schema` flag appears in the flags section with its
  description.
- Cleanup: none.
- Evidence (2026-06-11): `node packages/agent-cli/bin/robota.cjs --help` output contains
  "--json-schema <schema> Print mode: instruct the model to respond with JSON matching this
  schema"; SPEC.md CLI Usage block gained the matching row. printHelp() unit tests assert the flag
  listing (cli-args.test.ts "printHelp flag coverage").
