const { PermissionFlagsBits } = require('discord.js');

function ids(value) { return Array.isArray(value) ? value.map(String) : []; }
function hasRole(member, list) { const roles = ids(list); return roles.length > 0 && roles.some(id => member.roles?.cache?.has(id)); }
function discordPermission(value) {
  if (!value) return null;
  if (typeof value === 'bigint') return value;
  return PermissionFlagsBits[String(value)] || PermissionFlagsBits[String(value).replace(/_/g, '')] || null;
}

function authorize(interaction, command, config) {
  if (!interaction.guild) return true;
  const p = config.permissions || {};
  const userId = String(interaction.user.id);
  const channelId = String(interaction.channelId || '');
  const member = interaction.member;
  if (p.ownerBypass !== false && interaction.guild.ownerId === userId) return true;
  if (ids(p.globalDenyUsers).includes(userId)) return false;
  if (ids(p.globalDenyChannels).includes(channelId)) return false;
  if (hasRole(member, p.globalDenyRoles)) return false;

  const key = command.permissionKey || command.data?.name;
  const rule = p.commands?.[key] || {};
  if (ids(rule.denyUsers).includes(userId) || ids(rule.denyChannels).includes(channelId) || hasRole(member, rule.denyRoles)) return false;
  if (rule.allowUsers?.length && !ids(rule.allowUsers).includes(userId)) return false;
  if (rule.allowChannels?.length && !ids(rule.allowChannels).includes(channelId)) return false;
  if (rule.allowRoles?.length && !hasRole(member, rule.allowRoles)) return false;

  const group = rule.group || command.permissionGroup;
  const groupRoles = group === 'owner' ? [] : group === 'manager' ? p.managerRoles : group === 'admin' ? p.adminRoles : group === 'moderator' ? p.moderatorRoles : [];
  if (group && group !== 'owner' && groupRoles?.length && !hasRole(member, groupRoles)) return false;
  const permission = discordPermission(rule.discordPermission) || command.requiredPermission || command.permission;
  if (permission && !member.permissions?.has(permission)) return false;
  return true;
}

module.exports = { authorize, discordPermission };
