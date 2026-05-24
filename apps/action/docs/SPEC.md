# Action App Specification

## Scope

`@robota-sdk/action` owns the official Robota GitHub Actions runner. It reads GitHub Actions inputs (`task`, `model`, `api-key`, `output`, `max-turns`), invokes `@robota-sdk/agent-cli` via `npx` as a child process, and captures the agent response text as a GitHub Actions output named `result`. It is the sole integration point between GitHub CI/CD workflows and the Robota agent CLI.

## Boundaries

- Does not implement any agent runtime, session, provider, or tool logic — all AI execution is delegated to `@robota-sdk/agent-cli`.
- Does not parse or transform agent output beyond capturing it as a string.
- Does not manage environment secrets beyond forwarding `api-key` as `ANTHROPIC_API_KEY` into the child process environment.
- Does not provide a library API or export any symbols for programmatic consumption.
- Authentication, provider selection, and output formatting are owned by `@robota-sdk/agent-cli`.

## Architecture Overview

```text
apps/action
  ├── action.yml            -- GitHub Actions manifest: inputs, outputs, runs.using=node20
  └── src/
      └── index.ts          -- Entry point: read inputs → build args → execSync → setOutput/setFailed
```

Execution flow:

1. GitHub Actions runner evaluates `action.yml` and invokes `dist/index.js` under Node 20.
2. `index.ts` reads five inputs via `@actions/core.getInput`.
3. Constructs an `npx --yes @robota-sdk/agent-cli` argument array (`-p <task>`, `--output-format`, optional `--model`, optional `--max-turns`).
4. If `api-key` is provided, injects it as `ANTHROPIC_API_KEY` into a shallow copy of `process.env`.
5. Calls `execSync` capturing stdout; calls `core.setOutput('result', ...)` on success or `core.setFailed(...)` on error.

Design rules:

- Synchronous execution (`execSync`) keeps the action simple and ensures the runner waits for agent completion.
- No fallback or retry logic — failures propagate immediately via `core.setFailed`.
- No module-level side effects; all logic is inside the `run()` async function.

## Type Ownership

This app defines no exported SSOT types. All types used are imported from `@actions/core` (GitHub Actions SDK) and Node.js built-ins.

| Type                | Location        | Purpose                                                         |
| ------------------- | --------------- | --------------------------------------------------------------- |
| `NodeJS.ProcessEnv` | Node.js globals | Typed environment variable map used when constructing child env |

## Public API Surface

This app has no public library exports. It is an executable entry point only.

| Export   | Kind | Description                                                  |
| -------- | ---- | ------------------------------------------------------------ |
| _(none)_ | —    | `dist/index.js` is invoked by the Actions runner; no exports |

## Extension Points

This app has no extension points. Behavioral customization is achieved entirely through GitHub Actions input parameters:

| Input       | Required | Default | Purpose                                       |
| ----------- | -------- | ------- | --------------------------------------------- |
| `task`      | yes      | —       | The prompt or task sent to the agent          |
| `model`     | no       | —       | AI model override (e.g. `claude-sonnet-4-6`)  |
| `api-key`   | no       | —       | Anthropic API key (prefer repository secrets) |
| `output`    | no       | `text`  | Output format: `text`, `json`, `stream-json`  |
| `max-turns` | no       | —       | Maximum agent turn count                      |

## Error Taxonomy

This app does not define custom error classes. Errors surface through the GitHub Actions mechanism:

| Condition                                   | Behavior                                                             |
| ------------------------------------------- | -------------------------------------------------------------------- |
| `execSync` throws (non-zero exit or signal) | `core.setFailed('Robota Action failed: <message>')` — fails the step |
| Unhandled rejection from `run()`            | `core.setFailed(String(err))` via `.catch` handler                   |
| `task` input missing                        | `@actions/core` throws automatically because `required: true`        |

## Test Strategy

**Test file**: `__tests__/action.test.ts`

**Framework**: Vitest (`vitest.config.ts`, Node environment)

**Current coverage**:

| Test Case | Coverage                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------- |
| TC-01     | `action.yml` contains `task` input with `required: true` and `result` output with correct description |
| TC-02     | `src/index.ts` reads `api-key` input and sets it as `ANTHROPIC_API_KEY` in the child process env      |

**Coverage gaps**:

- No runtime integration test (actual `execSync` invocation); tests verify file content via `readFileSync` rather than executing the action.
- No test for argument construction with optional `model` and `max-turns` flags.
- No test for `core.setFailed` path.

## Class Contract Registry

This app defines no classes and implements no interfaces from external packages.

| Symbol | Kind     | Implements / Extends | Notes                           |
| ------ | -------- | -------------------- | ------------------------------- |
| `run`  | function | —                    | Async entry point; not exported |
