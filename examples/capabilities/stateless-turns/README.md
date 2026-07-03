# Capability: run-isolated (stateless) turns

By default one `Robota` instance accumulates history and sends **all of it on every call** —
token cost grows every turn. `retainHistory: false` makes the store ephemeral per run: each
run sees the system prompt (+ anything you inject before the run) and the prompt only, and
the store resets after the run settles.

This demo runs the same 3 prompts in both modes and prints per-call input token counts —
expect a flat profile (e.g. `17, 18, 17`) vs a growing one (e.g. `17, 30, 43`).

```bash
pnpm install
ANTHROPIC_API_KEY=your-key pnpm dev
```

See [Building Agents — History lifetime & cost](../../../content/guide/building-agents.md#history-lifetime--cost).
