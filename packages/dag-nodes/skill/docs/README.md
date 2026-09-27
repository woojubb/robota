# Skill Node

`@robota-sdk/dag-node-skill` (internal) exports `SkillNodeDefinition`, node type `skill` (category
`Integration`). It resolves a Robota skill (a `SKILL.md`) by name to its expanded inject-mode prompt.
It does not run a model: a downstream node such as `llm-text` runs the prompt. The package also
exports `SkillResolverRuntime` and `SkillNodeConfigSchema`.

- **Input** `args` (string, optional) — overrides `config.args` when non-empty.
- **Outputs** `prompt` (string) — the expanded skill prompt; `mode` (string) — the resolution mode.
- **Config** `skillName` (string, required); `args` (string, default `''`); `sessionId` (string,
  optional — substituted for `${CLAUDE_SESSION_ID}` in the skill body); `baseCredits` (default `0`,
  used as the cost estimate).

Skill lookup goes through an injected `ISkillExecutionPort` from
`@robota-sdk/agent-interface-command`, passed as `new SkillNodeDefinition({ skillPort })`. The
default node set builds that port with `@robota-sdk/agent-framework`. Skills with `context: fork`
are rejected, since the node has no subagent runtime. Shell interpolations in a skill body are
stripped, never executed. An empty resolved prompt fails validation.

No network service or environment variables. The package ships a Node.js build only, since skill
discovery reads the local filesystem.

Contract: [SPEC.md](SPEC.md).
