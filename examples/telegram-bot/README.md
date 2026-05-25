# Telegram Bot Example

A Telegram bot built with [grammy](https://grammy.dev) and the Robota SDK. Each chat maintains its own conversation session, so the bot remembers context within a chat.

## Prerequisites

- Node.js 18+
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

Edit `.env` and fill in your values:

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
- Any other text message — sent to the AI and replied to in the same chat

Sessions are persisted per chat ID, so the bot remembers the conversation history across messages within each chat.
