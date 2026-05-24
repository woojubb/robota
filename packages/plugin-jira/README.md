# @robota-sdk/plugin-jira

Jira ticket tracking plugin for Robota SDK.

Provides `JiraPlugin` — a Robota plugin that fetches and creates Jira issues so the
agent can query ticket status or file new issues during a session.

## Installation

```bash
npm install @robota-sdk/plugin-jira
```

## Prerequisites

A Jira API Token. Generate one at <https://id.atlassian.com/manage-profile/security/api-tokens>.

## Usage

```typescript
import { JiraPlugin } from '@robota-sdk/plugin-jira';

const jira = new JiraPlugin({
  baseUrl: 'https://your-org.atlassian.net',
  email: 'you@example.com',
  apiToken: process.env.JIRA_API_TOKEN!,
});

// Register with your Robota agent
agent.use(jira);

// Use directly
const issue = await jira.getIssue('PROJ-123');
const bugs = await jira.searchIssues('project = PROJ AND issuetype = Bug AND status = Open');
await jira.createIssue({
  projectKey: 'PROJ',
  summary: 'Fix login crash on mobile',
  issueType: 'Bug',
});
```

## API

### `new JiraPlugin(options)`

| Option     | Type     | Required | Description                                 |
| ---------- | -------- | -------- | ------------------------------------------- |
| `baseUrl`  | `string` | Yes      | Jira base URL (`https://org.atlassian.net`) |
| `email`    | `string` | Yes      | Atlassian account email                     |
| `apiToken` | `string` | Yes      | Jira API Token                              |

### Methods

| Method                      | Description                 |
| --------------------------- | --------------------------- |
| `getIssue(issueKey)`        | Fetch a single issue by key |
| `searchIssues(jql, limit?)` | Search issues using JQL     |
| `createIssue(input)`        | Create a new issue          |
| `getProjects(limit?)`       | List accessible projects    |

## Environment Variable

```bash
export JIRA_API_TOKEN=...
```

## Specification

See [`docs/SPEC.md`](docs/SPEC.md) for architecture, type ownership, public API surface, and contract details.
