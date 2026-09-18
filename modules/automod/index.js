const { EmbedBuilder, PermissionFlagsBits } = require('discord.js');
const { targetGuard, isBanned } = require('../../lib/guards);

function list(value) { return Array.isArray(value) ? value.map(String).filter(Boolean) : []; }
function matchesLink(content) { return /https?:\/\/\S+/i.test(content); }
function matchesInvite(content) { return /(discord\.gg|discord(?:app)?\.com\/invite)\/\S+/i.test(content); }
function compilePatterns(values) { return list(values).map(value => { try { return new RegExp(value, 'i'); } catch { return null; } }).filter(Boolean); }

async function initialize(client, config) {
  const c = config.automod || {};
  if (c.enabled !== true) return;
  const banned = list(c.bannedWords).map(x => x.toLowerCase());
  const patterns = compilePatterns(c.blockedPatterns);
  const allowlist = list(c.links?.allowlist).map(x => x.toLowerCase().replace(/^https?:\/\//, '').split('/')[0]);
  const ignoredRoles = new Set(list(c.ignoredRoles));
  const ignoredChannels = new Set(list(c.ignoredChannels));
  const spam = new Map();
  const duplicate = new Map();
  const joins = new Map();

  const logHit = async (message, reason, match) => {
    const channel = client.channels.cache.get(c.logChannelId);
    if (!channel?.isTextBased?.()) return;
    const embed = new EmbedBuilder().setTitle('AutoMod').setDescription(`${message.author} triggered a filter in ${message.channel}.`).addFields({ name: 'Reason', value: String(reason).slice(0, 1024) }).setColor(config.branding?.embedColor || 0xec4899).setTimestamp();
    if (match) embed.addFields({ name: 'Match', value: String(match).slice(0, 1024) });
    await channel.send({ embeds: [embed], allowedMentions: { parse: [] } }).catch(() => {});
  };

  const enforce = async (message, reason, match) => {
    if (c.deleteMessage !== false) await message.delete().catch(() => {});
    const member = message.member;
    if (member && targetGuard(client, member, { action: Number(c.timeoutMinutes || 0) > 0 ? 'timeout' : 'moderate' })) return logHit(message, 'Skipped unsafe target', reason);
    if (c.warn === true && member) {
      const key = `warnings:${member.id}`;
      const current = await client.db.get(message.guildId, key, []);
      const maxWarnings = Math.max(1, Number(c.maxWarnings || 10));
      if (current.length < maxWarnings) current.push({ id: Date.now().toString(36), reason: `AutoMod: ${reason}`, moderator: client.user?.id, at: Date.now() });
      await client.db.set(message.guildId, key, current).catch(() => {});
    }
    if (Number(c.timeoutMinutes || 0) > 0 && member?.moderatable) await member.timeout(Math.min(28 * 24 * 60, Number(c.timeoutMinutes)) * 60000, `AutoMod: ${reason}`).catch(() => {});
    await logHit(message, reason, match);
  };

  client.on('messageCreate', async message => {
    if (!message.guild || message.author.bot) return;
    if (ignoredChannels.has(message.channelId)) return;
    if (message.member?.roles.cache.some(role => ignoredRoles.has(role.id))) return;

    const content = String(message.content || '');
    const lower = content.toLowerCase();
    const word = banned.find(value => lower.includes(value));
    if (word) return enforce(message, 'Banned word', word);
    const pattern = patterns.find(value => value.test(content));
    if (pattern) return enforce(message, 'Blocked pattern', pattern.source);

    const mentionLimit = Number(c.mentionSpamLimit || 0);
    if (mentionLimit > 0 && message.mentions.users.size >= mentionLimit) return enforce(message, 'Mention spam', `${message.mentions.users.size} mentions`);

    if (c.links?.enabled === true && matchesLink(content)) {
      const urls = content.match(/https?:\/\/[^\s]+/gi) || [];
      const unknown = urls.find(url => {
        try { return !allowlist.includes(new URL(url).hostname.toLowerCase()); } catch { return true; }
      });
      if (unknown) return enforce(message, 'Blocked link', unknown);
    }
    if (c.links?.blockInvites !== false && matchesInvite(content)) return enforce(message, 'Discord invite', 'invite');

    const now = Date.now();
    if (c.messageSpam?.enabled !== false) {
      const limit = Math.max(1, Number(c.messageSpam?.messages || 6));
      const windowMs = Math.max(1000, Number(c.messageSpam?.windowSeconds || 5) * 1000);
      const key = `${message.guildId}:${message.author.id}`;
      const times = (spam.get(key) || []).filter(t => now - t < windowMs);
      times.push(now);
      spam.set(key, times);
      if (times.length >= limit) {
        spam.delete(key);
        return enforce(message, 'Message spam', `${limit} messages/${windowMs / 1000}s`);
      }
    }

    if (c.duplicateMessages?.enabled !== false && content.trim()) {
      const threshold = Math.max(2, Number(c.duplicateMessages?.threshold || 3));
      const key = `${message.guildId}:${message.author.id}`;
      const row = duplicate.get(key) || { content: '', count: 0, at: 0 };
      if (row.content === lower && now - row.at < 30000) row.count += 1; else { row.content = lower; row.count = 1; }
      row.at = now;
      duplicate.set(key, row);
      if (row.count >= threshold) {
        duplicate.delete(key);
        return enforce(message, 'Duplicate messages', `${threshold} repeats`);
      }
    }
  });

  client.on('guildMemberAdd', async member => {
    if (!c.raidProtection || member.user.bot) return;
    const now = Date.now();
    const key = member.guild.id;
    const windowMs = 10000;
    const max = 8;
    const times = (joins.get(key) || []).filter(t => now - t < windowMs);
    times.push(now);
    joins.set(key, times);
    if (times.length >= max) {
      const me = member.guild.members.me;
      if (me?.permissions.has(PermissionFlagsBits.BanMembers) && !await isBanned(member.guild, member.id) && !targetGuard(client, member, { action: 'ban' })) await member.ban({ reason: 'AutoMod raid protection' }).catch(() => {});
      const channel = client.channels.cache.get(c.logChannelId);
      if (channel?.isTextBased?.()) await channel.send({ content: `Raid protection detected rapid joins in **${member.guild.name}**.`, allowedMentions: { parse: [] } }).catch(() => {});
    }
  });
}

module.exports = { initialize };
