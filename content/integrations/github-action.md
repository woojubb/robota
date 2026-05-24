# GitHub Action — robota-sdk/action@v1

Run Robota AI coding assistant directly in your GitHub Actions workflows.

## Quick Start

Add the following step to your workflow:

```yaml
- name: Run Robota
  uses: robota-sdk/action@v1
  with:
    task: 'Review the changed files in this PR for potential issues'
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
```

## Inputs

| Input       | Required | Default | Description                                      |
| ----------- | -------- | ------- | ------------------------------------------------ |
| `task`      | yes      | —       | The task or prompt to send to the agent          |
| `model`     | no       | —       | AI model to use (e.g. `claude-sonnet-4-6`)       |
| `api-key`   | no       | —       | Anthropic API key (prefer `secrets`)             |
| `output`    | no       | `text`  | Output format: `text` \| `json` \| `stream-json` |
| `max-turns` | no       | —       | Maximum agent turns before stopping              |

## Outputs

| Output   | Description             |
| -------- | ----------------------- |
| `result` | The agent response text |

## Examples

### PR Review

```yaml
name: AI PR Review

on:
  pull_request:
    types: [opened, synchronize]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Run Robota PR Review
        id: review
        uses: robota-sdk/action@v1
        with:
          task: 'Review the diff in this PR. Focus on correctness, type safety, and missing tests.'
          api-key: ${{ secrets.ANTHROPIC_API_KEY }}
          output: text

      - name: Post review as PR comment
        uses: actions/github-script@v7
        with:
          script: |
            github.rest.issues.createComment({
              issue_number: context.issue.number,
              owner: context.repo.owner,
              repo: context.repo.repo,
              body: `## Robota AI Review\n\n${{ steps.review.outputs.result }}`
            })
```

### Commit Message Analysis

```yaml
- name: Analyze recent commits
  uses: robota-sdk/action@v1
  with:
    task: 'Summarize what changed in the last 5 commits'
    api-key: ${{ secrets.ANTHROPIC_API_KEY }}
    max-turns: '3'
```

## Security

- Always pass the API key via `${{ secrets.ANTHROPIC_API_KEY }}`, never hardcode it.
- The action never collects file contents, paths, or user identifiers.
- Set `ANTHROPIC_API_KEY` as a repository or organization secret in GitHub Settings.
