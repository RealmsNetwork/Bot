const { PermissionFlagsBits, ChannelType } = require('discord.js');

const PERMS = new Set(Object.keys(PermissionFlagsBits));
const WRITE_GUARD = cfg => cfg.readOnly === false;
const permissionName = value => PERMS.has(String(value)) ? String(value) : null;
const permissionObject = (allow = [], deny = []) => {
  const out = {};
  for (const key of Array.isArray(allow) ? allow : []) {
    const name = permissionName(key);
    if (name) out[name] = true;
  }
  for (const key of Array.isArray(deny) ? deny : []) {
    const name = permissionName(key);
    if (name) out[name] = false;
  }
  return out;
};

function send(res, status, data) {
  if (!res.headersSent) {
    res.writeHead(status, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff'
    });
  }
  res.end(JSON.stringify(data));
}

function fail(res, status, error, extra = {}) {
  send(res, status, { ok: false, error, ...extra });
}

async function guildOf(client, id) {
  return client.guilds.cache.get(id) || client.guilds.fetch(id).catch(() => null);
}

async function meOf(guild) {
  return guild.members.me || guild.members.fetchMe().catch(() => null);
}

function has(me, permission) {
  return !!me?.permissions?.has(permission);
}

function requireWrite(cfg, res) {
  if (WRITE_GUARD(cfg)) return true;
  fail(res, 403, 'Discord management writes are disabled in read-only mode');
  return false;
}

function requirePermission(me, permission, res) {
  if (has(me, permission)) return true;
  fail(res, 403, `Bot is missing ${String(permission)}`);
  return false;
}

function memberPayload(member) {
  const highest = member.roles?.highest;
  return {
    id: member.id,
    username: member.user?.username || member.displayName,
    globalName: member.user?.globalName || null,
    displayName: member.displayName,
    avatar: member.displayAvatarURL?.({ size: 96 }) || null,
    bot: !!member.user?.bot,
    joinedAt: member.joinedAt?.toISOString?.() || null,
    communicationDisabledUntil: member.communicationDisabledUntil?.toISOString?.() || null,
    roles: member.roles?.cache?.filter(r => r.id !== member.guild.id).sort((a, b) => b.position - a.position).map(r => ({ id: r.id, name: r.name, position: r.position, color: r.hexColor })) || [],
    highestRole: highest ? { id: highest.id, name: highest.name, position: highest.position } : null,
    manageable: !!member.manageable,
    kickable: !!member.kickable,
    bannable: !!member.bannable,
    moderatable: !!member.moderatable,
    permissions: member.permissions?.toArray?.() || []
  };
}

function channelPayload(channel) {
  return {
    id: channel.id,
    name: channel.name,
    type: channel.type,
    typeName: Object.entries(ChannelType).find(([, value]) => value === channel.type)?.[0] || String(channel.type),
    parentId: channel.parentId || null,
    position: channel.rawPosition ?? channel.position ?? 0,
    topic: 'topic' in channel ? channel.topic : null,
    nsfw: 'nsfw' in channel ? !!channel.nsfw : false,
    rateLimitPerUser: 'rateLimitPerUser' in channel ? channel.rateLimitPerUser : 0,
    bitrate: 'bitrate' in channel ? channel.bitrate : null,
    userLimit: 'userLimit' in channel ? channel.userLimit : null,
    manageable: !!channel.manageable,
    permissions: channel.permissionsFor?.(channel.guild.members.me)?.toArray?.() || []
  };
}

function rolePayload(role) {
  return {
    id: role.id,
    name: role.name,
    color: role.hexColor,
    rawColor: role.color,
    position: role.position,
    hoist: !!role.hoist,
    mentionable: !!role.mentionable,
    managed: !!role.managed,
    permissions: role.permissions.toArray()
  };
}

async function memberFor(guild, id) {
  return guild.members.cache.get(id) || guild.members.fetch(id).catch(() => null);
}

function targetIsBelowBot(me, target) {
  if (!me || !target) return false;
  if (target.id === guildOwnerId(target.guild)) return false;
  return me.roles.highest.comparePositionTo(target.roles.highest) > 0;
}

function guildOwnerId(guild) {
  return guild.ownerId;
}

async function handle(req, res, url, client, cfg, body, log) {
  const match = url.pathname.match(/^\/api\/guild\/([^/]+)(?:\/(.*))?$/);
  if (!match) return false;
  const guildId = match[1];
  const sub = match[2] || '';
  const guild = await guildOf(client, guildId);
  if (!guild) return fail(res, 404, 'Guild not found'), true;

  if (req.method === 'GET' && sub === '') {
    const me = await meOf(guild);
    const members = [...guild.members.cache.values()].sort((a, b) => (a.displayName || '').localeCompare(b.displayName || '')).slice(0, 500).map(memberPayload);
    const channels = [...guild.channels.cache.values()].sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0)).map(channelPayload);
    const roles = [...guild.roles.cache.values()].sort((a, b) => b.position - a.position).map(rolePayload);
    return send(res, 200, {
      ...({ id: guild.id, name: guild.name, icon: guild.iconURL({ size: 128 }), ownerId: guild.ownerId, memberCount: guild.memberCount || guild.members.cache.size, createdAt: guild.createdAt?.toISOString?.() || null }),
      bot: me ? { id: me.id, tag: me.user?.tag || me.user?.username, permissions: me.permissions.toArray(), highestRole: rolePayload(me.roles.highest) } : null,
      members,
      channels,
      roles
    }), true;
  }

  if (req.method === 'GET' && sub === 'members') {
    const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
    const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)));
    let rows = [...guild.members.cache.values()];
    if (q) rows = rows.filter(m => `${m.displayName} ${m.user?.username} ${m.id}`.toLowerCase().includes(q));
    rows.sort((a, b) => (a.displayName || '').localeCompare(b.displayName || ''));
    return send(res, 200, { items: rows.slice(0, limit).map(memberPayload) }), true;
  }

  if (req.method === 'GET' && sub === 'bans') {
    const bans = await guild.bans.fetch().catch(() => null);
    if (!bans) return fail(res, 403, 'Unable to fetch bans'), true;
    return send(res, 200, { items: [...bans.values()].map(b => ({ id: b.user.id, username: b.user.username, globalName: b.user.globalName, reason: b.reason || null })) }), true;
  }

  if (req.method === 'GET' && sub === 'analytics') {
    const members = [...guild.members.cache.values()];
    const channels = [...guild.channels.cache.values()];
    const roles = [...guild.roles.cache.values()];
    const counts = {};
    for (const channel of channels) counts[channel.type] = (counts[channel.type] || 0) + 1;
    const humans = members.filter(m => !m.user?.bot).length;
    const bots = members.length - humans;
    return send(res, 200, {
      guild: { id: guild.id, name: guild.name, memberCount: guild.memberCount || members.length, approximateCachedMembers: members.length, humans, bots, premiumTier: guild.premiumTier, premiumSubscriptionCount: guild.premiumSubscriptionCount || 0, createdAt: guild.createdAt?.toISOString?.() || null },
      channels: { total: channels.length, byType: counts },
      roles: { total: roles.length, managed: roles.filter(r => r.managed).length, assignable: roles.filter(r => !r.managed && r.id !== guild.id).length },
      framework: { latency: client.ws?.ping ?? null, shardId: guild.shardId, ready: client.isReady?.() ?? true }
    }), true;
  }

  if (req.method === 'GET' && sub === 'webhooks') {
    const me = await meOf(guild);
    if (!requirePermission(me, PermissionFlagsBits.ManageWebhooks, res)) return true;
    const hooks = await guild.fetchWebhooks().catch(() => null);
    if (!hooks) return fail(res, 500, 'Unable to fetch webhooks'), true;
    return send(res, 200, { items: [...hooks.values()].map(w => ({ id: w.id, name: w.name, type: w.type, channelId: w.channelId, ownerId: w.owner?.id || null, url: w.url || null, hasToken: !!w.token })) }), true;
  }

  const memberMatch = sub.match(/^member\/([^/]+)(?:\/(.*))?$/);
  if (memberMatch) {
    const memberId = memberMatch[1];
    const action = memberMatch[2] || '';
    const member = await memberFor(guild, memberId);
    if (!member) return fail(res, 404, 'Member not found'), true;
    const me = await meOf(guild);

    if (req.method === 'GET' && action === '') return send(res, 200, memberPayload(member)), true;
    if (req.method !== 'POST' && req.method !== 'PATCH') return fail(res, 405, 'Method not allowed'), true;
    if (!requireWrite(cfg, res)) return true;

    if (action === 'kick') {
      if (!requirePermission(me, PermissionFlagsBits.KickMembers, res) || !member.kickable) return fail(res, 403, member.kickable ? 'Bot is missing Kick Members' : 'Target is above the bot or is otherwise not kickable'), true;
      const data = await body();
      await member.kick(String(data.reason || 'Admin dashboard')).catch(e => { throw Object.assign(new Error(e.message), { status: 400 }); });
      log('discord_member_kick', { guildId, memberId, reason: String(data.reason || '') });
      return send(res, 200, { ok: true }), true;
    }
    if (action === 'ban') {
      if (!requirePermission(me, PermissionFlagsBits.BanMembers, res) || (member.id !== guild.ownerId && !member.bannable)) return fail(res, 403, member.id === guild.ownerId ? 'Guild owner cannot be banned' : 'Target is above the bot or is otherwise not bannable'), true;
      const data = await body();
      const seconds = Math.min(604800, Math.max(0, Number(data.deleteMessageSeconds || 0)));
      await guild.members.ban(member.id, { deleteMessageSeconds: seconds, reason: String(data.reason || 'Admin dashboard') }).catch(e => { throw Object.assign(new Error(e.message), { status: 400 }); });
      log('discord_member_ban', { guildId, memberId, reason: String(data.reason || ''), deleteMessageSeconds: seconds });
      return send(res, 200, { ok: true }), true;
    }
    if (action === 'timeout') {
      if (!requirePermission(me, PermissionFlagsBits.ModerateMembers, res) || !member.moderatable) return fail(res, 403, 'Target cannot be timed out by this bot'), true;
      const data = await body();
      const durationMs = Math.min(28 * 24 * 60 * 60 * 1000, Math.max(1, Number(data.durationMs || 0)));
      await member.timeout(durationMs, String(data.reason || 'Admin dashboard')).catch(e => { throw Object.assign(new Error(e.message), { status: 400 }); });
      log('discord_member_timeout', { guildId, memberId, durationMs, reason: String(data.reason || '') });
      return send(res, 200, { ok: true }), true;
    }
    if (action === 'untimeout') {
      if (!requirePermission(me, PermissionFlagsBits.ModerateMembers, res) || !member.moderatable) return fail(res, 403, 'Target cannot be modified by this bot'), true;
      const data = await body();
      await member.timeout(null, String(data.reason || 'Admin dashboard')).catch(e => { throw Object.assign(new Error(e.message), { status: 400 }); });
      log('discord_member_untimeout', { guildId, memberId, reason: String(data.reason || '') });
      return send(res, 200, { ok: true }), true;
    }
    if (action === 'nickname') {
      if (!requirePermission(me, PermissionFlagsBits.ManageNicknames, res) || !member.manageable) return fail(res, 403, 'Target nickname cannot be managed by this bot'), true;
      const data = await body();
      await member.setNickname(data.nickname ? String(data.nickname).slice(0, 32) : null, String(data.reason || 'Admin dashboard')).catch(e => { throw Object.assign(new Error(e.message), { status: 400 }); });
      log('discord_member_nickname', { guildId, memberId });
      return send(res, 200, { ok: true }), true;
    }
    if (action === 'roles') {
      if (!requirePermission(me, PermissionFlagsBits.ManageRoles, res) || !member.manageable) return fail(res, 403, 'Member roles cannot be managed by this bot'), true;
      const data = await body();
      const role = guild.roles.cache.get(String(data.roleId || ''));
      if (!role || role.id === guild.id) return fail(res, 404, 'Role not found'), true;
      if (role.managed || me.roles.highest.comparePositionTo(role) <= 0) return fail(res, 403, 'Role is managed or at/above the bot hierarchy'), true;
      const op = data.action === 'remove' ? 'remove' : 'add';
      await (op === 'add' ? member.roles.add(role, String(data.reason || 'Admin dashboard')) : member.roles.remove(role, String(data.reason || 'Admin dashboard')));
      log(`discord_member_role_${op}`, { guildId, memberId, roleId: role.id });
      return send(res, 200, { ok: true, member: memberPayload(member) }), true;
    }
    if (action === 'dm') {
      const data = await body();
      const content = String(data.content || '').slice(0, 2000);
      if (!content) return fail(res, 400, 'Message content is required'), true;
      const message = await member.send({ content, allowedMentions: { parse: [] } }).catch(e => { throw Object.assign(new Error(e.message), { status: 400 }); });
      log('discord_member_dm', { guildId, memberId, messageId: message.id });
      return send(res, 200, { ok: true, messageId: message.id }), true;
    }
    return fail(res, 404, 'Member action not found'), true;
  }

  const roleMatch = sub.match(/^roles(?:\/([^/]+)(?:\/(.*))?)?$/);
  if (roleMatch) {
    const roleId = roleMatch[1];
    const action = roleMatch[2] || '';
    const me = await meOf(guild);
    if (!requirePermission(me, PermissionFlagsBits.ManageRoles, res)) return true;
    if (req.method === 'GET' && !roleId) return send(res, 200, { items: [...guild.roles.cache.values()].sort((a, b) => b.position - a.position).map(rolePayload) }), true;
    if (!requireWrite(cfg, res)) return true;
    if (req.method === 'POST' && !roleId) {
      const data = await body();
      const role = await guild.roles.create({ name: String(data.name || 'New Role').slice(0, 100), color: data.color || undefined, hoist: !!data.hoist, mentionable: !!data.mentionable, reason: String(data.reason || 'Admin dashboard') });
      log('discord_role_create', { guildId, roleId: role.id });
      return send(res, 200, { ok: true, role: rolePayload(role) }), true;
    }
    const role = guild.roles.cache.get(roleId);
    if (!role) return fail(res, 404, 'Role not found'), true;
    if (role.managed || role.id === guild.id || me.roles.highest.comparePositionTo(role) <= 0) return fail(res, 403, 'Role is managed or at/above the bot hierarchy'), true;
    if (req.method === 'DELETE' && !action) {
      await role.delete('Admin dashboard');
      log('discord_role_delete', { guildId, roleId });
      return send(res, 200, { ok: true }), true;
    }
    if (req.method === 'PATCH' && action === 'position') {
      const data = await body();
      const position = Math.max(1, Math.min(me.roles.highest.position - 1, Number(data.position || 1)));
      await role.setPosition(position, { reason: String(data.reason || 'Admin dashboard') });
      log('discord_role_position', { guildId, roleId, position });
      return send(res, 200, { ok: true, role: rolePayload(role) }), true;
    }
    if (req.method === 'PATCH' && !action) {
      const data = await body();
      await role.edit({ name: data.name == null ? undefined : String(data.name).slice(0, 100), color: data.color == null ? undefined : data.color, hoist: data.hoist == null ? undefined : !!data.hoist, mentionable: data.mentionable == null ? undefined : !!data.mentionable, reason: String(data.reason || 'Admin dashboard') });
      log('discord_role_edit', { guildId, roleId });
      return send(res, 200, { ok: true, role: rolePayload(role) }), true;
    }
    return fail(res, 404, 'Role action not found'), true;
  }

  const channelMatch = sub.match(/^channels(?:\/([^/]+)(?:\/(.*))?)?$/);
  if (channelMatch) {
    const channelId = channelMatch[1];
    const action = channelMatch[2] || '';
    const me = await meOf(guild);
    if (!requirePermission(me, PermissionFlagsBits.ManageChannels, res)) return true;
    if (req.method === 'GET' && !channelId) return send(res, 200, { items: [...guild.channels.cache.values()].sort((a, b) => (a.rawPosition ?? 0) - (b.rawPosition ?? 0)).map(channelPayload) }), true;
    if (!requireWrite(cfg, res)) return true;
    if (req.method === 'POST' && !channelId) {
      const data = await body();
      const requestedType = data.type == null ? ChannelType.GuildText : Number(data.type);
      const allowedTypes = new Set([ChannelType.GuildText, ChannelType.GuildVoice, ChannelType.GuildCategory, ChannelType.GuildAnnouncement, ChannelType.GuildForum, ChannelType.GuildStageVoice]);
      if (!allowedTypes.has(requestedType)) return fail(res, 400, 'Unsupported channel type'), true;
      const parentId = data.parentId ? String(data.parentId) : undefined;
      const channel = await guild.channels.create({ name: String(data.name || 'new-channel').slice(0, 100), type: requestedType, parent: parentId, topic: data.topic == null ? undefined : String(data.topic).slice(0, 4096), nsfw: data.nsfw == null ? undefined : !!data.nsfw, rateLimitPerUser: data.rateLimitPerUser == null ? undefined : Math.max(0, Math.min(21600, Number(data.rateLimitPerUser))), reason: String(data.reason || 'Admin dashboard') });
      log('discord_channel_create', { guildId, channelId: channel.id });
      return send(res, 200, { ok: true, channel: channelPayload(channel) }), true;
    }
    const channel = guild.channels.cache.get(channelId);
    if (!channel) return fail(res, 404, 'Channel not found'), true;
    if (!channel.manageable) return fail(res, 403, 'Channel is not manageable by this bot'), true;
    if (req.method === 'DELETE' && !action) {
      await channel.delete('Admin dashboard');
      log('discord_channel_delete', { guildId, channelId });
      return send(res, 200, { ok: true }), true;
    }
    if (req.method === 'PATCH' && action === 'permissions') {
      const data = await body();
      const targetId = String(data.targetId || '');
      if (!targetId) return fail(res, 400, 'targetId is required'), true;
      const target = data.targetType === 'member' ? await memberFor(guild, targetId) : guild.roles.cache.get(targetId);
      if (!target) return fail(res, 404, 'Permission target not found'), true;
      await channel.permissionOverwrites.edit(target.id, permissionObject(data.allow, data.deny), { reason: String(data.reason || 'Admin dashboard') });
      log('discord_channel_permissions', { guildId, channelId, targetId });
      return send(res, 200, { ok: true }), true;
    }
    if (req.method === 'PATCH' && !action) {
      const data = await body();
      await channel.edit({ name: data.name == null ? undefined : String(data.name).slice(0, 100), topic: data.topic == null ? undefined : String(data.topic).slice(0, 4096), parent: data.parentId == null ? undefined : (data.parentId || null), nsfw: data.nsfw == null ? undefined : !!data.nsfw, rateLimitPerUser: data.rateLimitPerUser == null ? undefined : Math.max(0, Math.min(21600, Number(data.rateLimitPerUser))), reason: String(data.reason || 'Admin dashboard') });
      log('discord_channel_edit', { guildId, channelId });
      return send(res, 200, { ok: true, channel: channelPayload(channel) }), true;
    }
    return fail(res, 404, 'Channel action not found'), true;
  }

  if (req.method === 'POST' && sub === 'message') {
    if (!requireWrite(cfg, res)) return true;
    const me = await meOf(guild);
    const data = await body();
    const channel = guild.channels.cache.get(String(data.channelId || ''));
    if (!channel?.isTextBased?.() || typeof channel.send !== 'function') return fail(res, 400, 'Text channel not found'), true;
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.SendMessages)) return fail(res, 403, 'Bot cannot send messages in that channel'), true;
    const content = String(data.content || '').slice(0, 2000);
    const embeds = Array.isArray(data.embeds) ? data.embeds.slice(0, 10).map(e => ({
      title: e?.title ? String(e.title).slice(0, 256) : undefined,
      description: e?.description ? String(e.description).slice(0, 4096) : undefined,
      url: e?.url ? String(e.url).slice(0, 2048) : undefined,
      color: e?.color == null ? undefined : e.color,
      footer: e?.footer?.text ? { text: String(e.footer.text).slice(0, 2048) } : undefined,
      author: e?.author?.name ? { name: String(e.author.name).slice(0, 256), url: e.author.url ? String(e.author.url).slice(0, 2048) : undefined, icon_url: e.author.icon_url ? String(e.author.icon_url).slice(0, 2048) : undefined } : undefined
    })).filter(Boolean) : [];
    if (!content && !embeds.length) return fail(res, 400, 'Message content or embeds are required'), true;
    const msg = await channel.send({ content: content || undefined, embeds, allowedMentions: { parse: [] } });
    log('guild_message', { guildId, channelId: channel.id, messageId: msg.id, embedCount: embeds.length });
    return send(res, 200, { ok: true, messageId: msg.id }), true;
  }

  if (sub === 'tickets') {
    const tickets = client.config.tickets || {};
    if (req.method === 'GET') {
      const channels = [...guild.channels.cache.values()].filter(c => c.isTextBased?.() && (tickets.categoryId ? c.parentId === tickets.categoryId : c.name.startsWith('ticket-')));
      return send(res, 200, { enabled: tickets.enabled === true, items: channels.map(c => ({ id: c.id, name: c.name, parentId: c.parentId, position: c.rawPosition ?? 0, topic: c.topic || null, manageable: !!c.manageable })) }), true;
    }
    if (!requireWrite(cfg, res)) return true;
    const me = await meOf(guild);
    if (!requirePermission(me, PermissionFlagsBits.ManageChannels, res)) return true;
    if (req.method === 'POST' && actionFrom(sub) === 'create') {
      const data = await body();
      const userId = String(data.userId || '');
      const user = await memberFor(guild, userId);
      if (!user) return fail(res, 404, 'Ticket user is not a member'), true;
      const existing = [...guild.channels.cache.values()].find(c => c.name === `ticket-${user.id}`);
      if (existing) return send(res, 409, { error: 'User already has a ticket', channelId: existing.id }), true;
      const overwrites = [{ id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] }, { id: user.id, allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] }];
      for (const roleId of Array.isArray(tickets.supportRoleIds) ? tickets.supportRoleIds : []) overwrites.push({ id: String(roleId), allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory] });
      const ch = await guild.channels.create({ name: `ticket-${user.id}`, type: ChannelType.GuildText, parent: tickets.categoryId || undefined, permissionOverwrites: overwrites, reason: 'Admin dashboard ticket creation' });
      await ch.send({ content: tickets.mentionSupport ? `${user}` : 'Ticket opened. A staff member can assist you.' });
      log('ticket_create', { guildId, userId, channelId: ch.id });
      return send(res, 200, { ok: true, channel: channelPayload(ch) }), true;
    }
    if (req.method === 'POST' && actionFrom(sub) === 'close') {
      const data = await body();
      const channel = guild.channels.cache.get(String(data.channelId || ''));
      if (!channel?.name?.startsWith('ticket-')) return fail(res, 404, 'Ticket channel not found'), true;
      await channel.delete(String(data.reason || 'Ticket closed from admin dashboard'));
      log('ticket_close', { guildId, channelId: channel.id });
      return send(res, 200, { ok: true }), true;
    }
    if (req.method === 'POST' && actionFrom(sub) === 'claim') {
      const data = await body();
      const channel = guild.channels.cache.get(String(data.channelId || ''));
      const staff = await memberFor(guild, String(data.userId || ''));
      if (!channel?.name?.startsWith('ticket-') || !staff) return fail(res, 404, 'Ticket or staff member not found'), true;
      await channel.permissionOverwrites.edit(staff.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }, { reason: 'Ticket claim' });
      log('ticket_claim', { guildId, channelId: channel.id, userId: staff.id });
      return send(res, 200, { ok: true }), true;
    }
    return fail(res, 404, 'Ticket action not found'), true;
  }

  if (sub === 'webhooks/create' && req.method === 'POST') {
    if (!requireWrite(cfg, res)) return true;
    const data = await body();
    const channel = guild.channels.cache.get(String(data.channelId || ''));
    if (!channel?.isTextBased?.() || typeof channel.createWebhook !== 'function') return fail(res, 400, 'Webhook-capable channel not found'), true;
    const me = await meOf(guild);
    if (!channel.permissionsFor(me)?.has(PermissionFlagsBits.ManageWebhooks)) return fail(res, 403, 'Bot cannot manage webhooks in that channel'), true;
    const webhook = await channel.createWebhook({ name: String(data.name || 'RealmsNetwork Webhook').slice(0, 80), avatar: data.avatar ? String(data.avatar).slice(0, 2048) : undefined, reason: String(data.reason || 'Admin dashboard') });
    log('webhook_create', { guildId, webhookId: webhook.id, channelId: channel.id });
    return send(res, 200, { ok: true, webhook: { id: webhook.id, name: webhook.name, channelId: webhook.channelId, url: webhook.url, token: webhook.token || null } }), true;
  }

  const webhookMatch = sub.match(/^webhooks\/([^/]+)(?:\/(.*))?$/);
  if (webhookMatch) {
    const webhookId = webhookMatch[1];
    const action = webhookMatch[2] || '';
    const me = await meOf(guild);
    if (!requirePermission(me, PermissionFlagsBits.ManageWebhooks, res)) return true;
    const hooks = await guild.fetchWebhooks();
    const webhook = hooks.get(webhookId);
    if (!webhook) return fail(res, 404, 'Webhook not found'), true;
    if (req.method === 'DELETE' && !action) {
      if (!requireWrite(cfg, res)) return true;
      await webhook.delete('Admin dashboard');
      log('webhook_delete', { guildId, webhookId });
      return send(res, 200, { ok: true }), true;
    }
    if (req.method === 'PATCH' && !action) {
      if (!requireWrite(cfg, res)) return true;
      const data = await body();
      await webhook.edit({ name: data.name ? String(data.name).slice(0, 80) : undefined, channel: data.channelId ? String(data.channelId) : undefined, reason: String(data.reason || 'Admin dashboard') });
      log('webhook_edit', { guildId, webhookId });
      return send(res, 200, { ok: true, webhook: { id: webhook.id, name: webhook.name, channelId: webhook.channelId, url: webhook.url, hasToken: !!webhook.token } }), true;
    }
    if (req.method === 'POST' && action === 'send') {
      if (!requireWrite(cfg, res)) return true;
      if (!webhook.token) return fail(res, 400, 'This webhook does not expose a send token to the bot session'), true;
      const data = await body();
      const content = String(data.content || '').slice(0, 2000);
      if (!content) return fail(res, 400, 'Message content is required'), true;
      const message = await webhook.send({ content, username: data.username ? String(data.username).slice(0, 80) : undefined, avatarURL: data.avatarURL ? String(data.avatarURL).slice(0, 2048) : undefined, allowedMentions: { parse: [] } });
      log('webhook_send', { guildId, webhookId, messageId: typeof message === 'string' ? message : message?.id });
      return send(res, 200, { ok: true, messageId: typeof message === 'string' ? message : message?.id || null }), true;
    }
    return fail(res, 404, 'Webhook action not found'), true;
  }

  return fail(res, 404, 'Discord management route not found'), true;
}

function actionFrom(sub) {
  return sub.split('/').at(-1);
}

module.exports = { handle };
