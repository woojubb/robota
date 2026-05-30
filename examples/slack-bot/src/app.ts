import 'dotenv/config';
import { App } from '@slack/bolt';
import { createAgentRuntime, createProjectSessionStore } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_SIGNING_SECRET = process.env.SLACK_SIGNING_SECRET;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!SLACK_BOT_TOKEN || !SLACK_APP_TOKEN || !SLACK_SIGNING_SECRET || !ANTHROPIC_API_KEY) {
  throw new Error('Missing required environment variables. See .env.example.');
}

const app = new App({
  token: SLACK_BOT_TOKEN,
  appToken: SLACK_APP_TOKEN,
  signingSecret: SLACK_SIGNING_SECRET,
  socketMode: true,
});

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: ANTHROPIC_API_KEY }),
  sessionStore: createProjectSessionStore(process.cwd()),
});

const threadSessions = new Map<string, string>();

app.event('app_mention', async ({ event, client, ack }) => {
  await ack?.();

  const threadKey = event.thread_ts ?? event.ts;
  const channelId = event.channel;
  const prompt = (event as { text: string }).text.replace(/<@[A-Z0-9]+>/g, '').trim();

  let statusTs: string | undefined;
  try {
    const posted = await client.chat.postMessage({
      channel: channelId,
      thread_ts: threadKey,
      text: '...',
    });
    statusTs = posted.ts as string | undefined;
  } catch {
    // best-effort posting — proceed even if initial message fails
  }

  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
    resumeSessionId: threadSessions.get(threadKey),
  });

  let accumulated = '';

  session.on('text_delta', async (delta) => {
    accumulated += delta;
    if (statusTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: statusTs,
          text: accumulated,
        });
      } catch {
        // ignore rate-limit / update errors
      }
    }
  });

  session.on('complete', async (result) => {
    const sessionId = (result as unknown as { sessionId?: string }).sessionId;
    if (sessionId) {
      threadSessions.set(threadKey, sessionId);
    }
    if (statusTs && result.response) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: statusTs,
          text: result.response,
        });
      } catch {
        // ignore
      }
    }
  });

  session.on('error', async (err) => {
    console.error('Session error:', err);
    if (statusTs) {
      try {
        await client.chat.update({
          channel: channelId,
          ts: statusTs,
          text: `Error: ${err.message}`,
        });
      } catch {
        // ignore
      }
    }
  });

  await session.submit(prompt);
});

(async () => {
  await app.start();
  console.log('Slack bot is running in Socket Mode');
})();
