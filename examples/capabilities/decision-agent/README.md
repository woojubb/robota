# Capability: tool-only decision agent

For routers/orchestrators/classifiers the useful output is a **tool call, not prose**.
`allowToolOnlyCompletion: true` makes the tool call a valid completion — no extra summary
model call — and the app reads the decision from its own executor. `retainHistory: false`
keeps every ticket independent (flat token profile).

```bash
pnpm install
ANTHROPIC_API_KEY=your-key pnpm dev
```

For a fixed-schema JSON answer instead of a routing side effect, prefer structured output:
`run(prompt, { output: zodSchema })` — see the streaming demo and the
[Building Agents guide](../../../content/guide/building-agents.md#decision-agents--the-tool-call-is-the-answer).
