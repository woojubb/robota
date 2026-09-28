# Slack Bot Example

A Slack bot powered by `@robota-sdk/agent-framework` and Anthropic. Uses Socket Mode so no public URL is required.

## Prerequisites

- Node.js 22.12 or later
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

Fill in `.env` (the app loads it with `dotenv`):

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

The bot answers in a thread under your message.

## How It Works

- `@slack/bolt` in Socket Mode handles inbound events without requiring a public HTTPS endpoint; Bolt
  acknowledges each event itself.
- For each `app_mention`, the bot posts a `...` placeholder in the thread (`thread_ts`, or the mention's own
  `ts`), then creates a session with `runtime.createSession()`.
- Streaming text deltas update the placeholder in real time via `client.chat.update()`, and the final response
  replaces it when the turn completes.
- Session records are written to `.robota/sessions/` in the working directory.

Each thread keeps one conversation: the bot maps `thread_ts` to the session's ID (`session.sessionId`) when a
reply completes and passes it as `resumeSessionId` on the next mention in that thread. The map lives in memory,
so a restart starts every thread fresh.

The session runs with `permissionMode: 'bypassPermissions'` and the default tool set in the bot's working
directory, so anyone who can mention the bot can have the agent read, write and run shell commands there. Run
it on a machine you control, or pass `deniedTools` to `runtime.createSession()` in `src/app.ts`.
