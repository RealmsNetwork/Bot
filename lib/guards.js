const { PermissionFlagsBits } = require('discord.js');

const COMMON_BOT_PERMISSIONS = new Map([
  [PermissionFlagsBits.KickMembers, 'Kick Members'],
  [PermissionFlagsBits.BanMembers, 'Ban Members'],
  [PermissionFlagsBits.ModerateMembers, 'Moderate Members'],
  [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
  [PermissionFlagsBits.ManageNicknames, 'Manage Nicknames'],
  [PermissionFlagsBits.ManageGuild, 'Manage Server']
]);

function botMember(interaction) {
  return interaction.guild?.members?.me || null;
}

function permissionName(permission) {
  return COMMON_BOT_PERMISSIONS.get(permission) || 'required permission';
}

function preflight(interaction, command, config) {
  if (!interaction?.guild) {
    if (command?.requireGuild !== false) return 'This command can only be used in a server.';
    return null;
  }

  const me = botMember(interaction);
  if (!me) return 'I could not resolve my server member. Try again in a moment.';

  if (me.user?.bot !== true) return 'The bot member could not be verified.';
  if (interaction.channel && !interaction.channel.isDMBased?.()) {
    const perms = interaction.channel.permissionsFor?.(me);
    if (perms && !perms.has(PermissionFlagsBits.ViewChannel)) return 'I cannot view this channel.';
  }

  const required = command?.requiredPermission || command?.permission;
  if (required && !me.permissions.has(required)) {
    return `I am missing the **${permissionName(required)}** permission required for this command.`;
  }

  if (command?.botPermissions) {
    const missing = command.botPermissions.filter(p => !me.permissions.has(p));
    if (missing.length) return `I am missing required bot permissions: **${missing.map(permissionName).join(', ')}**.`;
  }

  if (config?.security?.strictChecks !== false && interaction.guild.verificationLevel != null) {
    if (command?.requiresMemberFetch && interaction.guild.members?.fetch) {
      // Commands that explicitly request a member fetch are checked by the command itself.
    }
  }

  return null;
}

function targetGuard(client, member, { action = 'moderate', allowMissing = false } = {}) {
  if (!member) return allowMissing ? null : 'That user is not a member of this server.';
  const guild = member.guild;
  const me = guild.members.me;
  if (!me) return 'I could not resolve my server member.';
  if (member.id === client.user?.id) return 'I cannot target myself.';
  if (member.id === guild.ownerId) return 'The server owner cannot be targeted.';
  if (member.user?.bot && member.id === client.user?.id) return 'I cannot target myself.';
  if (guild.ownerId === member.id) return 'The server owner cannot be targeted.';
  if (me.roles.highest.comparePositionTo(member.roles.highest) <= 0) {
    return 'That member is at or above my highest role, so I cannot act on them.';
  }
  if (action === 'kick' && !member.kickable) return 'Discord does not allow me to kick that member.';
  if ((action === 'ban' || action === 'softban') && !member.bannable) return 'Discord does not allow me to ban that member.';
  if (action === 'timeout' && !member.moderatable) return 'Discord does not allow me to timeout that member.';
  return null;
}

async function isBanned(guild, userId) {
  return guild.bans.fetch(userId).then(() => true).catch(() => false);
}

function validSnowflake(value) {
  return /^\d{17,20}$/.test(String(value || ''));
}

module.exports = { preflight, targetGuard, isBanned, validSnowflake };
