# Running Robota in GitHub Actions

To use Robota in a GitHub Actions workflow today, install the CLI in a step and run it in
print mode (`__PRODUCT_CLI_NAME__ -p`): it answers one prompt, writes the answer to stdout, and exits. The repository
also contains a packaged GitHub Action, but it is not released yet — see
[The Robota GitHub Action](#the-robota-github-action-not-released) below.

## Run the CLI in a workflow

This workflow reviews a pull request and posts the review as a comment:

```yaml
name: AI review

on:
  pull_request:

permissions:
  contents: read
  pull-requests: write

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22

      - name: Install the ConversationAgent CLI
        run: npm install -g @robota-sdk/agent-cli

      - name: Review the pull request
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
          BASE_REF: ${{ github.base_ref }}
        run: |
          __PRODUCT_CLI_NAME__ --safe-mode -p "Review the changes between origin/$BASE_REF and HEAD (use git diff). List correctness problems and missing tests." > review.md

      - name: Post the review
        env:
          GH_TOKEN: ${{ github.token }}
        run: gh pr comment ${{ github.event.pull_request.number }} --body-file review.md
```

What the steps rely on:

- **Node.js 22.12 or later.** The CLI requires it, so set it up with `actions/setup-node`.
- **An API key as a secret.** With `ANTHROPIC_API_KEY` set, the CLI needs no settings file and uses
  Anthropic's default model; `GEMINI_API_KEY`, `DEEPSEEK_API_KEY` and `DASHSCOPE_API_KEY` (Qwen) work
  the same way. Add `--model <model>` to choose another model.
- **Workspace trust.** Print mode refuses to start in a Git repository that is not trusted, and a fresh
  checkout is not. `--safe-mode` starts with every customization off — instruction files, skills,
  commands, plugins, hooks and MCP servers — and runs Restricted, so it needs no trust. To load the
  repository's `AGENTS.md`, settings, skills and hooks instead, run `__PRODUCT_CLI_NAME__ trust --yes` before the
  prompt; do that only for code you trust, because it runs the repository's hooks.
- **Permissions.** Print mode uses the `default` permission mode: reads, searches and read-only commands
  such as `git diff` run, and anything that would ask for approval (an edit, another shell command) is
  denied, since no one can answer. Pass `--permission-mode acceptEdits` to allow edits, or
  `bypassPermissions` to allow everything except a few protected operations, such as writes into
  `.git`.
- **Output.** The answer goes to stdout. `--output-format json` or `stream-json` gives
  machine-readable output, and `--max-turns <n>` caps the number of agent turns.

The [CLI reference](../guide/cli.md) lists every flag.

### Use the SDK in a Node.js step

A script step can call the SDK directly with `createQuery` from `@robota-sdk/agent-framework`:

```typescript
import { createQuery } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider-anthropic';

const query = createQuery({
  provider: new AnthropicProvider({ apiKey: process.env.ANTHROPIC_API_KEY }),
});
const result = await query('Review the changed files in this branch for potential issues');
console.log(result);
```

`createQuery` also runs in the `default` permission mode, and without a `projectAccess` decision it
does not load the repository's instruction files or settings. See [Using the SDK](../guide/sdk.md).

## The Robota GitHub Action (not released)

The GitHub Action lives in [`apps/action`](../../apps/action/action.yml). It is not released yet: no
tag or `uses:` reference is published for it, so until it is, use the CLI as shown above.

It is a composite action for Linux and macOS runners. It sets up Node.js 22.12 or later with
`actions/setup-node` (so later steps in the job see that Node.js too), installs
`@robota-sdk/agent-cli` with npm in the runner's temp directory, and runs it in the checkout as
`__PRODUCT_CLI_NAME__ --safe-mode --output-format <output> -p` with the task on stdin, adding `--model` and
`--max-turns` when they are set, with `api-key` passed to the CLI as `ANTHROPIC_API_KEY`. It sets the
`result` output to what the CLI printed, and fails the step if the CLI exits with an error.

What the checkout can and cannot do:

- Nothing in it decides which program runs. npm runs outside the checkout, so its `.npmrc` is not
  read, and the installed CLI runs with Node directly, so a copy of the package committed to the
  checkout is never used.
- The task reaches the CLI only on stdin, so a task built from issue or pull request text is only
  ever a prompt: it cannot inject shell commands, CLI options or a subcommand. The other inputs are
  separate arguments, never passed through a shell.
- By default the CLI runs with `--safe-mode`, so the checkout's settings, hooks, skills and MCP
  servers do not load. Set `load-project: 'true'` to run `__PRODUCT_CLI_NAME__ trust --yes` first and load them
  instead — only for code you trust, never for a pull request from a fork.

### Inputs

| Input          | Required | Default  | Description                                                             |
| -------------- | -------- | -------- | ----------------------------------------------------------------------- |
| `task`         | yes      | —        | The task or prompt to send to the agent                                 |
| `model`        | no       | —        | AI model to use (e.g. `claude-sonnet-4-6`)                              |
| `api-key`      | no       | —        | Anthropic API key (pass it from `secrets`)                              |
| `output`       | no       | `text`   | Output format: `text` \| `json` \| `stream-json`                        |
| `max-turns`    | no       | —        | Maximum agent turns before stopping                                     |
| `load-project` | no       | `false`  | Trust the checkout and load its settings, hooks, skills and MCP servers |
| `cli-version`  | no       | `latest` | Exact version or dist-tag of `@robota-sdk/agent-cli` to install         |

### Outputs

| Output   | Description             |
| -------- | ----------------------- |
| `result` | The agent response text |

## Security

- Pass API keys through `secrets` (for example `${{ secrets.ANTHROPIC_API_KEY }}`), never in the
  workflow file.
- Pass untrusted text such as pull request titles or issue bodies to a step through `env`, not by
  writing `${{ … }}` into a `run:` script.
