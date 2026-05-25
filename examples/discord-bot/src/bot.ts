import 'dotenv/config';
import { Client, GatewayIntentBits, ChatInputCommandInteraction, Events } from 'discord.js';
import { createAgentRuntime } from '@robota-sdk/agent-framework';
import { AnthropicProvider } from '@robota-sdk/agent-provider/anthropic';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

if (!DISCORD_TOKEN || !ANTHROPIC_API_KEY) {
  throw new Error('Missing DISCORD_TOKEN or ANTHROPIC_API_KEY');
}

const client = new Client({ intents: [GatewayIntentBits.Guilds] });

const runtime = createAgentRuntime({
  cwd: process.cwd(),
  provider: new AnthropicProvider({ apiKey: ANTHROPIC_API_KEY }),
});

async function handleAskCommand(interaction: ChatInputCommandInteraction): Promise<void> {
  const question = interaction.options.getString('question', true);

  await interaction.deferReply();

  const session = runtime.createSession({
    permissionMode: 'bypassPermissions',
    bare: true,
  });

  let accumulated = '';

  session.on('text_delta', (delta) => {
    accumulated += delta;
  });

  await new Promise<void>((resolve, reject) => {
    session.on('complete', async (result) => {
      const response = result.response || accumulated;
      const chunks = splitIntoChunks(response, 2000);

      try {
        await interaction.editReply(chunks[0] ?? '(no response)');
        for (let i = 1; i < chunks.length; i++) {
          await interaction.followUp(chunks[i]);
        }
        resolve();
      } catch (err) {
        reject(err);
      }
    });

    session.on('error', reject);

    session.submit(question).catch(reject);
  });
}

function splitIntoChunks(text: string, maxLen: number): string[] {
  if (text.length <= maxLen) return [text];
  const chunks: string[] = [];
  for (let i = 0; i < text.length; i += maxLen) {
    chunks.push(text.slice(i, i + maxLen));
  }
  return chunks;
}

client.once(Events.ClientReady, () => {
  console.log(`Discord bot ready: ${client.user?.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (interaction.commandName !== 'ask') return;

  try {
    await handleAskCommand(interaction);
  } catch (err) {
    console.error('Interaction error:', err);
    const msg = { content: 'An error occurred.', ephemeral: true };
    if (interaction.deferred) {
      await interaction.editReply(msg.content).catch(() => undefined);
    } else {
      await interaction.reply(msg).catch(() => undefined);
    }
  }
});

client.login(DISCORD_TOKEN);
