const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');

function allowed(member, cfg) {
  if (!member) return false;
  if (cfg.ignoreBots && member.user?.bot) return false;
  if (member.id === member.guild.ownerId) return false;
  const role = cfg.staffRoleId || member.guild.client.config.staff?.roleId;
  if (cfg.ignoreStaff !== false && role && member.roles.cache.has(role)) return false;
  return true;
}

async function initialize(client, config, moduleConfig) {
  const cfg = moduleConfig;
  if (!cfg.channelId) return;
  client.on('messageCreate', async message => {
    if (!message.guild || message.channelId !== cfg.channelId || message.author?.bot) return;
    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!allowed(member, cfg)) return;
    if (cfg.deleteTriggerMessage !== false) await message.delete().catch(() => {});
    const reason = cfg.reason || 'Triggered security trap';
    const action = cfg.action || 'ban';
    const log = client.channels.cache.get(cfg.logChannelId);
    if (log?.isTextBased()) {
      await log.send({ embeds: [new EmbedBuilder().setColor(cfg.color || config.branding.embedColor).setTitle('Security Trap Triggered').setDescription(`${message.author} triggered <#${message.channelId}>\nAction: **${action}**\nReason: ${reason}`).setTimestamp()] }).catch(() => {});
    }
    if (action === 'ban') await message.guild.members.ban(message.author.id, { reason }).catch(() => {});
    else if (action === 'kick') await message.guild.members.kick(message.author.id, reason).catch(() => {});
    else if (action === 'timeout') await member?.timeout(Number(cfg.timeoutDurationMs || 86400000), reason).catch(() => {});
  });
}

const commands = [
  { data: new SlashCommandBuilder().setName('security').setDescription('Security module tools').addSubcommand(s => s.setName('status').setDescription('Show security configuration')), permission: PermissionFlagsBits.ManageGuild, execute: async (i, client) => { const c = client.config.security || {}; await i.reply({ content: `Security: **${c.enabled === true ? 'enabled' : 'disabled'}**\nTrap channel: ${c.channelId ? `<#${c.channelId}>` : 'not configured'}\nAction: **${c.action || 'ban'}**`, ephemeral: true }); } }
];

module.exports = { initialize, commands };
