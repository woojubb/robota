# Slack Bot Example

A Slack bot powered by `@robota-sdk/agent-framework` and Anthropic. Uses Socket Mode so no public URL is required.

## Prerequisites

- Node.js 18+
- A Slack workspace where you can create apps
- An Anthropic API key

## Slack App Setup

1. Go to https://api.slack.com/apps and create a new app **From scratch**.

2. Enable **Socket Mode** under _Settings → Socket Mode_. Generate an App-Level Token with `connections:write` scope — this is your `SLACK_APP_TOKEN` (`xapp-...`).

3. Under _OAuth & Permissions → Bot Token Scopes_, add:
   - `app_mentions:read`
   - `chat:write`
   - `channels:history`
   - `groups:history`

4. Under _Event Subscriptions_, enable events and subscribe to the bot event `app_mention`.

5. Install the app to your workspace. Copy the **Bot User OAuth Token** (`xoxb-...`) — this is your `SLACK_BOT_TOKEN`.

6. Copy the **Signing Secret** from _Basic Information → App Credentials_.

## Configuration

```bash
cp .env.example .env
```

Fill in `.env`:

| Variable               | Description                                           |
| ---------------------- | ----------------------------------------------------- |
| `SLACK_BOT_TOKEN`      | Bot User OAuth Token (`xoxb-...`)                     |
| `SLACK_APP_TOKEN`      | App-Level Token with `connections:write` (`xapp-...`) |
| `SLACK_SIGNING_SECRET` | Signing secret from Basic Information                 |
| `ANTHROPIC_API_KEY`    | Anthropic API key (`sk-ant-...`)                      |

## Running

```bash
npm install
npm run dev
```

## Usage

Mention the bot in any channel it has been invited to:

```
@YourBot explain how async/await works in JavaScript
```

Reply in a thread to continue the conversation — session context is preserved per thread.

## How It Works

- `@slack/bolt` in Socket Mode handles inbound events without requiring a public HTTPS endpoint.
- Each `app_mention` event immediately calls `ack()` to satisfy Slack's 3-second acknowledgement requirement.
- A new or resumed `InteractiveSession` is created for each Slack thread (`thread_ts`).
- Streaming text deltas update the reply message in real time via `client.chat.update()`.
- Completed sessions store their `sessionId` keyed by `thread_ts` so follow-up mentions resume the same conversation history.
