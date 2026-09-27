# GitHub PR Reviewer

Automated AI code review for GitHub pull requests using `@robota-sdk/agent-framework` and `@octokit/rest`.

## How it works

1. GitHub Actions triggers on `pull_request` events
2. The script fetches the PR metadata and diff via the GitHub API (diffs over 20,000 characters are truncated)
3. `createQuery` (with `maxTurns: 1`) sends the diff to Claude for analysis
4. The review is posted to the PR as a review with the `COMMENT` event

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment variables

Copy `.env.example` to `.env` for local testing (the script loads it with `dotenv`):

```bash
cp .env.example .env
```

| Variable            | Description                                      |
| ------------------- | ------------------------------------------------ |
| `ANTHROPIC_API_KEY` | Your Anthropic API key                           |
| `GITHUB_TOKEN`      | GitHub token that can write pull request reviews |
| `PR_NUMBER`         | Pull request number to review                    |
| `REPO_OWNER`        | Repository owner (org or user)                   |
| `REPO_NAME`         | Repository name                                  |

### 3. Run locally

```bash
npm run review
```

## GitHub Actions

`.github/workflows/pr-review.yml` runs the review on `pull_request` `opened` and `synchronize` events. It runs
`npm ci` and `npx tsx src/review.ts` at the repository root, so copy this example's `package.json` (with a
committed `package-lock.json`) and `src/review.ts` there too, or add a `working-directory` to those steps.

Add this secret to the target repository:

- `ANTHROPIC_API_KEY` — your Anthropic API key

`GITHUB_TOKEN` is provided by Actions; the workflow grants it `pull-requests: write`.

## Customizing the review

Edit the prompt in `src/review.ts` to focus on specific concerns (security, performance, etc.).

To use a different provider, install it (for example `npm install @robota-sdk/agent-provider-openai`) and swap
`AnthropicProvider` for `OpenAIProvider`.
