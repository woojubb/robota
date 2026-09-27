# Capability: streaming

Two consumption patterns:

1. **Plain** — `for await (const delta of agent.runStream(prompt))`.
2. **Structured** — with `{ output: zodSchema }` the deltas stream as usual and the
   schema-validated **typed object is the generator's return value** (read the final
   `{ done: true, value }` iterator result).

```bash
pnpm install
ANTHROPIC_API_KEY=your-key pnpm dev
```

For the non-streaming variant, `run(prompt, { output: zodSchema })`, see the Structured Output section of the
[agent-core README](../../../packages/agent-core/README.md).
