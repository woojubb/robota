# @robota-sdk/plugin-linear

Linear issue tracking plugin for Robota SDK.

Provides `LinearPlugin` — a Robota plugin that searches and creates Linear issues so
the agent can reference tickets or file new ones during a session.

## Installation

```bash
npm install @robota-sdk/plugin-linear
```

## Prerequisites

A Linear API Key. Generate one at <https://linear.app/settings/api>.

## Usage

```typescript
import { LinearPlugin } from '@robota-sdk/plugin-linear';

const linear = new LinearPlugin({ apiKey: process.env.LINEAR_API_KEY! });

// Register with your Robota agent
agent.use(linear);

// Use directly
const issue = await linear.getIssue('TEAM-123');
const results = await linear.searchIssues('login crash', undefined, 5);
const teams = await linear.getTeams();
await linear.createIssue({
  teamId: teams[0].id,
  title: 'Fix login crash on mobile',
  description: 'Reproducible on iOS 17',
});
```

## API

### `new LinearPlugin(options)`

| Option   | Type     | Required | Description    |
| -------- | -------- | -------- | -------------- |
| `apiKey` | `string` | Yes      | Linear API Key |

### Methods

| Method                                 | Description                |
| -------------------------------------- | -------------------------- |
| `getIssue(issueId)`                    | Fetch a single issue by ID |
| `searchIssues(query, teamId?, limit?)` | Full-text issue search     |
| `createIssue(input)`                   | Create a new issue         |
| `getTeams()`                           | List all accessible teams  |

## Environment Variable

```bash
export LINEAR_API_KEY=lin_api_...
```
