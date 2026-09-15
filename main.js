require('dotenv').config();
const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { Client, Collection, Events, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { loadConfig } = require('./lib/config');
const { createDatabase } = require('./lib/database');
const { loadModules } = require('./lib/module-loader');

const config = loadConfig();
const enabled = name => config[name]?.enabled === true;

const intents = [GatewayIntentBits.Guilds];
if (enabled('aichat') || enabled('automod') || enabled('logging') || enabled('leveling')) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
if (enabled('welcome') || enabled('logging') || enabled('autorole')) intents.push(GatewayIntentBits.GuildMembers);
if (enabled('logging')) intents.push(GatewayIntentBits.GuildModeration);
if (enabled('tickets') || enabled('community')) intents.push(GatewayIntentBits.GuildMessageReactions);
const client = new Client({ intents, partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User, Partials.Reaction] });
client.config = config;
client.commands = new Collection();
client.startedAt = Date.now();

async function deployCommands() {
  const commands = [...client.commands.values()].map(c => c.data.toJSON());
  if (!config.commands?.autoDeploy || !process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID || !commands.length) return;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = config.commands.guildOnly && config.guildId
    ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, config.guildId)
    : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log(`[Commands] Deployed ${commands.length} commands`);
}

async function start() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is missing');
  client.db = await createDatabase(config);
  await loadModules(client, config);
  client.once(Events.ClientReady, async c => {
    console.log(`[Bot] Online as ${c.user.tag} | ${c.guilds.cache.size} guilds`);
    try { await deployCommands(); } catch (e) { console.error('[Commands] Deploy failed:', e.message); }
  });
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      if (command.permission && !interaction.memberPermissions?.has(command.permission)) {
        return interaction.reply({ content: 'You do not have permission to use this command.', ephemeral: true });
      }
      await command.execute(interaction, client);
    } catch (e) {
      console.error(`[Command] ${interaction.commandName}:`, e);
      const payload = { content: 'Something went wrong while running that command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {});
      else await interaction.reply(payload).catch(() => {});
    }
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await client.login(process.env.DISCORD_TOKEN);
}

async function shutdown() {
  try { await client.db?.close?.(); } catch {}
  try { client.destroy(); } catch {}
  process.exit(0);
}

if (require.main === module) start().catch(e => { console.error('[Startup]', e); process.exit(1); });
module.exports = { client, config, start };
