# GitHub PR Reviewer

Automated AI code review for GitHub pull requests using `@robota-sdk/agent-framework` and `@octokit/rest`.

## How it works

1. GitHub Actions triggers on `pull_request` events
2. The script fetches the PR diff via the GitHub API
3. `createQuery` sends the diff to Claude for analysis
4. The review is posted as a PR comment via the GitHub API

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` for local testing:

```bash
cp .env.example .env
```

| Variable            | Description                                    |
| ------------------- | ---------------------------------------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key                         |
| `GITHUB_TOKEN`      | GitHub token with `pull-requests: write` scope |
| `PR_NUMBER`         | Pull request number to review                  |
| `REPO_OWNER`        | Repository owner (org or user)                 |
| `REPO_NAME`         | Repository name                                |

### 3. Run locally

```bash
npm run review
```

## GitHub Actions

Copy `.github/workflows/pr-review.yml` to your target repository and add these secrets:

- `ANTHROPIC_API_KEY` — your Anthropic API key
- The `GITHUB_TOKEN` is automatically provided by Actions

The workflow triggers on `pull_request` `opened` and `synchronize` events.

## Customizing the review

Edit the prompt in `src/review.ts` to focus on specific concerns (security, performance, etc.).

To use a different provider, swap `AnthropicProvider` for `OpenAIProvider` from `@robota-sdk/agent-provider/openai`.
