# Sandboxed tools

The agent's file and shell tools run inside a **sandbox** instead of on the host.

```bash
pnpm --filter robota-capability-sandboxed-tools dev
```

The demo makes no model call, so no API key is needed.

## What it shows

**Composing a sandboxed tool surface.** `createDefaultTools` takes an optional `sandboxClient`. With a
sandbox that has its own filesystem, every file tool it builds reads and writes through that client rather
than the host filesystem. The demo uses `InMemorySandboxClient`, so it is self-contained and destroys
nothing: it writes a file into the sandbox and reads it back. Swapping in `E2BSandboxClient` points the same
tools at a real remote sandbox with no other change.

Sandboxing changes _where_ a tool acts, and on a separate filesystem it also drops the tools that cannot act
there: `Glob` and `Grep` have no sandbox path, so they are withheld rather than left searching the host while
edits land in the sandbox. That is why the demo prints `sameToolSetWithAndWithoutSandbox: false`.

**Sandboxes and child-process subagents.** Child-process subagents are reproduced from a _recipe_: the child
receives an execution root and a serialized profile, then rebuilds an equivalent tool surface at its own
root. A recipe carries anything that is a pure function of (root, payload, durable state) — and a live
sandbox client is not: it is an open session against a remote machine.

What can cross the process boundary is a `(type, snapshotId)` pair. `ISandboxClient` may implement
`snapshot()` / `restore(snapshotId)`, and the demo takes a snapshot to show that the reference is just a
serializable string. The child also needs a constructor for the client type: a composition root registers
one per type in `sandboxFactories` on `ISubagentWorkerComposition` (`@robota-sdk/agent-subagent-runner`), and
the child restores its sandbox from the snapshot.

When a sandboxed parent cannot be projected that way — its client has no `snapshot()`, or no type is named —
the `robota` CLI refuses to start rather than spawn children that would silently fall back to host tools,
and a child handed a type with no registered factory fails the job instead of running unsandboxed. A
sandboxed parent with host-tool children would let a subagent read outside the parent's root, so refusing is
the safe direction.
