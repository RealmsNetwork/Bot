require('dotenv').config({ quiet: true });
const { Client, Collection, Events, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { loadConfig } = require('./lib/config');
const { createDatabase } = require('./lib/database');
const { loadModules, refreshCommands } = require('./lib/module-loader');

const config = loadConfig();
const enabled = name => config[name]?.enabled === true;
const intents = [GatewayIntentBits.Guilds];
if (enabled('ai') || enabled('automod') || enabled('logging') || enabled('leveling') || enabled('automation') || enabled('custom-modules')) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
if (enabled('welcome') || enabled('logging') || enabled('autorole') || enabled('countryballs')) intents.push(GatewayIntentBits.GuildMembers);
if (enabled('logging') || enabled('security')) intents.push(GatewayIntentBits.GuildModeration);
if (enabled('tickets') || enabled('community') || enabled('roles') || enabled('countryballs')) intents.push(GatewayIntentBits.GuildMessageReactions);

const client = new Client({ intents: [...new Set(intents)], partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User, Partials.Reaction] });
client.config = config;
client.commands = new Collection();
client.modules = new Collection();
client.startedAt = Date.now();

async function deployCommands() {
  const c = config.commands || {};
  if (c.autoRefresh !== true || !process.env.DISCORD_CLIENT_ID || !process.env.DISCORD_TOKEN) return;
  const commands = [...client.commands.values()].map(x => x.data.toJSON());
  if (!commands.length) return;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = c.guildOnly !== false && config.guildId ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, config.guildId) : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route, { body: commands });
  console.log(`[Commands] Refreshed ${commands.length} commands`);
}

function startAutoRefresh() {
  const c = config.commands || {};
  if (c.autoRefresh !== true) return;
  let signature = [...client.commands.keys()].sort().join('|');
  const interval = Math.max(1000, Number(c.refreshIntervalMs || 5000));
  setInterval(async () => {
    try {
      await refreshCommands(client, config, true);
      const next = [...client.commands.keys()].sort().join('|');
      if (next !== signature) {
        signature = next;
        await deployCommands();
      }
    } catch (e) { console.error('[Commands] Auto-refresh failed:', e.message); }
  }, interval).unref();
}

async function start() {
  if (!process.env.DISCORD_TOKEN) throw new Error('DISCORD_TOKEN is missing');
  client.db = await createDatabase(config);
  await loadModules(client, config);
  client.once(Events.ClientReady, async c => {
    console.log(`[Bot] Online as ${c.user.tag} | ${c.guilds.cache.size} guilds | ${client.commands.size} commands | ${client.modules.size} modules`);
    await deployCommands().catch(e => console.error('[Commands] Deploy failed:', e.message));
    startAutoRefresh();
  });
  client.on(Events.InteractionCreate, async interaction => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      const permission = command.permission || command.requiredPermission;
      if (permission && !interaction.memberPermissions?.has(permission)) return interaction.reply({ content: config.branding?.permissionDenied || 'You do not have permission to use this command.', ephemeral: true });
      await command.execute(interaction, client);
    } catch (e) {
      console.error(`[Command] ${interaction.commandName}:`, e);
      const payload = { content: config.branding?.errorMessage || 'Something went wrong while running that command.', ephemeral: true };
      if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {}); else await interaction.reply(payload).catch(() => {});
    }
  });
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await client.login(process.env.DISCORD_TOKEN);
}

async function shutdown() { try { await client.db?.close?.(); } catch {} try { client.destroy(); } catch {} process.exit(0); }
if (require.main === module) start().catch(e => { console.error('[Startup]', e); process.exit(1); });
module.exports = { client, config, start, deployCommands };
