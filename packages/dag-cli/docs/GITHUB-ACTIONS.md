# Using robota-dag with GitHub Actions

`@robota-sdk/dag-cli` is published to npm, so any GitHub Actions workflow can run DAG files
with `npx` — no custom Action needed.

## Quick start

```yaml
- name: Run DAG workflow
  env:
    ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
  run: |
    npx @robota-sdk/dag-cli run .dag/workflows/my-workflow.dag.json \
      --input text="hello world" \
      --output json > result.json
```

## Example: AI code review on pull requests

```yaml
# .github/workflows/ai-code-review.yml
name: AI Code Review

on:
  pull_request:
    branches: [main]

jobs:
  review:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: Get PR diff
        id: diff
        run: |
          diff=$(git diff origin/main...HEAD -- '*.ts' '*.tsx' | head -c 10000)
          echo "diff<<EOF" >> $GITHUB_OUTPUT
          echo "$diff" >> $GITHUB_OUTPUT
          echo "EOF" >> $GITHUB_OUTPUT

      - name: Run AI Code Review DAG
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          npx @robota-sdk/dag-cli run .dag/workflows/code-review.dag.json \
            --input code="${{ steps.diff.outputs.diff }}" \
            --output json > review-result.json

      - name: Post review as PR comment
        uses: actions/github-script@v7
        with:
          script: |
            const result = require('./review-result.json');
            if (result.ok && result.outputs['out.text']) {
              await github.rest.issues.createComment({
                owner: context.repo.owner,
                repo: context.repo.repo,
                issue_number: context.issue.number,
                body: `## AI Code Review\n\n${result.outputs['out.text']}`,
              });
            }
```

## Example: release notes generation

```yaml
# .github/workflows/release-notes.yml
name: Generate Release Notes

on:
  release:
    types: [created]

jobs:
  notes:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Generate release notes
        env:
          ANTHROPIC_API_KEY: ${{ secrets.ANTHROPIC_API_KEY }}
        run: |
          commits=$(git log --oneline $(git describe --tags --abbrev=0 HEAD^)..HEAD)
          npx @robota-sdk/dag-cli run .dag/workflows/release-notes.dag.json \
            --input commits="$commits" \
            --output json > notes-result.json

      - name: Upload notes artifact
        uses: actions/upload-artifact@v4
        with:
          name: release-notes
          path: notes-result.json
```

## Caching npx downloads

Add this step before running DAGs to cache the package across workflow runs:

```yaml
- name: Cache npx robota-dag
  uses: actions/cache@v3
  with:
    path: ~/.npm/_npx
    key: ${{ runner.os }}-npx-robota-dag-3.x
```

## Output format

Use `--output json` to get machine-readable output:

```json
{
  "ok": true,
  "dagRunId": "run-abc123",
  "durationMs": 3420,
  "outputs": {
    "out.text": "The code looks good. No security issues found."
  },
  "nodes": [
    { "nodeId": "in", "status": "success" },
    { "nodeId": "llm", "status": "success" },
    { "nodeId": "out", "status": "success" }
  ]
}
```

## Common use cases

| Use case             | Trigger           | Environment secrets |
| -------------------- | ----------------- | ------------------- |
| PR code review       | `pull_request`    | `ANTHROPIC_API_KEY` |
| Commit quality check | `push`            | `OPENAI_API_KEY`    |
| Documentation gen    | `push` to `docs/` | `ANTHROPIC_API_KEY` |
| Release notes        | `release`         | `ANTHROPIC_API_KEY` |
| Security scan        | `schedule`        | `ANTHROPIC_API_KEY` |

## API key setup

Add API keys as GitHub repository secrets under **Settings → Secrets and variables → Actions**.
Pass them to the workflow step via `env:`.

Never hard-code keys in workflow YAML files or DAG definitions — use secrets references only.
