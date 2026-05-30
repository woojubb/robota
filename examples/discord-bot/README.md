# Discord Bot

AI assistant Discord bot using `discord.js` v14 and `@robota-sdk/agent-framework`. Responds to `/ask` slash commands.

## Setup

### 1. Create a Discord application

1. Go to the [Discord Developer Portal](https://discord.com/developers/applications)
2. Create a new application and add a Bot
3. Enable the `applications.commands` scope and `bot` scope
4. Copy the **Bot Token**, **Client ID**, and note your test **Guild (Server) ID**

### 2. Invite the bot

Generate an invite URL with these scopes: `bot`, `applications.commands`
Required permission: `Send Messages`

### 3. Install dependencies

```bash
npm install
```

### 4. Configure environment variables

```bash
cp .env.example .env
```

| Variable            | Description                                            |
| ------------------- | ------------------------------------------------------ |
| `DISCORD_TOKEN`     | Bot token from the Developer Portal                    |
| `DISCORD_CLIENT_ID` | Application Client ID                                  |
| `DISCORD_GUILD_ID`  | Test server ID (for guild-scoped command registration) |
| `ANTHROPIC_API_KEY` | Your Anthropic API key                                 |

### 5. Register slash commands

```bash
npm run deploy
```

This registers the `/ask` command to your test guild. Guild commands update instantly; global commands take up to an hour.

### 6. Start the bot

```bash
npm run dev
```

## Usage

In any channel where the bot has access:

```
/ask question: What is the difference between TypeScript interfaces and types?
```

The bot defers the reply immediately, then streams the AI response and edits the deferred message when complete. Responses longer than 2000 characters are split into follow-up messages.

## Deploying globally

Change `Routes.applicationGuildCommands(...)` to `Routes.applicationCommands(...)` in `src/deploy-commands.ts` to register commands globally (takes up to 1 hour to propagate).
