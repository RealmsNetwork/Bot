const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');

const command = (data, permission, execute) => ({ data, permission, execute });
const user = (o, required = true) => o.addUserOption(x => x.setName('user').setDescription('Target member').setRequired(required));
const reason = o => o.addStringOption(x => x.setName('reason').setDescription('Reason').setMaxLength(1000));

const commands = [];

const kick = new SlashCommandBuilder().setName('kick').setDescription('Kick a member');
user(kick); reason(kick);
commands.push(command(kick, PermissionFlagsBits.KickMembers, async i => { const u = i.options.getUser('user', true); const m = await i.guild.members.fetch(u.id); await m.kick(i.options.getString('reason') || 'Moderation command'); await i.reply(`👢 Kicked ${u.tag}`); }));

const ban = new SlashCommandBuilder().setName('ban').setDescription('Ban a member');
user(ban); reason(ban);
commands.push(command(ban, PermissionFlagsBits.BanMembers, async i => { const u = i.options.getUser('user', true); const m = await i.guild.members.fetch(u.id); await m.ban({ reason: i.options.getString('reason') || 'Moderation command', deleteMessageSeconds: 86400 }); await i.reply(`🔨 Banned ${u.tag}`); }));

const massban = new SlashCommandBuilder().setName('massban').setDescription('Ban multiple user IDs at once');
massban.addStringOption(o => o.setName('users').setDescription('User IDs separated by spaces, commas, or new lines').setRequired(true).setMaxLength(4000)); reason(massban);
commands.push(command(massban, PermissionFlagsBits.BanMembers, async i => {
  const ids = [...new Set(i.options.getString('users', true).split(/[\s,]+/).map(x => x.trim()).filter(x => /^\d{17,20}$/.test(x)))];
  const max = Number(i.client.config.moderation?.limits?.massBanMax || 200);
  if (!ids.length) return i.reply({ content: 'No valid Discord user IDs were supplied.', ephemeral: true });
  if (ids.length > max) return i.reply({ content: `Mass ban is limited to ${max} users per run.`, ephemeral: true });
  await i.deferReply();
  let ok = 0, failed = 0;
  const why = i.options.getString('reason') || 'Mass moderation command';
  for (let n = 0; n < ids.length; n += 3) {
    const batch = ids.slice(n, n + 3);
    await Promise.all(batch.map(async id => { try { await i.guild.members.ban(id, { reason: why, deleteMessageSeconds: 86400 }); ok++; } catch { failed++; } }));
  }
  await i.editReply(`🔨 Mass ban complete: **${ok}** banned, **${failed}** failed.`);
}));

const unban = new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID');
unban.addStringOption(o => o.setName('id').setDescription('Discord user ID').setRequired(true)); reason(unban);
commands.push(command(unban, PermissionFlagsBits.BanMembers, async i => { const id = i.options.getString('id', true); await i.guild.members.unban(id, i.options.getString('reason') || 'Moderation command'); await i.reply(`✅ Unbanned ${id}`); }));

const timeout = new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member');
user(timeout); timeout.addIntegerOption(o => o.setName('minutes').setDescription('Duration in minutes').setMinValue(1).setMaxValue(40320).setRequired(true)); reason(timeout);
commands.push(command(timeout, PermissionFlagsBits.ModerateMembers, async i => { const u = i.options.getUser('user', true); const m = await i.guild.members.fetch(u.id); const mins = i.options.getInteger('minutes', true); await m.timeout(mins * 60000, i.options.getString('reason') || 'Moderation command'); await i.reply(`⏳ Timed out ${u.tag} for ${mins}m`); }));

const untimeout = new SlashCommandBuilder().setName('untimeout').setDescription('Remove a timeout');
user(untimeout); reason(untimeout);
commands.push(command(untimeout, PermissionFlagsBits.ModerateMembers, async i => { const u = i.options.getUser('user', true); const m = await i.guild.members.fetch(u.id); await m.timeout(null, i.options.getString('reason') || 'Moderation command'); await i.reply(`✅ Removed timeout from ${u.tag}`); }));

const warn = new SlashCommandBuilder().setName('warn').setDescription('Warn a member');
user(warn); reason(warn);
commands.push(command(warn, PermissionFlagsBits.ModerateMembers, async i => { const u = i.options.getUser('user', true); const r = i.options.getString('reason') || 'No reason provided'; const n = await i.client.db.increment(i.guildId, `warns:${u.id}`, 1); await i.reply(`⚠️ Warned ${u.tag} (#${n}) • ${r}`); }));

const unwarn = new SlashCommandBuilder().setName('unwarn').setDescription('Remove one warning'); user(unwarn); commands.push(command(unwarn, PermissionFlagsBits.ModerateMembers, async i => { const u = i.options.getUser('user', true); const n = Math.max(0, Number(await i.client.db.increment(i.guildId, `warns:${u.id}`, -1))); await i.reply(`✅ ${u.tag} now has ${n} warning(s).`); }));
const warnings = new SlashCommandBuilder().setName('warnings').setDescription('View warning count'); user(warnings); commands.push(command(warnings, PermissionFlagsBits.ModerateMembers, async i => { const u = i.options.getUser('user', true); const n = await i.client.db.get(i.guildId, `warns:${u.id}`, 0); await i.reply(`⚠️ ${u.tag} has **${n}** warning(s).`); }));

const purge = new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages'); purge.addIntegerOption(o => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true));
commands.push(command(purge, PermissionFlagsBits.ManageMessages, async i => { const amount = i.options.getInteger('amount', true); const msgs = await i.channel.bulkDelete(amount, true); await i.reply({ content: `🧹 Deleted ${msgs.size} messages.`, ephemeral: true }); }));

const slow = new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode'); slow.addIntegerOption(o => o.setName('seconds').setDescription('0-21600').setMinValue(0).setMaxValue(21600).setRequired(true));
commands.push(command(slow, PermissionFlagsBits.ManageChannels, async i => { const s = i.options.getInteger('seconds', true); await i.channel.setRateLimitPerUser(s); await i.reply(`🐌 Slowmode set to ${s}s.`); }));

const lock = new SlashCommandBuilder().setName('lock').setDescription('Lock current channel'); commands.push(command(lock, PermissionFlagsBits.ManageChannels, async i => { await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false }); await i.reply('🔒 Channel locked.'); }));
const unlock = new SlashCommandBuilder().setName('unlock').setDescription('Unlock current channel'); commands.push(command(unlock, PermissionFlagsBits.ManageChannels, async i => { await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null }); await i.reply('🔓 Channel unlocked.'); }));

module.exports = { commands };
