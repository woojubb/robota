import 'dotenv/config';
import { REST, Routes } from 'discord.js';
import { SlashCommandBuilder } from 'discord.js';

const DISCORD_TOKEN = process.env.DISCORD_TOKEN;
const DISCORD_CLIENT_ID = process.env.DISCORD_CLIENT_ID;
const DISCORD_GUILD_ID = process.env.DISCORD_GUILD_ID;

if (!DISCORD_TOKEN || !DISCORD_CLIENT_ID || !DISCORD_GUILD_ID) {
  throw new Error('Missing DISCORD_TOKEN, DISCORD_CLIENT_ID, or DISCORD_GUILD_ID');
}

const commands = [
  new SlashCommandBuilder()
    .setName('ask')
    .setDescription('Ask the AI assistant a question')
    .addStringOption((opt) =>
      opt.setName('question').setDescription('Your question').setRequired(true),
    )
    .toJSON(),
];

const rest = new REST().setToken(DISCORD_TOKEN);

(async () => {
  console.log('Registering slash commands...');
  await rest.put(Routes.applicationGuildCommands(DISCORD_CLIENT_ID!, DISCORD_GUILD_ID!), {
    body: commands,
  });
  console.log('Slash commands registered.');
})();
