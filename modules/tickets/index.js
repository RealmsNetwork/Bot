const { SlashCommandBuilder, ChannelType, PermissionFlagsBits } = require('discord.js');

function config(client) { return client.config.tickets || {}; }
function ticketName(c, member) { return String(c.naming || 'ticket-{user}').replaceAll('{user}', member.user?.username || member.id).replace(/[^a-zA-Z0-9_-]/g, '-').slice(0, 90); }
async function openTicket(i) {
  const c = config(i.client);
  if (c.enabled !== true) return i.reply({ content: 'Tickets are disabled.', ephemeral: true });
  if (!i.guild) return i.reply({ content: 'Tickets require a server.', ephemeral: true });
  if (!i.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return i.reply({ content: 'I need Manage Channels.', ephemeral: true });
  const existing = i.guild.channels.cache.find(ch => ch.isTextBased?.() && ch.name === ticketName(c, i.member));
  if (existing) return i.reply({ content: `You already have ${existing}.`, ephemeral: true });
  const open = [...i.guild.channels.cache.values()].filter(ch => ch.isTextBased?.() && String(ch.name).startsWith('ticket-') && ch.permissionOverwrites?.cache?.has(i.user.id)).length;
  const max = Math.max(1, Number(c.maxOpenPerUser || 1));
  if (open >= max) return i.reply({ content: `You already have the maximum of ${max} open ticket(s).`, ephemeral: true });

  const overwrites = [
    { id: i.guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: i.user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }
  ];
  for (const roleId of Array.isArray(c.supportRoleIds) ? c.supportRoleIds : []) overwrites.push({ id: String(roleId), allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
  const channel = await i.guild.channels.create({ name: ticketName(c, i.member), type: ChannelType.GuildText, parent: c.categoryId || undefined, permissionOverwrites: overwrites });
  const support = Array.isArray(c.supportRoleIds) && c.supportRoleIds.length && c.mentionSupport ? ` ${c.supportRoleIds.map(id => `<@&${id}>`).join(' ')}` : '';
  await channel.send({ content: `🎫 ${i.user}, describe your issue here.${support}`, allowedMentions: { parse: [], roles: c.mentionSupport ? c.supportRoleIds || [] : [] } });
  await i.reply({ content: `Created ${channel}`, ephemeral: true });
}

const data = new SlashCommandBuilder()
  .setName('ticket')
  .setDescription('Ticket system')
  .addSubcommand(s => s.setName('create').setDescription('Open a ticket'))
  .addSubcommand(s => s.setName('close').setDescription('Close this ticket'))
  .addSubcommand(s => s.setName('claim').setDescription('Claim this ticket'));

const commands = [{
  data,
  async execute(i) {
    const c = config(i.client);
    if (i.options.getSubcommand() === 'create') return openTicket(i);
    if (!i.guild || !i.channel?.name?.startsWith('ticket-')) return i.reply({ content: 'This is not a ticket channel.', ephemeral: true });
    const support = Array.isArray(c.supportRoleIds) ? c.supportRoleIds.map(String) : [];
    const isSupport = i.member?.roles?.cache?.some(role => support.includes(role.id)) || i.member?.permissions?.has(PermissionFlagsBits.ManageChannels);
    if (i.options.getSubcommand() === 'claim') {
      if (!c.claiming) return i.reply({ content: 'Ticket claiming is disabled.', ephemeral: true });
      if (!isSupport) return i.reply({ content: 'Only configured ticket support staff can claim tickets.', ephemeral: true });
      if (!i.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return i.reply({ content: 'I need Manage Channels.', ephemeral: true });
      await i.channel.permissionOverwrites.edit(i.user.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
      return i.reply(`🛡️ ${i.user} claimed this ticket.`);
    }
    if (!isSupport) return i.reply({ content: 'Only ticket support staff can close tickets.', ephemeral: true });
    if (!i.guild.members.me.permissions.has(PermissionFlagsBits.ManageChannels)) return i.reply({ content: 'I need Manage Channels.', ephemeral: true });
    await i.reply(c.closeConfirm ? { content: '🔒 Closing ticket...' } : { content: '🔒 Closing ticket...' });
    setTimeout(() => i.channel.delete().catch(() => {}), 1500);
  }
}];

function listeners(client, cfg) {
  if (!cfg.closeOnLeave) return;
  client.on('guildMemberRemove', async member => {
    const channel = member.guild.channels.cache.find(ch => ch.isTextBased?.() && ch.permissionOverwrites?.cache?.has(member.id) && ch.name.startsWith('ticket-'));
    if (channel) await channel.delete('Ticket owner left the server').catch(() => {});
  });
}

module.exports = { commands, initialize: listeners };
