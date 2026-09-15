const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { PermissionFlagsBits, SlashCommandBuilder, EmbedBuilder } = require('discord.js');

const permissionMap = Object.fromEntries(Object.entries(PermissionFlagsBits).map(([k, v]) => [k.toLowerCase(), v]));
const MAX_WAIT = 30000;

function get(ctx, key, fallback = '') {
  if (key == null) return fallback;
  const parts = String(key).split('.');
  let value = ctx;
  for (const part of parts) value = value?.[part];
  return value ?? fallback;
}

function render(value, ctx) {
  return String(value ?? '')
    .replaceAll('{user.id}', ctx.user?.id || '')
    .replaceAll('{user.name}', ctx.user?.username || ctx.user?.globalName || '')
    .replaceAll('{user.mention}', ctx.user ? `<@${ctx.user.id}>` : '')
    .replaceAll('{guild.id}', ctx.guild?.id || '')
    .replaceAll('{guild.name}', ctx.guild?.name || '')
    .replaceAll('{channel.id}', ctx.channel?.id || '')
    .replaceAll('{channel.mention}', ctx.channel ? `<#${ctx.channel.id}>` : '')
    .replaceAll('{command}', ctx.commandName || '')
    .replaceAll('{args}', ctx.args?.join(' ') || '')
    .replaceAll('{reason}', ctx.reason || '')
    .replace(/\{var\.([\w.-]+)\}/g, (_, key) => String(ctx.vars?.[key] ?? ''));
}

function valueOf(value, interaction, ctx) {
  if (typeof value !== 'string') return value;
  if (value.startsWith('$')) return get(ctx, value.slice(1), '');
  return render(value, interaction);
}

function matches(condition, interaction, ctx) {
  if (!condition) return true;
  if (typeof condition === 'boolean') return condition;
  if (condition.not) return !matches(condition.not, interaction, ctx);
  if (condition.all) return condition.all.every(x => matches(x, interaction, ctx));
  if (condition.any) return condition.any.some(x => matches(x, interaction, ctx));
  if (condition.equals) return String(valueOf(condition.equals[0], interaction, ctx)) === String(valueOf(condition.equals[1], interaction, ctx));
  if (condition.contains) return String(valueOf(condition.contains[0], interaction, ctx)).includes(String(valueOf(condition.contains[1], interaction, ctx)));
  if (condition.startsWith) return String(valueOf(condition.startsWith[0], interaction, ctx)).startsWith(String(valueOf(condition.startsWith[1], interaction, ctx)));
  if (condition.endsWith) return String(valueOf(condition.endsWith[0], interaction, ctx)).endsWith(String(valueOf(condition.endsWith[1], interaction, ctx)));
  if (condition.exists !== undefined) return get(ctx, condition.exists, null) != null;
  if (condition.numberGt) return Number(valueOf(condition.numberGt[0], interaction, ctx)) > Number(valueOf(condition.numberGt[1], interaction, ctx));
  if (condition.numberGte) return Number(valueOf(condition.numberGte[0], interaction, ctx)) >= Number(valueOf(condition.numberGte[1], interaction, ctx));
  if (condition.numberLt) return Number(valueOf(condition.numberLt[0], interaction, ctx)) < Number(valueOf(condition.numberLt[1], interaction, ctx));
  if (condition.numberLte) return Number(valueOf(condition.numberLte[0], interaction, ctx)) <= Number(valueOf(condition.numberLte[1], interaction, ctx));
  if (condition.hasPermission) return !!interaction.memberPermissions?.has(permissionMap[String(condition.hasPermission).toLowerCase()] || String(condition.hasPermission));
  if (condition.role) return !!interaction.member?.roles?.cache?.has(String(valueOf(condition.role, interaction, ctx)));
  return true;
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, { redirect: 'follow', ...options });
  const text = await response.text();
  let data;
  try { data = JSON.parse(text); } catch { data = text; }
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return data;
}

async function run(actions, interaction, client, ctx = { vars: {} }) {
  for (const action of actions || []) {
    if (action.if && matches(action.if, interaction, ctx)) await run(action.then || [], interaction, client, ctx);
    if (action.unless && !matches(action.unless, interaction, ctx)) await run(action.then || action.run || [], interaction, client, ctx);
    else if (action.reply !== undefined) await interaction.reply({ content: render(action.reply, { ...interaction, ...ctx }), ephemeral: action.ephemeral === true }).catch(() => {});
    else if (action.editReply !== undefined) await interaction.editReply({ content: render(action.editReply, { ...interaction, ...ctx }) }).catch(() => {});
    else if (action.send !== undefined) await interaction.channel?.send({ content: render(action.send, { ...interaction, ...ctx }) }).catch(() => {});
    else if (action.dm !== undefined) await interaction.user?.send({ content: render(action.dm, { ...interaction, ...ctx }) }).catch(() => {});
    else if (action.react !== undefined && interaction.message) await interaction.message.react(render(action.react, { ...interaction, ...ctx })).catch(() => {});
    else if (action.deleteReply === true) await interaction.deleteReply().catch(() => {});
    else if (action.delete === true && interaction.message) await interaction.message.delete().catch(() => {});
    else if (action.addRole && interaction.member?.roles) await interaction.member.roles.add(render(action.addRole, { ...interaction, ...ctx }), render(action.reason || 'Custom module', { ...interaction, ...ctx })).catch(() => {});
    else if (action.removeRole && interaction.member?.roles) await interaction.member.roles.remove(render(action.removeRole, { ...interaction, ...ctx }), render(action.reason || 'Custom module', { ...interaction, ...ctx })).catch(() => {});
    else if (action.timeout !== undefined && interaction.member?.timeout) await interaction.member.timeout(Number(valueOf(action.timeout, interaction, ctx)), render(action.reason || 'Custom module', { ...interaction, ...ctx })).catch(() => {});
    else if (action.kick === true && interaction.member?.kick) await interaction.member.kick(render(action.reason || 'Custom module', { ...interaction, ...ctx })).catch(() => {});
    else if (action.ban === true && interaction.member?.ban) await interaction.member.ban({ reason: render(action.reason || 'Custom module', { ...interaction, ...ctx }) }).catch(() => {});
    else if (action.wait !== undefined) await new Promise(resolve => setTimeout(resolve, Math.min(MAX_WAIT, Math.max(0, Number(valueOf(action.wait, interaction, ctx))))));
    else if (action.log !== undefined) console.log(`[Custom] ${render(action.log, { ...interaction, ...ctx })}`);
    else if (action.set) ctx.vars[String(action.set.name)] = valueOf(action.set.value, interaction, ctx);
    else if (action.add) ctx.vars[String(action.add.name)] = Number(ctx.vars[String(action.add.name)] || 0) + Number(valueOf(action.add.value, interaction, ctx));
    else if (action.random) { const list = Array.isArray(action.random.values) ? action.random.values : []; ctx.vars[String(action.random.name)] = list[Math.floor(Math.random() * list.length)]; }
    else if (action.dbGet) ctx.vars[String(action.dbGet.name)] = await client.db.get(interaction.guildId, String(action.dbGet.key), action.dbGet.default ?? null);
    else if (action.dbSet) await client.db.set(interaction.guildId, String(action.dbSet.key), valueOf(action.dbSet.value, interaction, ctx));
    else if (action.dbIncrement) ctx.vars[String(action.dbIncrement.name || action.dbIncrement.key)] = await client.db.increment(interaction.guildId, String(action.dbIncrement.key), Number(action.dbIncrement.amount || 1));
    else if (action.http) ctx.vars[String(action.http.name || 'http')] = await requestJson(render(action.http.url, { ...interaction, ...ctx }), { method: action.http.method || 'GET', headers: action.http.headers || {}, body: action.http.body ? JSON.stringify(action.http.body) : undefined });
    else if (action.embed) { const e = new EmbedBuilder(); if (action.embed.title) e.setTitle(render(action.embed.title, { ...interaction, ...ctx })); if (action.embed.description) e.setDescription(render(action.embed.description, { ...interaction, ...ctx })); if (action.embed.color) e.setColor(action.embed.color); if (action.embed.url) e.setURL(render(action.embed.url, { ...interaction, ...ctx })); if (action.embed.footer) e.setFooter({ text: render(action.embed.footer, { ...interaction, ...ctx }) }); await interaction.channel?.send({ embeds: [e] }).catch(() => {}); }
    else if (action.renameChannel && interaction.channel) await interaction.channel.setName(render(action.renameChannel, { ...interaction, ...ctx })).catch(() => {});
    else if (action.topic && interaction.channel) await interaction.channel.setTopic(render(action.topic, { ...interaction, ...ctx })).catch(() => {});
    else if (action.run) await run(action.run, interaction, client, ctx);
  }
  return ctx;
}

function buildOptions(builder, options = []) {
  for (const option of options) {
    const name = String(option.name).replace(/[^a-z0-9_-]/gi, '').slice(0, 32);
    if (!name) continue;
    const apply = o => o.setName(name).setDescription(String(option.description || name).slice(0, 100)).setRequired(option.required === true);
    if (option.type === 'integer') builder.addIntegerOption(o => apply(o).setMinValue(option.min).setMaxValue(option.max));
    else if (option.type === 'number') builder.addNumberOption(o => apply(o).setMinValue(option.min).setMaxValue(option.max));
    else if (option.type === 'boolean') builder.addBooleanOption(apply);
    else if (option.type === 'user') builder.addUserOption(apply);
    else if (option.type === 'role') builder.addRoleOption(apply);
    else if (option.type === 'channel') builder.addChannelOption(apply);
    else builder.addStringOption(o => apply(o).setAutocomplete(option.autocomplete === true).setMinLength(option.minLength).setMaxLength(option.maxLength));
  }
}

function buildCommands(definition) {
  const output = [];
  for (const item of definition.commands || []) {
    if (!item?.name) continue;
    const builder = new SlashCommandBuilder().setName(String(item.name).slice(0, 32)).setDescription(String(item.description || `Custom ${item.name} command`).slice(0, 100));
    if (item.nsfw === true) builder.setNSFW(true);
    if (item.permission && permissionMap[String(item.permission).toLowerCase()]) builder.setDefaultMemberPermissions(permissionMap[String(item.permission).toLowerCase()]);
    buildOptions(builder, item.options);
    output.push({ data: builder, requiredPermission: item.permission, permissionGroup: item.group, permissionKey: item.permissionKey || item.name, execute: async (interaction, client) => {
      const args = [];
      for (const option of interaction.options.data) args.push(String(option.value));
      return run(item.run || [], interaction, client, { args, vars: {}, commandName: item.name });
    }});
  }
  return output;
}

function buildListeners(definition) {
  const listeners = [];
  for (const [event, rules] of Object.entries(definition.events || {})) {
    if (!Array.isArray(rules)) continue;
    for (const rule of rules) listeners.push({ event, handle: async (...args) => {
      const subject = args[0];
      const content = String(subject?.content || '');
      const ctx = { args: content.split(/\s+/).filter(Boolean), vars: {}, message: subject, user: subject?.author, guild: subject?.guild, channel: subject?.channel };
      if (rule.contains && !content.toLowerCase().includes(String(rule.contains).toLowerCase())) return;
      if (rule.equals && content !== String(rule.equals)) return;
      if (rule.userId && subject?.authorId !== String(rule.userId)) return;
      await run(rule.run || [], subject?.isCommand ? subject : { ...subject, ...ctx }, args[0]?.client || args[0]?.clientRef || null, ctx);
    }});
  }
  return listeners;
}

function loadCustomModule(dir) {
  const file = path.join(dir, 'module.yml');
  if (!fs.existsSync(file)) return null;
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || null; }
  catch (e) { console.error(`[Custom:${path.basename(dir)}]`, e.message); return null; }
}

module.exports = { loadCustomModule, buildCommands, buildListeners, run, matches };
