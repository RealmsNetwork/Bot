const { EmbedBuilder, PermissionFlagsBits, SlashCommandBuilder } = require('discord.js');
const { targetGuard, isBanned } = require('../../lib/guards');

function allowed(member, cfg) {
  if (!member) return false;
  if (member.id === member.guild.ownerId) return false;
  if (member.id === member.client?.user?.id) return false;
  if (cfg.ignoreBots !== false && member.user?.bot) return false;
  if (cfg.ignoreStaff !== false && cfg.staffRoleId && member.roles.cache.has(String(cfg.staffRoleId))) return false;
  return true;
}

async function punish(member, action, reason, cfg) {
  if (!member) return false;
  const guard = targetGuard(member.client, member, { action });
  if (guard) { console.warn(`[Security] Refusing ${action} for ${member.user?.tag || member.id}: ${guard}`); return false; }
  try {
    if (action === 'ban') {
      if (await isBanned(member.guild, member.id)) return false;
      await member.ban({ reason, deleteMessageSeconds: Math.max(0, Math.min(604800, Number(cfg.deleteMessageSeconds || 0))) });
      return true;
    }
    if (action === 'kick') {
      await member.kick(reason);
      return true;
    }
    if (action === 'timeout') {
      await member.timeout(Number(cfg.timeoutDurationMs || 86400000), reason);
      return true;
    }
    return false;
  } catch (error) {
    console.error(`[Security] Failed to ${action} ${member.user?.tag || member.id}:`, error?.message || error);
    return false;
  }
}

async function logTrigger(client, config, message, action, reason, cfg) {
  if (!cfg.logChannelId) return;
  const log = await client.channels.fetch(String(cfg.logChannelId)).catch(() => null);
  if (!log?.isTextBased()) return;
  await log.send({
    embeds: [
      new EmbedBuilder()
        .setColor(cfg.color || config.branding?.embedColor || '#8b5cf6')
        .setTitle(cfg.logTitle || 'Security Triggered')
        .setDescription(`${message.author} triggered the security system in ${message.channel}\nAction: **${action}**\nReason: ${reason}`)
        .setTimestamp()
    ]
  }).catch(error => console.error('[Security] Failed to send log:', error?.message || error));
}

async function initialize(client, config, moduleConfig) {
  const cfg = moduleConfig || {};
  const channelId = cfg.channelId ? String(cfg.channelId) : '';
  if (cfg.enabled === false) return;
  const patterns = Array.isArray(cfg.patterns) ? cfg.patterns.filter(Boolean) : [];

  if (!channelId && !patterns.length) {
    console.warn('[Security] No trap channel or patterns configured. Module is loaded but has nothing to monitor.');
    return;
  }

  const trap = async (message, reason = cfg.reason || 'Triggered security trap') => {
    if (!message.guild) return;
    if (message.author?.bot && cfg.ignoreBots !== false) return;

    const member = message.member || await message.guild.members.fetch(message.author.id).catch(() => null);
    if (!allowed(member, cfg)) return;

    const action = String(cfg.action || 'ban').toLowerCase();
    if (cfg.requireReason === true && !String(reason || '').trim()) return;
    if (action === 'ban' && await isBanned(message.guild, member.id)) return;
    if (!['ban', 'kick', 'timeout'].includes(action)) {
      console.error(`[Security] Invalid action "${action}". Expected ban, kick, or timeout.`);
      return;
    }

    if (cfg.deleteTriggerMessage !== false) {
      await message.delete().catch(error => console.error('[Security] Failed to delete trigger message:', error?.message || error));
    }

    await logTrigger(client, config, message, action, reason, cfg);
    await punish(member, action, reason, cfg);
  };

  client.on('messageCreate', message => {
    if (!message.guild) return;
    if (message.author?.bot && cfg.ignoreBots !== false) return;

    if (channelId && message.channelId === channelId) {
      void trap(message);
      return;
    }

    if (!patterns.length) return;

    for (const pattern of patterns) {
      try {
        if (new RegExp(String(pattern), 'i').test(message.content || '')) {
          void trap(message, cfg.patternReason || cfg.reason || 'Matched a security pattern');
          return;
        }
      } catch (error) {
        console.error(`[Security] Invalid pattern "${pattern}":`, error?.message || error);
      }
    }
  });

  console.log(`[Security] Active | trap=${channelId || 'none'} | patterns=${patterns.length} | action=${cfg.action || 'ban'}`);
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName('security')
      .setDescription('Security module tools')
      .addSubcommand(s => s.setName('status').setDescription('Show security configuration'))
      .addSubcommand(s => s.setName('test').setDescription('Check whether a member is punishable').addUserOption(o => o.setName('user').setDescription('Member').setRequired(true))),
    requiredPermission: PermissionFlagsBits.ManageGuild,
    execute: async (i, client) => {
      const c = client.config.security || {};
      if (i.options.getSubcommand() === 'status') {
        return i.reply({
          content: `Security: **${c.enabled === true ? 'enabled' : 'disabled'}**\nTrap: ${c.channelId ? `<#${c.channelId}>` : 'none'}\nPatterns: **${c.patterns?.length || 0}**\nAction: **${c.action || 'ban'}**`,
          ephemeral: true
        });
      }
      const u = i.options.getUser('user', true);
      const m = await i.guild.members.fetch(u.id).catch(() => null);
      return i.reply({ content: `Punishable: **${allowed(m, c) ? 'yes' : 'no'}**`, ephemeral: true });
    }
  }
];

module.exports = { initialize, commands };
