---
'@robota-sdk/agent-cli': patch
---

Coordinated beta.79 release. Ships the natural-language workflow authoring feature and its
follow-ups, all bundled into the published CLI:

- **FLOW-007 `/workflows create "<description>"`** — author a workflow from natural language via the
  active provider, save it as a reusable `.workflows/<name>.json` artifact, and run it immediately;
  composes existing nodes and creates prompt-backed nodes on the fly; model-invocable so the agent can
  author + run from chat. Storage de-jargoned to a flat `.workflows/` layout with an injectable
  workspace.
- Live-LLM hardening found by running against a real provider: the authoring call now threads the
  resolved model; the spec parser tolerates a Markdown code fence; authored prompt nodes inherit +
  persist the active provider; and the unit suite no longer makes real key-using calls (forces the
  no-key path + asserts detection), with real coverage isolated in an opt-in `test:live`.
- **DATA-003** — the instant-node package now owns a runtime provider SSOT (`INSTANT_NODE_PROVIDERS`)
  and a symmetric persistence round-trip (`parsePersistedInstantNode` / `rehydrateInstantNode` +
  guards), removing duplicated provider lists and a hand-rolled, prompt-only reload path.

(The DAG/workflow subsystem stays private and is bundled into the CLI; no new runtime `@robota-sdk`
edge is added.)
