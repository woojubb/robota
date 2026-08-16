---
'@robota-sdk/agent-subagent-runner': major
'@robota-sdk/agent-cli': patch
---

**BREAKING — ARCH-021: child-process subagents compose the PRODUCT's surface, not imported defaults.**

The child-process worker built its surface from `createDefaultProviderDefinitions()` and `createDefaultTools()` — a fixed six-vendor registry and the framework's default tool tier — while the composition root had already handed the runner the fully composed surface and the runner dropped it. So a product's custom providers and pack-contributed tools reached an **in-process** subagent and not a **child-process** one, and ARCH-006's landed invariant "every tool robota runs comes from a pack" was **false in the child**: dropping a pack did not drop its tools.

This is the second finding at that line. ARCH-010 — judged BLOCKER, a subagent `Read` returning `/etc/hostname` — patched one argument there and left the reconstruction standing.

```ts
// the port: what the product composes, stated by the composition root
export interface ISubagentWorkerComposition {
  createTools(context: { readonly cwd: string }): IToolWithEventService[];
  readonly providerDefinitions: readonly IProviderDefinition[];
}

export function runSubagentWorkerMain(composition: ISubagentWorkerComposition): void;
```

**Why a recipe and not a broker.** A composition cannot be projected across a process boundary because it is _code_: `createProvider` is a function and a tool carries `execute`. The two sound answers are to proxy the instances or to stop expressing the contract as instances. Proxying loses on containment — a proxied tool executes in the **parent**, bound to the parent's checkout, while a worktree-isolated child's execution root is a different directory — and a prior-art sweep found **no specification that defines a per-call working root for a proxied tool invocation** (MCP roots are session-scoped and pull-based). So the recipe crosses and the child builds an equivalent surface at its own root, which is what every comparable product does.

**Per package, classified against each barrel:**

- **`agent-subagent-runner` (major)** — `runSubagentWorkerMain` gains a **required** parameter; `ISubagentWorkerComposition` is added to the barrel; `ISubagentWorkerReadyMessage` gains `composedToolNames?`; and the `@robota-sdk/agent-provider-defaults` **dependency edge is removed**.
- **`agent-cli` (patch)** — composition-root wiring plus one new internal `product/` module; no barrel change.

**The structural guarantee reaches one axis, and the document says so.** Deleting the manifest edge makes the **provider** axis a compile error, because that package solely owns `createDefaultProviderDefinitions`. The **tool** axis cannot be cut the same way: `createDefaultTools` is barrel-exported by `agent-framework`, which this package must keep for `createSubagentSession`. That axis is held by a new `harness:scan` check instead — and it is the axis with the failure history, so claiming compile-time enforcement across both would have been an overclaim exactly where it matters. The cause (no defaults-aggregator leaf for the tool surface) is tracked as ARCH-035.

**Fail closed on what a recipe cannot reproduce.** A recipe carries anything that is a pure function of (execution root, serialized payload, ambient durable state) — not a live, unrepeatable handle. Today that is `sandboxClient`, and it is reachable with public code (`E2BSandboxClient` and `InMemorySandboxClient` are both on `agent-tools`' barrel). The composition root now **refuses** to select the child-process runner in that case, naming the capability, rather than yielding a sandboxed parent with a host-tool child. Projection is tracked as ARCH-033.

**Verified per run, not by construction.** The child declares its composed tool names in `ready`, so the built binary can be asked what it actually composed. Measured on the real artifact: `["Shell","Bash","Read","Write","Edit","Glob","Grep","WebFetch","WebSearch","AskUserQuestion"]` — `pack-coding`'s surface, from the product's own packs.

**Also filed rather than folded in:** ARCH-034 (in-process and child-process subagents get different tool surfaces), ARCH-036 (`deps.builtInAgents` is dropped by the child-process path), SEC-009 (`apiKey` rides in the IPC start payload; comparable products use the child's environment).
