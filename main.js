require('dotenv').config({ quiet: true });
const { Client, Collection, Events, GatewayIntentBits, Partials, REST, Routes } = require('discord.js');
const { loadConfig } = require('./lib/config');
const { createDatabase } = require('./lib/database');
const { loadModules, refreshCommands } = require('./lib/module-loader');
const { authorize } = require('./lib/permissions');

const config = loadConfig();
const enabled = name => config[name]?.enabled === true;
const intents = [GatewayIntentBits.Guilds];
if (enabled('ai') || enabled('automod') || enabled('logging') || enabled('leveling') || enabled('automation') || config.customModules?.enabled) intents.push(GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent);
if (enabled('welcome') || enabled('logging') || enabled('autorole') || enabled('countryballs')) intents.push(GatewayIntentBits.GuildMembers);
if (enabled('logging') || enabled('security')) intents.push(GatewayIntentBits.GuildModeration);
if (enabled('tickets') || enabled('community') || enabled('roles') || enabled('countryballs')) intents.push(GatewayIntentBits.GuildMessageReactions);

const client = new Client({ intents: [...new Set(intents)], partials: [Partials.Channel, Partials.Message, Partials.GuildMember, Partials.User, Partials.Reaction] });
client.config = config;
client.commands = new Collection();
client.contextMenus = new Collection();
client.modules = new Collection();
client.cooldowns = new Map();
client.metrics = { commands: 0, errors: 0, startedAt: Date.now() };
client.framework = Object.freeze({ version: 3, name: 'RealmsNetwork Bot Framework', reloadCommands: () => refreshCommands(client, config) });

async function deployCommands() {
  const c = config.commands || {};
  if (c.autoDeploy !== true || !process.env.DISCORD_TOKEN || !process.env.DISCORD_CLIENT_ID) return;
  const body = [
    ...[...client.commands.values()].map(x => x.data.toJSON()),
    ...[...client.contextMenus.values()].map(x => x.data.toJSON())
  ];
  if (!body.length) return;
  const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
  const route = c.guildOnly !== false && config.guildId ? Routes.applicationGuildCommands(process.env.DISCORD_CLIENT_ID, config.guildId) : Routes.applicationCommands(process.env.DISCORD_CLIENT_ID);
  await rest.put(route, { body });
  console.log(`[Commands] Synced ${body.length} application commands`);
}

function commandSignature() {
  const slash = [...client.commands.values()].map(x => x.data.toJSON()).sort((a,b) => a.name.localeCompare(b.name));
  const context = [...client.contextMenus.values()].map(x => x.data.toJSON()).sort((a,b) => String(a.name).localeCompare(String(b.name)));
  return JSON.stringify({ slash, context });
}

function cooldownSeconds(command) { return Math.max(0, Number(command.cooldown ?? config.commands?.defaultCooldownSeconds ?? 0)); }
function checkCooldown(command, interaction) {
  const seconds = cooldownSeconds(command);
  if (!seconds) return 0;
  const key = `${interaction.user.id}:${command.data.name}`;
  const now = Date.now(), previous = client.cooldowns.get(key) || 0, remaining = seconds * 1000 - (now - previous);
  if (remaining > 0) return Math.ceil(remaining / 1000);
  client.cooldowns.set(key, now);
  if (client.cooldowns.size > Number(config.runtime?.cacheSize || 1000) * 2) for (const [k, ts] of client.cooldowns) if (now - ts > seconds * 1000) client.cooldowns.delete(k);
  return 0;
}

function getCommand(interaction) {
  if (interaction.isChatInputCommand()) return client.commands.get(interaction.commandName);
  if (interaction.isUserContextMenuCommand() || interaction.isMessageContextMenuCommand()) return client.contextMenus.get(interaction.commandName);
  return null;
}

async function executeInteraction(interaction) {
  const command = getCommand(interaction);
  if (!command) return;
  try {
    if (!authorize(interaction, command, client.config)) return interaction.reply({ content: client.config.branding?.permissionDenied || 'You do not have permission to use this command.', ephemeral: true });
    const left = checkCooldown(command, interaction);
    if (left) return interaction.reply({ content: `Please wait **${left}s** before using this again.`, ephemeral: true });
    client.metrics.commands++;
    await command.execute(interaction, client);
  } catch (e) {
    client.metrics.errors++;
    console.error(`[Command] ${interaction.commandName}:`, e);
    const payload = { content: client.config.branding?.errorMessage || 'Something went wrong while running that command.', ephemeral: true };
    if (interaction.replied || interaction.deferred) await interaction.followUp(payload).catch(() => {}); else await interaction.reply(payload).catch(() => {});
  }
}

function startAutoRefresh() {
  const c = config.commands || {};
  if (c.autoRefresh !== true) return;
  let signature = commandSignature();
  const interval = Math.max(1000, Number(c.refreshIntervalMs || 5000));
  const timer = setInterval(async () => {
    try {
      await refreshCommands(client, config, true);
      const next = commandSignature();
      if (next !== signature) { signature = next; await deployCommands(); }
    } catch (e) { console.error('[Commands] Auto-refresh failed:', e.message); }
  }, interval);
  timer.unref?.();
}

async function start() {
  if (!process.env.DISCORD_TOKEN || process.env.DISCORD_TOKEN === 'YOUR_BOT_TOKEN_HERE') throw new Error('DISCORD_TOKEN is missing');
  client.db = await createDatabase(config);
  await loadModules(client, config);
  client.once(Events.ClientReady, async c => {
    console.log(`[Bot] Online as ${c.user.tag} | ${c.guilds.cache.size} guilds | ${client.commands.size + client.contextMenus.size} commands | ${client.modules.size} modules`);
    await deployCommands().catch(e => console.error('[Commands] Deploy failed:', e.message));
    startAutoRefresh();
  });
  client.on(Events.InteractionCreate, executeInteraction);
  process.once('SIGINT', shutdown);
  process.once('SIGTERM', shutdown);
  await client.login(process.env.DISCORD_TOKEN);
}
async function shutdown() { try { await client.db?.close?.(); } catch {} try { client.destroy(); } catch {} process.exit(0); }
if (require.main === module) start().catch(e => { console.error('[Startup]', e); process.exit(1); });
module.exports = { client, config, start, deployCommands, executeInteraction };
