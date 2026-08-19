# Sandboxed tools

The agent's file and shell tools run inside a **sandbox** instead of on the host.

```bash
pnpm --filter robota-capability-sandboxed-tools dev
```

## What it shows

**Composing a sandboxed tool surface.** `createDefaultTools` takes an optional `sandboxClient`; every
file tool it builds then reads and writes through that client rather than the host filesystem. The
demo uses `InMemorySandboxClient`, so it is self-contained and destroys nothing. Swapping in
`E2BSandboxClient` points the same tools at a real remote sandbox with no other change.

The tool SET is identical with and without a sandbox — sandboxing changes _where_ a tool acts, not
_which_ tools exist.

**Why a sandboxed parent cannot spawn child-process subagents.** Child-process subagents are
reproduced from a _recipe_: the child receives an execution root and a serialized profile, then
rebuilds an equivalent tool surface at its own root. A recipe carries anything that is a pure function
of (root, payload, durable state) — and a live sandbox client is not: it is an open session against a
remote machine.

So the product **refuses to compose** rather than spawning children that would silently fall back to
host tools. That refusal is the safe direction: a sandboxed parent with host-tool children is
ARCH-010's shape, where the measured breach was a subagent reading outside its root.

`ISandboxClient` declares `snapshot()` / `restore(snapshotId)`, so a sandbox is in principle
projectable — the child could restore from a snapshot reference, and the demo shows that reference is
just a serializable string. What is missing is the **constructor**: the child must build the same
client type, and only the composition root knows which type that is. Designing that projection is
[ARCH-033](https://github.com/woojubb/robota/issues/1784); this example is the executable statement of
the problem it solves.
