const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { targetGuard } = require('../../lib/guards');

const data = new SlashCommandBuilder()
  .setName('role')
  .setDescription('Manage member roles')
  .addSubcommand(s => s.setName('add').setDescription('Add role')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)))
  .addSubcommand(s => s.setName('remove').setDescription('Remove role')
    .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
    .addRoleOption(o => o.setName('role').setDescription('Role').setRequired(true)));

const command = {
  data,
  permission: PermissionFlagsBits.ManageRoles,
  botPermissions: [PermissionFlagsBits.ManageRoles],
  async execute(i) {
    const u = i.options.getUser('user', true);
    const r = i.options.getRole('role', true);
    const m = await i.guild.members.fetch(u.id).catch(() => null);
    if (!m) return i.reply({ content: 'That user is not a member of this server.', ephemeral: true });
    if (r.id === i.guild.id) return i.reply({ content: 'The @everyone role cannot be managed.', ephemeral: true });
    if (r.managed) return i.reply({ content: 'Managed/integration roles cannot be assigned manually.', ephemeral: true });

    const me = i.guild.members.me;
    if (!me) return i.reply({ content: 'I could not resolve my server member.', ephemeral: true });
    if (r.position >= me.roles.highest.position) return i.reply({ content: 'That role is not below my highest role.', ephemeral: true });
    if (m.id === i.guild.ownerId || m.id === me.id) return i.reply({ content: 'That member cannot be modified.', ephemeral: true });

    const actor = i.member;
    if (actor?.id !== i.guild.ownerId && actor?.roles?.highest?.comparePositionTo?.(r) <= 0) {
      return i.reply({ content: 'You cannot manage a role at or above your highest role.', ephemeral: true });
    }
    if (actor?.id !== i.guild.ownerId && m.roles.highest.comparePositionTo(actor.roles.highest) > 0) {
      return i.reply({ content: 'You cannot modify a member with a higher role than yours.', ephemeral: true });
    }

    const action = i.options.getSubcommand();
    const hasRole = m.roles.cache.has(r.id);
    if (action === 'add' && hasRole) return i.reply({ content: 'That member already has this role.', ephemeral: true });
    if (action === 'remove' && !hasRole) return i.reply({ content: 'That member does not have this role.', ephemeral: true });

    const guard = targetGuard(i.client, m, { action: 'moderate' });
    if (guard) return i.reply({ content: guard, ephemeral: true });

    if (action === 'add') await m.roles.add(r, 'Role command');
    else await m.roles.remove(r, 'Role command');
    await i.reply(`✅ ${action === 'add' ? 'Added' : 'Removed'} ${r} ${action === 'add' ? 'to' : 'from'} ${u}.`);
  }
};
module.exports = { commands: [command] };
