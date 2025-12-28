# Examples Index

This folder contains example scripts for the Robota SDK.

## Naming rule

- `NN-<slug>.ts`
  - `NN` is a **two-digit ordering number** (e.g. `01`, `02`).
  - The number is **for sorting only** (no domain/category meaning).
  - `<slug>` describes **exactly one primary concept** for the example.

## Example list

| File | Purpose |
| --- | --- |
| `01-basic-conversation.ts` | Basic conversation flow |
| `02-tool-calling.ts` | Tool calling basics |
| `03-multi-providers.ts` | Multi-provider execution |
| `04-advanced-features.ts` | Advanced agent features |
| `05-payload-logging.ts` | Payload logging patterns |
| `06-agent-templates.ts` | Agent template usage |
| `07-execution-analytics.ts` | Execution analytics plugin usage |
| `08-debug-openai-stream.ts` | Debug OpenAI streaming |
| `09-agents-basic-usage.ts` | Agents basic usage |
| `10-agents-streaming.ts` | Agents streaming usage |
| `11-assign-task-basic.ts` | `assignTask` basic (no live LLM calls) |
| `12-assign-task-categorized.ts` | `assignTask` categorized (no live LLM calls) |
| `13-guarded-edge-verification.ts` | Guarded workflow generation (scenario playback) |
| `14-playground-edge-verification-deprecated.ts` | Deprecated and intentionally disabled |
| `15-continued-conversation-edge-verification.ts` | Guarded continued-conversation workflow generation |

## Scenario CLI

From `apps/examples/`:

### Record / Play / Verify

- Record: `pnpm scenario:record -- <example-file> <scenario-id>`
- Play: `pnpm scenario:play -- <example-file> <scenario-id> --strategy=sequential`
- Verify: `pnpm scenario:verify -- <example-file> <scenario-id> --strategy=sequential`

### Guarded examples (13/15)

These examples **refuse to run live calls** and require scenario playback env:
- `SCENARIO_PLAY_ID`
- `SCENARIO_PLAY_STRATEGY` (`hash` or `sequential`)

Examples:
- Play (guarded):
  - `pnpm scenario:play -- 13-guarded-edge-verification.ts mandatory-delegation --strategy=sequential`
  - `pnpm scenario:play -- 15-continued-conversation-edge-verification.ts continued-conversation --strategy=sequential`
- Verify (guarded + connection rules):
  - `pnpm scenario:verify -- 13-guarded-edge-verification.ts mandatory-delegation --strategy=sequential`
  - `pnpm scenario:verify -- 15-continued-conversation-edge-verification.ts continued-conversation --strategy=sequential`

### Workflow automation (generates + verifies + deploys data to web playground)

- Generate + verify + copy: `pnpm playground:auto`


