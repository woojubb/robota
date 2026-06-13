# INFRA-006 Tasks

Spec: `.agents/spec-docs/todo/INFRA-006-agent-cli-spec-dependency-chain.md`

## Tasks

- [x] TC-01: Remove every phantom `@robota-sdk/agent-(sdk|sessions|provider-|runtime)` reference from `packages/agent-cli/docs/SPEC.md`. Verify with `rg -n '@robota-sdk/agent-(sdk|sessions|provider-|runtime)' packages/agent-cli/docs/SPEC.md` returning nothing (exit code 1, zero matches).
- [x] TC-02: Rewrite the SPEC's dependency-chain diagram and Import Rules table so the dependency section lists exactly the 6 real production deps (`agent-command, agent-core, agent-framework, agent-provider, agent-subagent-runner, agent-transport`). Verify with `rg` over the dependency sections: all 6 real dep names present, none of the phantom names from TC-01.

## Test Plan

Both criteria are command-form smoke checks over a doc-only change to `packages/agent-cli/docs/SPEC.md`. TC-01 is verified by running the `rg` grep assertion for phantom package names and confirming zero matches. TC-02 is verified by running `rg` over the dependency-chain diagram and Import Rules table and confirming the 6 real dependency names are present while none of the phantom names remain.

| TC-ID | Test Type              | Tool / Approach                                                                                                | Notes                                           |
| ----- | ---------------------- | -------------------------------------------------------------------------------------------------------------- | ----------------------------------------------- |
| TC-01 | CI pipeline smoke test | `rg -n '@robota-sdk/agent-(sdk\|sessions\|provider-\|runtime)' packages/agent-cli/docs/SPEC.md` → zero matches | Command-form: zero phantom names                |
| TC-02 | CI pipeline smoke test | `rg` over dependency-chain diagram + Import Rules table: 6 real dep names present, no phantom names            | Command-form: grep over the dependency sections |

## Result

(pending implementation)
