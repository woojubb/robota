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

See the agent-core README's Structured Output section for the non-streaming variant.
