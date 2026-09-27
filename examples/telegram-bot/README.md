# Telegram Bot Example

A Telegram bot built with [grammy](https://grammy.dev) and the Robota SDK. Each chat maintains its own conversation session, so the bot remembers context within a chat.

## Prerequisites

- Node.js 22.12 or later
- A Telegram bot token from [@BotFather](https://t.me/BotFather)
- An Anthropic API key

## Setup

### 1. Create a Telegram bot

1. Open Telegram and search for `@BotFather`.
2. Send `/newbot` and follow the prompts.
3. Copy the bot token you receive.

### 2. Configure environment variables

```bash
cp .env.example .env
```

Edit `.env` and fill in your values (the bot loads it with `dotenv`):

```
BOT_TOKEN=your_telegram_bot_token_here
ANTHROPIC_API_KEY=your_anthropic_api_key_here
```

### 3. Install dependencies

```bash
npm install
```

## Running

### Development

```bash
npm run dev
```

### Production

```bash
npm run build
npm start
```

## Usage

- `/start` — greeting message
- Any text message that does not start with `/` — sent to the AI and replied to in the same chat

Each message runs in a session resumed by chat ID (`resumeSessionId`), so the bot remembers the conversation
within a chat. Session records are written to `.robota/sessions/` in the working directory, but the chat-ID →
session map lives in memory, so a restart starts every chat fresh.

The session runs with `permissionMode: 'bypassPermissions'` and the default tool set in the bot's working
directory, so anyone who can message the bot can have the agent read, write and run shell commands there. Run
it on a machine you control, or pass `deniedTools` to `runtime.createSession()` in `src/bot.ts`.
