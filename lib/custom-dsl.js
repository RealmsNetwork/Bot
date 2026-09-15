const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const permissionMap = Object.fromEntries(Object.entries(PermissionFlagsBits).map(([k, v]) => [k.toLowerCase(), v]));
function text(value, ctx) { return String(value ?? '').replaceAll('{user.id}', ctx.user?.id || '').replaceAll('{user.name}', ctx.user?.username || ctx.user?.displayName || '').replaceAll('{user.mention}', ctx.user ? `<@${ctx.user.id}>` : '').replaceAll('{guild.id}', ctx.guild?.id || '').replaceAll('{guild.name}', ctx.guild?.name || '').replaceAll('{channel.id}', ctx.channel?.id || '').replaceAll('{channel.mention}', ctx.channel ? `<#${ctx.channel.id}>` : '').replaceAll('{args}', ctx.args?.join(' ') || ''); }

async function reply(ctx, payload) {
  const data = typeof payload === 'string' ? { content: payload } : payload;
  if (ctx.replied || ctx.deferred) return ctx.editReply ? ctx.editReply(data).catch(() => {}) : ctx.channel?.send(data.content).catch(() => {});
  if (ctx.reply) return ctx.reply(data).catch(() => {});
  return ctx.channel?.send(data.content).catch(() => {});
}

async function run(actions, ctx, client) {
  for (const action of actions || []) {
    if (action.reply !== undefined) await reply(ctx, { content: text(action.reply, ctx), ephemeral: action.ephemeral === true });
    else if (action.editReply !== undefined && ctx.editReply) await ctx.editReply({ content: text(action.editReply, ctx) }).catch(() => {});
    else if (action.send !== undefined) await ctx.channel?.send(text(action.send, ctx)).catch(() => {});
    else if (action.dm !== undefined) await ctx.user?.send(text(action.dm, ctx)).catch(() => {});
    else if (action.delete === true) await ctx.deleteReply?.().catch(() => {});
    else if (action.react !== undefined) await (ctx.message?.react ? ctx.message.react(text(action.react, ctx)) : ctx.react?.(text(action.react, ctx)))?.catch?.(() => {});
    else if (action.addRole && ctx.member?.roles) await ctx.member.roles.add(action.addRole).catch(() => {});
    else if (action.removeRole && ctx.member?.roles) await ctx.member.roles.remove(action.removeRole).catch(() => {});
    else if (action.timeout && ctx.member?.timeout) await ctx.member.timeout(Number(action.timeout), text(action.reason || 'Custom module', ctx)).catch(() => {});
    else if (action.wait) await new Promise(resolve => setTimeout(resolve, Math.min(30000, Number(action.wait))));
    else if (action.log) console.log(`[Custom] ${text(action.log, ctx)}`);
  }
}

function buildOption(builder, option) {
  const fn = option.type === 'integer' ? 'addIntegerOption' : option.type === 'number' ? 'addNumberOption' : option.type === 'boolean' ? 'addBooleanOption' : 'addStringOption';
  builder[fn](o => { o.setName(option.name).setDescription(option.description || option.name).setRequired(option.required === true); if (option.min != null && o.setMinValue) o.setMinValue(option.min); if (option.max != null && o.setMaxValue) o.setMaxValue(option.max); return o; });
}
function buildCommands(definition) {
  const output = [];
  for (const item of definition.commands || []) {
    if (!item?.name) continue;
    const builder = new SlashCommandBuilder().setName(item.name).setDescription(item.description || `Custom ${item.name} command`);
    const perm = item.permission ? permissionMap[String(item.permission).toLowerCase()] : undefined;
    if (perm) builder.setDefaultMemberPermissions(perm);
    for (const option of item.options || []) buildOption(builder, option);
    output.push({ data: builder, permission: perm, permissionKey: item.permissionKey || item.name, execute: async interaction => { interaction.args = (item.options || []).map(o => interaction.options.getString?.(o.name) ?? interaction.options.getInteger?.(o.name) ?? interaction.options.getNumber?.(o.name) ?? interaction.options.getBoolean?.(o.name)).filter(x => x !== null && x !== undefined); await run(item.run, interaction, interaction.client); } });
  }
  return output;
}

function buildListeners(definition) {
  const listeners = [];
  for (const [event, rules] of Object.entries(definition.events || {})) {
    const items = Array.isArray(rules) ? rules : [rules];
    for (const item of items) {
      listeners.push({ event, handle: async (...args) => {
        const source = args[0];
        if (item.contains && !String(source?.content || '').toLowerCase().includes(String(item.contains).toLowerCase())) return;
        if (item.equals && String(source?.content || '') !== String(item.equals)) return;
        const ctx = source?.author ? { user: source.author, guild: source.guild, channel: source.channel, message: source, member: source.member, args: String(source.content || '').split(/\s+/).slice(1), channelId: source.channelId, replied: false, reply: content => source.reply(content) } : { user: source?.user || source, guild: source?.guild || source, channel: source?.channel, member: source?.member, args: [], replied: false, reply: content => source?.channel?.send(content) };
        await run(item.run, ctx, source?.client || source?.guild?.client);
      } });
    }
  }
  return listeners;
}

function loadCustomModule(dir) { const file = path.join(dir, 'module.yml'); if (!fs.existsSync(file)) return null; try { return yaml.load(fs.readFileSync(file, 'utf8')) || null; } catch (e) { console.error(`[Custom:${path.basename(dir)}]`, e.message); return null; } }
module.exports = { loadCustomModule, buildCommands, buildListeners, run, text };
