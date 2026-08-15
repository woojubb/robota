# agent-cli — command registry execution pipeline

> Whitebox design for `@robota-sdk/agent-cli`. The blackbox contract lives in
> [`../SPEC.md`](../SPEC.md); nothing here is a promise to a consumer. Placement follows the
> consumer-impact test in
> [`design-doc-authoring`](../../../../.agents/skills/design-doc-authoring/SKILL.md).

## Context & Goal

How a resolved skill command is turned into a prompt: variable substitution, shell preprocessing, and
execution. The interfaces third parties implement, the frontmatter they author, and the ways a user
invokes a skill are contract and stay in [`../SPEC.md`](../SPEC.md); this file owns the pipeline that
runs behind them.

## Constraints

- Substitution and preprocessing must not change the frontmatter schema — that schema is contract.
- Shell preprocessing runs with the user's permission model; it is not a bypass.

## Internal Structure

### Variable Substitution

Skill content supports variable substitution before injection:

| Variable               | Description                               |
| ---------------------- | ----------------------------------------- |
| `$ARGUMENTS`           | User-provided arguments after the command |
| `${CLAUDE_SESSION_ID}` | Current session identifier                |
| `${CLAUDE_MODEL}`      | Current model identifier                  |
| `${PROJECT_DIR}`       | Project root directory path               |
| `${USER_HOME}`         | User home directory path                  |

Variables are substituted at invocation time, not at discovery time.

### Shell Command Preprocessing

Skill content supports inline shell command execution using the `` !`command` `` syntax. The shell command is executed and its stdout replaces the markup in the skill content before injection. This enables dynamic content like file listings or environment values.

### Skill Execution

When a skill slash command is selected, the CLI calls `interactiveSession.executeCommand(name, args)`
like any other slash command. The SDK normalizes virtual `/<skill-name>` aliases to the composed
`/skills <skill-name> [args]` command. `@robota-sdk/agent-command` calls the SDK skill
activation host API, and the SDK emits `skill_activation` events and owns all skill execution
semantics. The CLI must not synthesize skill activation state or call skill-specific SDK methods.

Model-initiated skills also use the standard SDK-projected command route: `robota_command_skills`
with skill arguments in `args`. The startup prompt may show skill descriptors, but full skill
content is loaded only after `/skills` activates the skill. A plain assistant claim that a skill was
used is not treated as skill activation unless a `skill_activation` event exists.

## Key Flows

`CommandRegistry` resolves a source → the skill body is read → variables are substituted → embedded
shell commands are pre-executed → the composed prompt is submitted. Discovery paths and invocation
syntax are specified in [`../SPEC.md`](../SPEC.md).

## Test Approach

Registry and substitution unit tests; skill-execution behaviour is covered end-to-end by the CLI
scenario suite.
