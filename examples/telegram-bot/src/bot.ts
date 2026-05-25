import 'dotenv/config';
import { Bot } from 'grammy';
import { createAgentRuntime, createProjectSessionStore } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const BOT_TOKEN = process.env.BOT_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!BOT_TOKEN || !ANTHROPIC_API_KEY) {
  throw new Error('Missing required environment variables. See .env.example.');
}

const bot = new Bot(BOT_TOKEN);

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: ANTHROPIC_API_KEY }),
  sessionStore: createProjectSessionStore(process.cwd()),
});

const chatSessions = new Map<number, string>();

async function handleMessage(chatId: number, prompt: string): Promise<void> {
  await bot.api.sendChatAction(chatId, 'typing');

  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
    resumeSessionId: chatSessions.get(chatId),
  });

  let accumulated = '';

  session.on('text_delta', (delta) => {
    accumulated += delta;
  });

  session.on('complete', async (result) => {
    const sessionId = session.getSession().getSessionId();
    chatSessions.set(chatId, sessionId);

    const text = result.response || accumulated;
    if (text) {
      await bot.api.sendMessage(chatId, text);
    }
  });

  session.on('error', async (err) => {
    console.error('Session error:', err);
    await bot.api.sendMessage(chatId, `Error: ${err.message}`);
  });

  await session.submit(prompt);
}

bot.command('start', async (ctx) => {
  await ctx.reply(
    'Hello! I am an AI assistant powered by Robota SDK. Send me any message and I will respond.',
  );
});

bot.on('message:text', async (ctx) => {
  const chatId = ctx.chat.id;
  const prompt = ctx.message.text;

  if (prompt.startsWith('/')) return;

  await handleMessage(chatId, prompt);
});

bot.catch((err) => {
  console.error('Bot error:', err);
});

bot.start({
  onStart: (info) => {
    console.log(`Telegram bot @${info.username} is running`);
  },
});
