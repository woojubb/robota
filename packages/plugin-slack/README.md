# @robota-sdk/plugin-slack

Slack messaging plugin for Robota SDK.

Provides `SlackPlugin` — a Robota plugin that posts messages to Slack channels and
reads channel history so the agent can notify or query Slack during a session.

## Installation

```bash
npm install @robota-sdk/plugin-slack
```

## Prerequisites

A Slack Bot Token (`xoxb-...`) with `chat:write` and `channels:history` scopes.
Create a Slack App at <https://api.slack.com/apps> and install it to your workspace.

## Usage

```typescript
import { SlackPlugin } from '@robota-sdk/plugin-slack';

const slack = new SlackPlugin({
  token: process.env.SLACK_BOT_TOKEN!,
  defaultChannel: '#general',
});

// Register with your Robota agent
agent.use(slack);

// Use directly
await slack.postMessage('#general', 'Deploy complete!');
await slack.postToDefault('Agent finished the task.');
const history = await slack.getHistory('#general', 20);
```

## API

### `new SlackPlugin(options)`

| Option           | Type     | Required | Description                           |
| ---------------- | -------- | -------- | ------------------------------------- |
| `token`          | `string` | Yes      | Slack Bot Token (`xoxb-...`)          |
| `defaultChannel` | `string` | No       | Default channel for `postToDefault()` |

### Methods

| Method                              | Description                   |
| ----------------------------------- | ----------------------------- |
| `postMessage(channel, text, opts?)` | Post to a specific channel    |
| `postToDefault(text, opts?)`        | Post to `defaultChannel`      |
| `getHistory(channel, limit?)`       | Fetch channel message history |

## Environment Variable

```bash
export SLACK_BOT_TOKEN=xoxb-...
```

## Package Specification

Full architecture, type ownership, public API surface, and class contracts are documented in
[docs/SPEC.md](docs/SPEC.md).
