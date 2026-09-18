const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { targetGuard, isBanned, validSnowflake } = require('../../lib/guards');

const commands = [];
const command = (data, permission, execute, group = 'moderator') => ({ data, permission, requiredPermission: permission, permissionGroup: group, execute });
const addUser = builder => builder.addUserOption(o => o.setName('user').setDescription('Target member').setRequired(true));
const addReason = builder => builder.addStringOption(o => o.setName('reason').setDescription('Reason').setMaxLength(1000));
const fetchMember = (guild, id) => guild.members.fetch(id).catch(() => null);

function canAct(client, member, action = 'moderate') {
  return !targetGuard(client, member, { action });
}
function textReason(i, fallback) { return i.options.getString('reason') || fallback; }
function idsFrom(value) { return [...new Set(String(value).split(/[\s,]+/).filter(x => /^\d{17,20}$/.test(x)))]; }

function userModeration(name, description, permission, handler) {
  const b = new SlashCommandBuilder().setName(name).setDescription(description);
  addUser(b);
  addReason(b);
  commands.push(command(b, permission, handler));
}

userModeration('kick', 'Kick a member', PermissionFlagsBits.KickMembers, async i => {
  const u = i.options.getUser('user', true);
  const m = await fetchMember(i.guild, u.id);
  if (!canAct(i.client, m, 'kick')) return i.reply({ content: 'I cannot act on that member.', ephemeral: true });
  await m.kick(textReason(i, 'Moderation command'));
  await i.reply(`👢 Kicked ${u.tag}`);
});

userModeration('ban', 'Ban a member', PermissionFlagsBits.BanMembers, async i => {
  const u = i.options.getUser('user', true);
  const m = await fetchMember(i.guild, u.id);
  if (m && !canAct(i.client, m, 'ban')) return i.reply({ content: 'I cannot act on that member.', ephemeral: true });
  if (await isBanned(i.guild, u.id)) return i.reply({ content: 'That user is already banned.', ephemeral: true });
  if (i.client.config.moderation?.behavior?.requireReasonForBan && !i.options.getString('reason')) return i.reply({ content: 'A reason is required for bans.', ephemeral: true });
  await i.guild.members.ban(u.id, { reason: textReason(i, 'Moderation command'), deleteMessageSeconds: Number(i.client.config.moderation?.deleteMessageSeconds || 86400) });
  await i.reply(`🔨 Banned ${u.tag}`);
});

userModeration('softban', 'Ban and immediately unban a member', PermissionFlagsBits.BanMembers, async i => {
  const u = i.options.getUser('user', true);
  const m = await fetchMember(i.guild, u.id);
  if (m && !canAct(i.client, m, 'softban')) return i.reply({ content: 'I cannot act on that member.', ephemeral: true });
  if (await isBanned(i.guild, u.id)) return i.reply({ content: 'That user is already banned.', ephemeral: true });
  const reason = textReason(i, 'Softban');
  await i.guild.members.ban(u.id, { reason, deleteMessageSeconds: 86400 });
  await i.guild.members.unban(u.id, reason).catch(() => {});
  await i.reply(`🧹 Softbanned ${u.tag}`);
});

const massban = new SlashCommandBuilder().setName('massban').setDescription('Ban many Discord user IDs')
massban.addStringOption(o => o.setName('users').setDescription('IDs separated by spaces, commas, or new lines').setRequired(true).setMaxLength(4000));
addReason(massban);
commands.push(command(massban, PermissionFlagsBits.BanMembers, async i => {
  const ids = idsFrom(i.options.getString('users', true));
  const max = Number(i.client.config.moderation?.limits?.massBanMax || 200);
  if (!ids.length) return i.reply({ content: 'No valid user IDs supplied.', ephemeral: true });
  if (ids.length > max) return i.reply({ content: `Mass ban limit: ${max}.`, ephemeral: true });
  await i.deferReply();
  const why = textReason(i, 'Mass moderation');
  let ok = 0, fail = 0;
  for (let n = 0; n < ids.length; n += 5) {
    await Promise.all(ids.slice(n, n + 5).map(async id => {
      try {
        const m = await fetchMember(i.guild, id);
        if (m && !canAct(i.client, m, 'ban')) { fail++; return; }
        if (await isBanned(i.guild, id)) { fail++; return; }
        await i.guild.members.ban(id, { reason: why, deleteMessageSeconds: Number(i.client.config.moderation?.deleteMessageSeconds || 86400) });
        ok++;
      } catch { fail++; }
    }));
  }
  await i.editReply(`🔨 Mass ban complete: **${ok}** banned, **${fail}** failed.`);
}));

const masskick = new SlashCommandBuilder().setName('masskick').setDescription('Kick many members by user ID')
masskick.addStringOption(o => o.setName('users').setDescription('IDs separated by spaces, commas, or new lines').setRequired(true).setMaxLength(4000));
addReason(masskick);
commands.push(command(masskick, PermissionFlagsBits.KickMembers, async i => {
  const ids = idsFrom(i.options.getString('users', true));
  const max = Number(i.client.config.moderation?.limits?.massKickMax || 100);
  if (!ids.length) return i.reply({ content: 'No valid user IDs supplied.', ephemeral: true });
  if (ids.length > max) return i.reply({ content: `Mass kick limit: ${max}.`, ephemeral: true });
  await i.deferReply();
  const why = textReason(i, 'Mass moderation');
  let ok = 0, fail = 0;
  for (const id of ids) {
    try {
      const m = await fetchMember(i.guild, id);
      if (!canAct(i.client, m, 'kick')) { fail++; continue; }
      await m.kick(why);
      ok++;
    } catch { fail++; }
  }
  await i.editReply(`👢 Mass kick complete: **${ok}** kicked, **${fail}** failed.`);
}));

const unban = new SlashCommandBuilder().setName('unban').setDescription('Unban a user by ID')
unban.addStringOption(o => o.setName('id').setDescription('Discord user ID').setRequired(true));
addReason(unban);
commands.push(command(unban, PermissionFlagsBits.BanMembers, async i => {
  const id = i.options.getString('id', true);
  if (!validSnowflake(id)) return i.reply({ content: 'That is not a valid Discord user ID.', ephemeral: true });
  if (!(await isBanned(i.guild, id))) return i.reply({ content: 'That user is not currently banned.', ephemeral: true });
  await i.guild.members.unban(id, textReason(i, 'Moderation command'));
  const tempbans = await i.client.db.get(i.guildId, 'tempbans', []);
  await i.client.db.set(i.guildId, 'tempbans', Array.isArray(tempbans) ? tempbans.filter(x => x?.user !== id) : []);
  await i.reply(`✅ Unbanned ${id}`);
}));

const tempban = new SlashCommandBuilder().setName('tempban').setDescription('Temporarily ban a member');
addUser(tempban);
tempban.addIntegerOption(o => o.setName('minutes').setDescription('1-40320').setMinValue(1).setMaxValue(40320).setRequired(true));
addReason(tempban);
commands.push(command(tempban, PermissionFlagsBits.BanMembers, async i => {
  const u = i.options.getUser('user', true);
  const m = await fetchMember(i.guild, u.id);
  if (m && !canAct(i.client, m, 'ban')) return i.reply({ content: 'I cannot act on that member.', ephemeral: true });
  if (await isBanned(i.guild, u.id)) return i.reply({ content: 'That user is already banned.', ephemeral: true });
  const minutes = i.options.getInteger('minutes', true);
  const reason = textReason(i, 'Temporary ban');
  await i.guild.members.ban(u.id, { reason, deleteMessageSeconds: Number(i.client.config.moderation?.behavior?.defaultBanDeleteSeconds || 0) });
  const expiresAt = Date.now() + minutes * 60000;
  const list = await i.client.db.get(i.guildId, 'tempbans', []);
  list.push({ user: u.id, moderator: i.user.id, reason, expiresAt });
  await i.client.db.set(i.guildId, 'tempbans', list);
  await i.reply(`⏱️ Temporarily banned ${u.tag} for **${minutes} minute(s)**.`);
}));

const baninfo = new SlashCommandBuilder().setName('baninfo').setDescription('Check whether a user is banned')
baninfo.addStringOption(o => o.setName('id').setDescription('Discord user ID').setRequired(true));
commands.push(command(baninfo, PermissionFlagsBits.BanMembers, async i => {
  const id = i.options.getString('id', true);
  const b = await i.guild.bans.fetch(id).catch(() => null);
  await i.reply({ content: b ? `🔨 **Banned**: ${b.user.tag}\nReason: ${b.reason || 'No reason recorded'}` : '✅ User is not banned.', ephemeral: true });
}));

const timeout = new SlashCommandBuilder().setName('timeout').setDescription('Timeout a member');
addUser(timeout);
timeout.addIntegerOption(o => o.setName('minutes').setDescription('1-40320').setMinValue(1).setMaxValue(40320).setRequired(true));
addReason(timeout);
commands.push(command(timeout, PermissionFlagsBits.ModerateMembers, async i => {
  const u = i.options.getUser('user', true), m = await fetchMember(i.guild, u.id);
  if (!canAct(i.client, m, 'timeout')) return i.reply({ content: 'I cannot act on that member.', ephemeral: true });
  await m.timeout(i.options.getInteger('minutes', true) * 60000, textReason(i, 'Moderation command'));
  await i.reply(`⏳ Timed out ${u.tag}`);
}));

userModeration('untimeout', 'Remove a timeout', PermissionFlagsBits.ModerateMembers, async i => {
  const u = i.options.getUser('user', true), m = await fetchMember(i.guild, u.id);
  if (!canAct(i.client, m, 'timeout')) return i.reply({ content: 'I cannot act on that member.', ephemeral: true });
  await m.timeout(null, textReason(i, 'Moderation command'));
  await i.reply(`✅ Removed timeout from ${u.tag}`);
});

userModeration('warn', 'Warn a member', PermissionFlagsBits.ModerateMembers, async i => {
  const u = i.options.getUser('user', true), r = textReason(i, 'No reason provided');
  const key = `warnings:${u.id}`;
  const list = await i.client.db.get(i.guildId, key, []);
  const maxWarnings = Math.max(1, Number(i.client.config.moderation?.warnings?.maxWarnings || 10));
  if (list.length >= maxWarnings) return i.reply({ content: `This member has reached the warning limit of ${maxWarnings}.`, ephemeral: true });
  list.push({ id: Date.now().toString(36), reason: r, moderator: i.user.id, at: Date.now() });
  await i.client.db.set(i.guildId, key, list);
  await i.reply(`⚠️ Warned ${u.tag}. They now have **${list.length}** warning(s).`);
});

const warnings = new SlashCommandBuilder().setName('warnings').setDescription('View a member\'s warnings');
addUser(warnings);
commands.push(command(warnings, PermissionFlagsBits.ModerateMembers, async i => {
  const u = i.options.getUser('user', true), list = await i.client.db.get(i.guildId, `warnings:${u.id}`, []);
  await i.reply({ content: list.length ? list.slice(-20).map((x, n) => `**${n + 1}.** ${x.reason} • <@${x.moderator}>`).join('\n') : `${u.tag} has no warnings.`, ephemeral: true });
}));

const clearwarns = new SlashCommandBuilder().setName('clearwarns').setDescription('Clear all warnings');
addUser(clearwarns);
commands.push(command(clearwarns, PermissionFlagsBits.ModerateMembers, async i => {
  const u = i.options.getUser('user', true);
  await i.client.db.set(i.guildId, `warnings:${u.id}`, []);
  await i.reply(`✅ Cleared warnings for ${u.tag}.`);
}));

const unwarn = new SlashCommandBuilder().setName('unwarn').setDescription('Remove one warning');
addUser(unwarn);
commands.push(command(unwarn, PermissionFlagsBits.ModerateMembers, async i => {
  const u = i.options.getUser('user', true), list = await i.client.db.get(i.guildId, `warnings:${u.id}`, []);
  if (!list.length) return i.reply({ content: 'No warnings to remove.', ephemeral: true });
  list.pop();
  await i.client.db.set(i.guildId, `warnings:${u.id}`, list);
  await i.reply(`✅ ${u.tag} now has ${list.length} warning(s).`);
}));

const purge = new SlashCommandBuilder().setName('purge').setDescription('Delete recent messages')
purge.addIntegerOption(o => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true));
commands.push(command(purge, PermissionFlagsBits.ManageMessages, async i => {
  const requested = i.options.getInteger('amount', true);
  const maxMessages = Math.max(1, Number(i.client.config.moderation?.purge?.maxMessages || 100));
  if (requested > maxMessages) return i.reply({ content: `Purge limit: ${maxMessages}.`, ephemeral: true });
  if (!i.channel?.bulkDelete) return i.reply({ content: 'This channel does not support bulk deletion.', ephemeral: true });
  const msgs = await i.channel.bulkDelete(requested, true);
  await i.reply({ content: `🧹 Deleted ${msgs.size} messages.`, ephemeral: true });
}));

const purgebots = new SlashCommandBuilder().setName('purgebots').setDescription('Delete recent bot messages')
purgebots.addIntegerOption(o => o.setName('amount').setDescription('1-100').setMinValue(1).setMaxValue(100).setRequired(true));
commands.push(command(purgebots, PermissionFlagsBits.ManageMessages, async i => {
  const n = i.options.getInteger('amount', true), maxMessages = Math.max(1, Number(i.client.config.moderation?.purge?.maxMessages || 100));
  if (n > maxMessages) return i.reply({ content: `Purge limit: ${maxMessages}.`, ephemeral: true });
  const msgs = await i.channel.messages.fetch({ limit: Math.min(100, maxMessages) });
  const bots = msgs.filter(m => m.author?.bot).first(n);
  for (const m of bots) await m.delete().catch(() => {});
  await i.reply({ content: `🤖 Deleted ${bots.length} bot messages.`, ephemeral: true });
}));

const slow = new SlashCommandBuilder().setName('slowmode').setDescription('Set channel slowmode')
slow.addIntegerOption(o => o.setName('seconds').setDescription('0-21600').setMinValue(0).setMaxValue(21600).setRequired(true));
commands.push(command(slow, PermissionFlagsBits.ManageChannels, async i => {
  const s = i.options.getInteger('seconds', true);
  await i.channel.setRateLimitPerUser(s);
  await i.reply(`🐌 Slowmode set to ${s}s.`);
}));

const lock = new SlashCommandBuilder().setName('lock').setDescription('Lock current channel');
addReason(lock);
commands.push(command(lock, PermissionFlagsBits.ManageChannels, async i => {
  await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: false });
  await i.reply(`🔒 Channel locked${i.options.getString('reason') ? ` • ${i.options.getString('reason')}` : ''}.`);
}));

const unlock = new SlashCommandBuilder().setName('unlock').setDescription('Unlock current channel');
commands.push(command(unlock, PermissionFlagsBits.ManageChannels, async i => {
  await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { SendMessages: null });
  await i.reply('🔓 Channel unlocked.');
}));

const hide = new SlashCommandBuilder().setName('hide').setDescription('Hide current channel');
commands.push(command(hide, PermissionFlagsBits.ManageChannels, async i => {
  await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: false });
  await i.reply('🙈 Channel hidden.');
}));

const show = new SlashCommandBuilder().setName('show').setDescription('Show current channel');
commands.push(command(show, PermissionFlagsBits.ManageChannels, async i => {
  await i.channel.permissionOverwrites.edit(i.guild.roles.everyone, { ViewChannel: null });
  await i.reply('👀 Channel visible.');
}));

const nick = new SlashCommandBuilder().setName('nick').setDescription('Change a member nickname');
addUser(nick);
nick.addStringOption(o => o.setName('nickname').setDescription('New nickname, blank to clear').setMaxLength(32));
addReason(nick);
commands.push(command(nick, PermissionFlagsBits.ManageNicknames, async i => {
  const u = i.options.getUser('user', true), m = await fetchMember(i.guild, u.id);
  if (!canAct(i.client, m)) return i.reply({ content: 'I cannot edit that member.', ephemeral: true });
  await m.setNickname(i.options.getString('nickname') || null, textReason(i, 'Moderation command'));
  await i.reply(`🏷️ Updated nickname for ${u.tag}.`);
}));

const caseCmd = new SlashCommandBuilder().setName('case').setDescription('Record a moderation case')
  .addStringOption(o => o.setName('type').setDescription('Case type').setRequired(true))
  .addUserOption(o => o.setName('user').setDescription('User').setRequired(true))
  .addStringOption(o => o.setName('reason').setDescription('Reason'));
commands.push(command(caseCmd, PermissionFlagsBits.ModerateMembers, async i => {
  const type = i.options.getString('type', true), u = i.options.getUser('user', true), r = textReason(i, 'No reason provided');
  const id = await i.client.db.increment(i.guildId, 'case:next', 1);
  await i.client.db.set(i.guildId, `case:${id}`, { id, type, user: u.id, moderator: i.user.id, reason: r, at: Date.now() });
  await i.reply(`📁 Case #${id} recorded for ${u.tag}.`);
}));

const history = new SlashCommandBuilder().setName('history').setDescription('Show moderation cases for a user');
addUser(history);
commands.push(command(history, PermissionFlagsBits.ModerateMembers, async i => {
  const u = i.options.getUser('user', true), max = Number(i.client.config.moderation?.limits?.historyMax || 25), next = Number(await i.client.db.get(i.guildId, 'case:next', 0)), rows = [];
  for (let id = Math.max(1, next - max + 1); id <= next; id++) {
    const c = await i.client.db.get(i.guildId, `case:${id}`, null);
    if (c?.user === u.id) rows.push(`#${c.id} ${c.type}: ${c.reason}`);
  }
  await i.reply({ content: rows.length ? rows.join('\n') : `No cases found for ${u.tag}.`, ephemeral: true });
}));

async function initialize(client) {
  const sweep = async () => {
    for (const guild of client.guilds.cache.values()) {
      const list = await client.db.get(guild.id, 'tempbans', []);
      if (!Array.isArray(list) || !list.length) continue;
      const keep = [];
      for (const entry of list) {
        if (!entry?.user || Number(entry.expiresAt) > Date.now()) { if (entry?.user) keep.push(entry); continue; }
        if (await isBanned(guild, entry.user)) await guild.members.unban(entry.user, 'Temporary ban expired').catch(() => {});
      }
      if (keep.length !== list.length) await client.db.set(guild.id, 'tempbans', keep);
    }
  };
  await sweep();
  const timer = setInterval(() => void sweep().catch(error => console.error('[Moderation] Tempban sweep failed:', error?.message || error)), 30000);
  timer.unref?.();
  client.moderationTempbanTimer = timer;
}
async function destroy(client) {
  if (client.moderationTempbanTimer) clearInterval(client.moderationTempbanTimer);
}
module.exports = { initialize, destroy, commands };
