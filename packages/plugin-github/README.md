# @robota-sdk/plugin-github

GitHub PR and Issue context plugin for Robota SDK.

Provides `GitHubPlugin` — a Robota plugin that fetches GitHub issues and pull requests
so the agent can reference them as live context during a session.

## Installation

```bash
npm install @robota-sdk/plugin-github
```

## Prerequisites

A GitHub Personal Access Token with `repo` (or `public_repo`) scope.
Generate one at <https://github.com/settings/tokens>.

## Usage

```typescript
import { GitHubPlugin } from '@robota-sdk/plugin-github';

const github = new GitHubPlugin({ token: process.env.GITHUB_TOKEN! });

// Register with your Robota agent
agent.use(github);

// Use directly
const pr = await github.getPR('owner', 'repo', 42);
const issues = await github.listOpenIssues('owner', 'repo', 5);
```

## API

### `new GitHubPlugin(options)`

| Option  | Type     | Required | Description                  |
| ------- | -------- | -------- | ---------------------------- |
| `token` | `string` | Yes      | GitHub Personal Access Token |

### Methods

| Method                                | Description                    |
| ------------------------------------- | ------------------------------ |
| `getIssue(owner, repo, number)`       | Fetch a single issue           |
| `getPR(owner, repo, number)`          | Fetch a single pull request    |
| `listOpenIssues(owner, repo, limit?)` | List open issues (default: 10) |

## Environment Variable

```bash
export GITHUB_TOKEN=ghp_...
```
