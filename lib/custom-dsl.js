const fs = require('node:fs');
const path = require('node:path');
const yaml = require('js-yaml');
const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const permissionMap = Object.fromEntries(Object.entries(PermissionFlagsBits).map(([k, v]) => [k.toLowerCase(), v]));

function text(value, ctx) {
  return String(value ?? '')
    .replaceAll('{user.id}', ctx.user?.id || '')
    .replaceAll('{user.name}', ctx.user?.username || ctx.user?.displayName || '')
    .replaceAll('{user.mention}', ctx.user ? `<@${ctx.user.id}>` : '')
    .replaceAll('{guild.id}', ctx.guild?.id || '')
    .replaceAll('{guild.name}', ctx.guild?.name || '')
    .replaceAll('{channel.id}', ctx.channel?.id || '')
    .replaceAll('{channel.mention}', ctx.channel ? `<#${ctx.channel.id}>` : '')
    .replaceAll('{args}', ctx.args?.join(' ') || '');
}

async function run(actions, interaction, client) {
  for (const action of actions || []) {
    if (action.reply !== undefined) await interaction.reply({ content: text(action.reply, interaction), ephemeral: action.ephemeral === true }).catch(() => {});
    else if (action.editReply !== undefined) await interaction.editReply(text(action.editReply, interaction)).catch(() => {});
    else if (action.send !== undefined) await interaction.channel?.send(text(action.send, interaction)).catch(() => {});
    else if (action.dm !== undefined) await interaction.user?.send(text(action.dm, interaction)).catch(() => {});
    else if (action.delete === true) await interaction.deleteReply().catch(() => {});
    else if (action.react !== undefined && interaction.message) await interaction.message.react(text(action.react, interaction)).catch(() => {});
    else if (action.addRole && interaction.member?.roles) await interaction.member.roles.add(action.addRole).catch(() => {});
    else if (action.removeRole && interaction.member?.roles) await interaction.member.roles.remove(action.removeRole).catch(() => {});
    else if (action.timeout && interaction.member?.timeout) await interaction.member.timeout(Number(action.timeout), text(action.reason || 'Custom module', interaction)).catch(() => {});
    else if (action.wait) await new Promise(resolve => setTimeout(resolve, Math.min(30000, Number(action.wait))));
    else if (action.log) console.log(`[Custom:${client.modules ? 'module' : 'custom'}] ${text(action.log, interaction)}`);
  }
}

function buildCommands(definition, moduleName) {
  const output = [];
  for (const item of definition.commands || []) {
    if (!item?.name) continue;
    const builder = new SlashCommandBuilder().setName(item.name).setDescription(item.description || `Custom ${item.name} command`);
    const perm = item.permission ? permissionMap[String(item.permission).toLowerCase()] : undefined;
    if (perm) builder.setDefaultMemberPermissions(perm);
    for (const option of item.options || []) {
      if (option.type === 'integer') builder.addIntegerOption(o => o.setName(option.name).setDescription(option.description || option.name).setRequired(option.required === true));
      else builder.addStringOption(o => o.setName(option.name).setDescription(option.description || option.name).setRequired(option.required === true));
    }
    output.push({ data: builder, permission: perm, execute: interaction => run(item.run, interaction, interaction.client) });
  }
  return output;
}

function loadCustomModule(dir) {
  const file = path.join(dir, 'module.yml');
  if (!fs.existsSync(file)) return null;
  try { return yaml.load(fs.readFileSync(file, 'utf8')) || null; } catch (e) { console.error(`[Custom:${path.basename(dir)}]`, e.message); return null; }
}

module.exports = { loadCustomModule, buildCommands, run };
