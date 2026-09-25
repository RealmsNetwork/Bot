const {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  UserSelectMenuBuilder,
  RoleSelectMenuBuilder,
  StringSelectMenuBuilder,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  PermissionFlagsBits
} = require('discord.js');

const selections = new Map();
let cleanupTimer = null;

function cfg(client) {
  return client.modules.get('voice')?.config || {};
}

function tempCfg(client) {
  return cfg(client).temporaryVoice || {};
}

function brand(client) {
  const b = client.config.branding || {};
  return {
    server: b.serverName || 'RealmsNetwork',
    color: b.embedColor || '#8b5cf6',
    footer: b.footer || b.serverName || 'RealmsNetwork'
  };
}

function panelSlug(client, name) {
  const c = tempCfg(client);
  const suffix = String(c.panelSuffix || '-panel');
  const base = String(name || 'room')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .slice(0, Math.max(1, 100 - suffix.length));
  return (base || 'room').slice(0, Math.max(1, 100 - suffix.length)) + suffix;
}

function roomFromPanel(channelId, rooms) {
  for (const room of rooms.values()) {
    if (room.panelChannelId === channelId) return room;
  }
  return null;
}

function normalizeRoom(room) {
  room.accessUsers = room.accessUsers instanceof Set ? room.accessUsers : new Set(room.accessUsers || []);
  room.accessRoles = room.accessRoles instanceof Set ? room.accessRoles : new Set(room.accessRoles || []);
  room.accessUsers.add(room.ownerId);
  room.controlUsers = room.controlUsers instanceof Set ? room.controlUsers : new Set(room.controlUsers || []);
  room.controlRoles = room.controlRoles instanceof Set ? room.controlRoles : new Set(room.controlRoles || []);
  room.controlUsers.add(room.ownerId);
  room.bannedUsers = room.bannedUsers instanceof Set ? room.bannedUsers : new Set(room.bannedUsers || []);
  room.tts = room.tts && typeof room.tts === 'object' ? room.tts : {};
  room.page = room.page || 'overview';
  if (!room.panelMessageId) room.panelMessageId = null;
}

function key(interaction, kind) {
  return interaction.guildId + ':' + interaction.user.id + ':' + kind;
}

function selected(interaction, kind) {
  return selections.get(key(interaction, kind));
}

function canAccess(interaction, room) {
  normalizeRoom(room);
  if (!interaction.member) return false;
  if (interaction.user.id === room.ownerId) return true;
  if (room.accessUsers.has(interaction.user.id)) return true;
  return interaction.member.roles?.cache
    ? [...room.accessRoles].some(id => interaction.member.roles.cache.has(id))
    : false;
}

function canControl(interaction, room, client) {
  normalizeRoom(room);
  if (room.ownerId === interaction.user.id) return true;
  const c = tempCfg(client);
  if (c.ownerOnlyControl !== false) return false;
  if (room.controlUsers.has(interaction.user.id)) return true;
  return interaction.member?.roles?.cache ? [...room.controlRoles].some(id => interaction.member.roles.cache.has(id)) : false;
}

function pageMenu(page) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rn-tvc:page')
      .setPlaceholder('Navigate panel...')
      .addOptions(
        { label: 'Overview', value: 'overview', description: 'Room status and quick actions', default: page === 'overview' },
        { label: 'Room Settings', value: 'room', description: 'Lock, visibility, name, limit, bitrate and region', default: page === 'room' },
        { label: 'Audio & TTS', value: 'audio', description: 'Room-specific TTS voice, rate, volume and controls', default: page === 'audio' },
        { label: 'Access', value: 'access', description: 'Choose users and roles for panel access', default: page === 'access' },
        { label: 'Members', value: 'members', description: 'Kick, mute, deafen, ban and transfer members', default: page === 'members' },
        { label: 'Danger Zone', value: 'danger', description: 'Ownership, access reset and deletion', default: page === 'danger' }
      )
  );
}

function button(id, label, style, disabled) {
  return new ButtonBuilder()
    .setCustomId('rn-tvc:' + id)
    .setLabel(label)
    .setStyle(style || ButtonStyle.Secondary)
    .setDisabled(!!disabled);
}

function statusText(room, voice) {
  normalizeRoom(room);
  return [
    '**Voice:** ' + (voice ? '<#' + voice.id + '>' : 'missing'),
    '**Owner:** <@' + room.ownerId + '>',
    '**Members:** ' + (voice?.members?.size || 0) + '/' + (voice?.userLimit || '∞'),
    '**Bitrate:** ' + (voice ? Math.round(voice.bitrate / 1000) + ' kbps' : 'unknown'),
    '**Locked:** ' + (room.locked ? 'Yes' : 'No'),
    '**Hidden:** ' + (room.hidden ? 'Yes' : 'No'),
    '**Panel users:** ' + room.accessUsers.size,
    '**Panel roles:** ' + room.accessRoles.size,
    '**VC bans:** ' + room.bannedUsers.size
  ].join('\n');
}

function buildPayload(client, room) {
  normalizeRoom(room);
  const c = tempCfg(client);
  const b = brand(client);
  const guild = client.guilds.cache.get(room.guildId);
  const voice = guild?.channels.cache.get(room.voiceChannelId);
  const page = room.page || 'overview';
  let description;

  if (page === 'overview') {
    description = [
      c.panelDescription || 'Manage your temporary voice room.',
      '',
      statusText(room, voice),
      '',
      'Use the navigation menu to open more controls.'
    ].join('\n');
  } else if (page === 'room') {
    description = [
      '### Room Settings',
      'Current name: **' + (voice?.name || 'Unknown') + '**',
      'Lock: **' + (room.locked ? 'Locked' : 'Unlocked') + '**',
      'Visibility: **' + (room.hidden ? 'Hidden' : 'Visible') + '**',
      'Limit: **' + (voice?.userLimit || 0) + '** (' + (voice?.userLimit ? 'limited' : 'unlimited') + ')',
      'Bitrate: **' + (voice ? Math.round(voice.bitrate / 1000) : 'unknown') + ' kbps**',
      '',
      'Buttons below apply immediately. Rename, limit and bitrate open a form.'
    ].join('\n');
  } else if (page === 'audio') {
    const base = cfg(client).tts || {};
    const t = { ...base, ...(room.tts || {}) };
    description = [
      '### Audio & TTS',
      '**TTS:** ' + (t.enabled === false ? 'Disabled' : 'Enabled'),
      '**Voice:** ' + (t.voice || t.defaultVoice || base.defaultVoice || 'default'),
      '**Language:** ' + (t.language || t.defaultLanguage || base.defaultLanguage || 'default'),
      '**Rate:** ' + (t.rate ?? t.maxRate ?? base.maxRate ?? 100) + '%',
      '**Volume:** ' + (t.volume ?? t.maxVolume ?? base.maxVolume ?? 100) + '%',
      '',
      'These settings override the module defaults for this temporary room only.'
    ].join('\\n');
  } else if (page === 'audio') {
    rows.push(
      new ActionRowBuilder().addComponents(
        button('tts-toggle', 'Toggle TTS', room.tts.enabled === false ? ButtonStyle.Success : ButtonStyle.Secondary, c.panelAllowTtsControl === false),
        button('tts-voice', 'Voice', ButtonStyle.Primary, c.panelAllowTtsControl === false),
        button('tts-language', 'Language', ButtonStyle.Primary, c.panelAllowTtsControl === false),
        button('tts-rate', 'Rate', ButtonStyle.Primary, c.panelAllowTtsControl === false),
        button('tts-volume', 'Volume', ButtonStyle.Primary, c.panelAllowTtsControl === false)
      ),
      new ActionRowBuilder().addComponents(
        button('tts-reset', 'Reset TTS Defaults', ButtonStyle.Secondary, c.panelAllowTtsControl === false),
        button('tts-test', 'Test TTS', ButtonStyle.Success, c.panelAllowTtsControl === false),
        button('refresh', 'Refresh', ButtonStyle.Secondary)
      )
    );
  } else if (page === 'access') {
    const users = [...room.accessUsers].map(id => '<@' + id + '>').join(', ') || 'None';
    const roles = [...room.accessRoles].map(id => '<@&' + id + '>').join(', ') || 'None';
    description = [
      '### Panel Access',
      '**Users:** ' + users,
      '**Roles:** ' + roles,
      '',
      c.syncPermissions !== false
        ? 'Voice permissions are synced with panel access.'
        : 'Panel access is separate from voice access.',
      '',
      'Select a user or role, then Grant or Remove it.'
    ].join('\n');
  } else if (page === 'members') {
    const members = voice?.members ? [...voice.members.values()].map(m => '<@' + m.id + '>').join(', ') : '';
    const banned = [...room.bannedUsers].map(id => '<@' + id + '>').join(', ') || 'None';
    description = [
      '### Room Members',
      members || 'Nobody is currently connected.',
      '',
      'Select a member, then use the moderation controls.'
    ].join('\n');
  } else {
    description = [
      '### Danger Zone',
      'These actions can permanently change the room.',
      '',
      '**Owner:** <@' + room.ownerId + '>',
      '**Panel:** ' + (room.panelChannelId ? '<#' + room.panelChannelId + '>' : 'missing'),
      '',
      'Reset Access removes custom panel access and returns control to the owner.',
      'Delete Room removes both the voice channel and its panel.'
    ].join('\n');
  }

  const rows = [pageMenu(page)];

  if (page === 'overview') {
    rows.push(
      new ActionRowBuilder().addComponents(
        button('refresh', 'Refresh', ButtonStyle.Secondary),
        button(room.locked ? 'unlock' : 'lock', room.locked ? 'Unlock VC' : 'Lock VC', room.locked ? ButtonStyle.Success : ButtonStyle.Primary),
        button(room.hidden ? 'unhide' : 'hide', room.hidden ? 'Show VC' : 'Hide VC', ButtonStyle.Secondary),
        button('rename', 'Rename', ButtonStyle.Primary, c.allowOwnerRename === false),
        button('claim', 'Claim', ButtonStyle.Success, c.allowOwnerClaim === false)
      ),
      new ActionRowBuilder().addComponents(
        button('limit', 'Set Limit', ButtonStyle.Primary, c.allowOwnerLimit === false),
        button('bitrate', 'Set Bitrate', ButtonStyle.Primary, c.allowOwnerBitrate === false),
        button('members', 'Members', ButtonStyle.Secondary),
        button('access', 'Access', ButtonStyle.Secondary),
        button('audio', 'TTS', ButtonStyle.Secondary, tempCfg(client).panelAllowTtsControl === false),
        button('danger', 'Danger Zone', ButtonStyle.Danger)
      )
    );
  } else if (page === 'room') {
    rows.push(
      new ActionRowBuilder().addComponents(
        button('lock', 'Lock VC', ButtonStyle.Primary, room.locked || c.allowOwnerLock === false),
        button('unlock', 'Unlock VC', ButtonStyle.Success, !room.locked || c.allowOwnerUnlock === false),
        button('hide', 'Hide VC', ButtonStyle.Secondary, room.hidden || c.allowOwnerHide === false),
        button('unhide', 'Show VC', ButtonStyle.Secondary, !room.hidden || c.allowOwnerUnhide === false),
        button('rename', 'Rename', ButtonStyle.Primary, c.allowOwnerRename === false)
      ),
      new ActionRowBuilder().addComponents(
        button('limit', 'User Limit', ButtonStyle.Primary, c.allowOwnerLimit === false),
        button('bitrate', 'Bitrate', ButtonStyle.Primary, c.allowOwnerBitrate === false),
        button('region', 'Voice Region', ButtonStyle.Secondary),
        button('nsfw', 'NSFW', ButtonStyle.Secondary),
        button('reset', 'Reset Room', ButtonStyle.Secondary)
      ),
      new ActionRowBuilder().addComponents(
        button('audio', 'Audio & TTS', ButtonStyle.Primary, c.panelAllowTtsControl === false),
        button('refresh', 'Refresh', ButtonStyle.Secondary)
      )
    );
  } else if (page === 'access') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('rn-tvc:access-user')
          .setPlaceholder('Select a user...')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button('grant-user', 'Grant User', ButtonStyle.Success),
        button('revoke-user', 'Remove User', ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder()
          .setCustomId('rn-tvc:access-role')
          .setPlaceholder('Select a role...')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button('grant-role', 'Grant Role', ButtonStyle.Success),
        button('revoke-role', 'Remove Role', ButtonStyle.Danger)
      )
    );
  } else if (page === 'members') {
    rows.push(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('rn-tvc:member')
          .setPlaceholder('Select a member...')
          .setMinValues(1)
          .setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button('kick', 'Kick', ButtonStyle.Danger, c.allowOwnerKick === false),
        button('ban', 'Ban from VC', ButtonStyle.Danger, c.allowOwnerBan === false),
        button('unban', 'Unban from VC', ButtonStyle.Success, c.allowOwnerBan === false),
        button('mute', 'Mute', ButtonStyle.Secondary, c.allowOwnerMute === false),
        button('unmute', 'Unmute', ButtonStyle.Success, c.allowOwnerMute === false)
      ),
      new ActionRowBuilder().addComponents(
        button('deafen', 'Deafen', ButtonStyle.Secondary, c.allowOwnerDeafen === false),
        button('undeafen', 'Undeafen', ButtonStyle.Success, c.allowOwnerDeafen === false),
        button('transfer-selected', 'Transfer Owner', ButtonStyle.Success, c.allowOwnerTransfer === false),
        button('panel-selected', 'Grant Panel', ButtonStyle.Primary),
        button('refresh', 'Refresh', ButtonStyle.Secondary)
      )
    );
  } else {
    rows.push(
      new ActionRowBuilder().addComponents(
        button('reset-access', 'Reset Access', ButtonStyle.Secondary),
        button('delete', 'Delete Room', ButtonStyle.Danger),
        button('refresh', 'Refresh', ButtonStyle.Secondary)
      )
    );
  }

  return {
    embeds: [
      new EmbedBuilder()
        .setColor(b.color)
        .setTitle(b.server + ' • ' + (c.panelTitle || 'Voice Control'))
        .setDescription(description)
        .setFooter({ text: b.footer + ' • ' + page })
        .setTimestamp()
    ],
    components: rows.slice(0, 5)
  };
}

async function refresh(client, room, page) {
  normalizeRoom(room);
  if (page) room.page = page;
  const guild = client.guilds.cache.get(room.guildId);
  const panel = guild?.channels.cache.get(room.panelChannelId);
  if (!panel?.isTextBased()) return null;

  const payload = buildPayload(client, room);
  if (room.panelMessageId) {
    try {
      const message = await panel.messages.fetch(room.panelMessageId);
      await message.edit(payload);
      return message;
    } catch {}
  }

  const message = await panel.send(payload);
  room.panelMessageId = message.id;
  return message;
}

function panelOverwrites(guild, ownerId) {
  return [
    {
      id: guild.roles.everyone.id,
      deny: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory
      ]
    },
    {
      id: ownerId,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.ReadMessageHistory
      ],
      deny: [PermissionFlagsBits.SendMessages]
    },
    {
      id: guild.members.me?.id || guild.client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.EmbedLinks,
        PermissionFlagsBits.ManageChannels,
        PermissionFlagsBits.ManageMessages
      ]
    }
  ];
}

async function create(client, member, voice, room) {
  const c = tempCfg(client);
  if (c.panelEnabled === false) return null;
  const guild = member.guild;
  const panel = await guild.channels.create({
    name: panelSlug(client, voice.name),
    type: ChannelType.GuildText,
    parent: c.categoryId || voice.parentId || undefined,
    topic: 'RealmsNetwork temporary VC panel | owner=' + member.id + ' | voice=' + voice.id,
    permissionOverwrites: panelOverwrites(guild, member.id),
    reason: 'Create temporary voice room control panel'
  });

  room.panelChannelId = panel.id;
  room.accessUsers = room.accessUsers instanceof Set ? room.accessUsers : new Set([room.ownerId]);
  room.accessRoles = room.accessRoles instanceof Set ? room.accessRoles : new Set();

  const message = await refresh(client, room, 'overview');
  if (c.panelAutoPin !== false && message) {
    await message.pin().catch(() => {});
  }
  return panel;
}

async function deleteRoom(client, rooms, room, guild, reason) {
  if (!room) return;
  rooms.delete(room.voiceChannelId);
  const panel = room.panelChannelId && guild.channels.cache.get(room.panelChannelId);
  const voice = guild.channels.cache.get(room.voiceChannelId);
  await panel?.delete(reason || 'Temporary voice room deleted').catch(() => {});
  await voice?.delete(reason || 'Temporary voice room deleted').catch(() => {});
}

async function grant(room, guild, id, type, client) {
  normalizeRoom(room);
  const c = tempCfg(client);
  const panel = guild.channels.cache.get(room.panelChannelId);
  if (!panel?.permissionOverwrites) throw new Error('The panel channel is missing.');

  if (type === 'role') {
    const role = guild.roles.cache.get(id);
    if (!role || role.managed || id === guild.roles.everyone.id) throw new Error('That role cannot be granted.');
    if (c.panelAllowRoleAccess === false) throw new Error('Role access is disabled.');
    room.accessRoles.add(id);
  } else {
    const member = guild.members.cache.get(id) || await guild.members.fetch(id).catch(() => null);
    if (!member || member.user.bot) throw new Error('That user cannot be granted.');
    if (c.panelAllowUserAccess === false) throw new Error('User access is disabled.');
    room.accessUsers.add(id);
  }

  await panel.permissionOverwrites.edit(id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false
  });

  if (c.syncPermissions !== false) {
    const voice = guild.channels.cache.get(room.voiceChannelId);
    await voice?.permissionOverwrites.edit(id, {
      ViewChannel: true,
      Connect: true,
      Speak: true
    });
  }
}

async function revoke(room, guild, id, type, client) {
  normalizeRoom(room);
  if (id === room.ownerId) throw new Error('The owner cannot be removed from panel access.');
  const panel = guild.channels.cache.get(room.panelChannelId);
  if (type === 'role') room.accessRoles.delete(id);
  else room.accessUsers.delete(id);

  await panel?.permissionOverwrites.delete(id).catch(() => {});

  if (tempCfg(client).syncPermissions !== false) {
    await guild.channels.cache.get(room.voiceChannelId)?.permissionOverwrites.delete(id).catch(() => {});
  }
}

async function showForm(interaction, kind) {
  let title = 'Temporary Voice Room';
  let label = 'Value';
  let placeholder = '';
  if (kind === 'rename') {
    title = 'Rename Temporary Room';
    label = 'New room name';
  } else if (kind === 'limit') {
    title = 'Set User Limit';
    label = 'User limit (0 = unlimited)';
    placeholder = '0-99';
  } else if (kind === 'bitrate') {
    title = 'Set Voice Bitrate';
    label = 'Bitrate in kbps';
    placeholder = '8-384';
  } else if (kind === 'region') {
    title = 'Set Voice Region';
    label = 'Region or auto';
    placeholder = 'auto, us-east, europe, japan...';
  } else if (kind === 'tts-voice') {
    title = 'Set TTS Voice';
    label = 'Voice name';
    placeholder = 'en-US-AriaNeural';
  } else if (kind === 'tts-language') {
    title = 'Set TTS Language';
    label = 'Language code';
    placeholder = 'en-US';
  } else if (kind === 'tts-rate') {
    title = 'Set TTS Rate';
    label = 'Rate percent';
    placeholder = '0-100';
  } else if (kind === 'tts-volume') {
    title = 'Set TTS Volume';
    label = 'Volume percent';
    placeholder = '0-100';
  }

  const modal = new ModalBuilder()
    .setCustomId('rn-tvc-modal:' + kind)
    .setTitle(title)
    .addComponents(
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId('value')
          .setLabel(label)
          .setStyle(TextInputStyle.Short)
          .setRequired(true)
          .setMaxLength(kind === 'rename' ? 100 : kind.startsWith('tts-voice') ? 80 : 32)
          .setPlaceholder(placeholder)
      )
    );

  return interaction.showModal(modal);
}

async function handleButton(interaction, client, rooms) {
  const room = roomFromPanel(interaction.channelId, rooms);
  if (!room || !canAccess(interaction, room)) {
    return interaction.reply({ content: 'You do not have access to this panel.', ephemeral: true });
  }
  normalizeRoom(room);

  const action = interaction.customId.slice('rn-tvc:'.length);
  if (['refresh', 'members', 'access', 'danger', 'overview', 'room', 'audio'].includes(action)) {
    room.page = action === 'refresh' ? room.page : action;
    return interaction.update(buildPayload(client, room));
  }

  if (action === 'claim') {
    if (tempCfg(client).allowOwnerClaim === false) return interaction.reply({ content: 'Claiming is disabled.', ephemeral: true });
    room.ownerId = interaction.user.id;
    room.accessUsers.add(interaction.user.id);
    await interaction.guild.channels.cache.get(room.voiceChannelId)?.permissionOverwrites.edit(interaction.user.id, {
      Connect: true,
      Speak: true,
      ViewChannel: true
    });
    await interaction.guild.channels.cache.get(room.panelChannelId)?.permissionOverwrites.edit(interaction.user.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false
    });
    room.page = 'overview';
    return interaction.update(buildPayload(client, room));
  }

  if (!canControl(interaction, room, client)) {
    return interaction.reply({ content: 'Only the room owner can use these controls.', ephemeral: true });
  }

  const guild = interaction.guild;
  const voice = guild.channels.cache.get(room.voiceChannelId);
  if (!voice) return interaction.reply({ content: 'The voice room no longer exists.', ephemeral: true });

  const c = tempCfg(client);
  const userId = selected(interaction, 'member');
  const bannedId = selected(interaction, 'member');
  const accessUser = selected(interaction, 'access-user');
  const accessRole = selected(interaction, 'access-role');

  if (['rename', 'limit', 'bitrate', 'region'].includes(action)) return showForm(interaction, action);

  if (action === 'lock') {
    room.locked = true;
    await voice.permissionOverwrites.edit(guild.roles.everyone, { Connect: false });
  } else if (action === 'unlock') {
    room.locked = false;
    await voice.permissionOverwrites.edit(guild.roles.everyone, { Connect: true });
  } else if (action === 'hide') {
    room.hidden = true;
    await voice.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: false });
  } else if (action === 'unhide') {
    room.hidden = false;
    await voice.permissionOverwrites.edit(guild.roles.everyone, { ViewChannel: true });
  } else if (action === 'region') {
    return showForm(interaction, 'region');
  } else if (action === 'nsfw') {
    await voice.setNSFW(!voice.nsfw, 'Temporary VC owner toggled NSFW');
  } else if (action === 'reset') {
    room.locked = false;
    room.hidden = false;
    await voice.permissionOverwrites.edit(guild.roles.everyone, { Connect: true, ViewChannel: true });
    await voice.permissionOverwrites.edit(room.ownerId, { Connect: true, Speak: true, ViewChannel: true });
  } else if (action === 'grant-user') {
    if (!accessUser) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    await grant(room, guild, accessUser, 'user', client);
  } else if (action === 'revoke-user') {
    if (!accessUser) return interaction.reply({ content: 'Select a user first.', ephemeral: true });
    await revoke(room, guild, accessUser, 'user', client);
  } else if (action === 'grant-role') {
    if (!accessRole) return interaction.reply({ content: 'Select a role first.', ephemeral: true });
    await grant(room, guild, accessRole, 'role', client);
  } else if (action === 'revoke-role') {
    if (!accessRole) return interaction.reply({ content: 'Select a role first.', ephemeral: true });
    await revoke(room, guild, accessRole, 'role', client);
  } else if (action === 'ban' || action === 'unban') {
    const target = userId && guild.members.cache.get(userId);
    if (!target || target.id === interaction.user.id) return interaction.reply({ content: 'Select another member.', ephemeral: true });
    if (action === 'ban') {
      room.bannedUsers.add(target.id);
      room.accessUsers.delete(target.id);
      room.controlUsers?.delete(target.id);
      await voice.permissionOverwrites.edit(target.id, {
        Connect: false,
        ViewChannel: false,
        Speak: false
      });
      await target.voice.disconnect('Banned from temporary voice room').catch(() => {});
    } else {
      room.bannedUsers.delete(target.id);
      const allow = { Connect: !room.locked, ViewChannel: !room.hidden, Speak: true };
      await voice.permissionOverwrites.edit(target.id, allow).catch(() => {});
    }
  } else if (action === 'kick') {
    const target = userId && voice.members.get(userId);
    if (!target || target.id === interaction.user.id) return interaction.reply({ content: 'Select another member in the room.', ephemeral: true });
    await target.voice.disconnect('Temporary VC owner action');
  } else if (action === 'mute' || action === 'unmute') {
    const target = userId && voice.members.get(userId);
    if (!target || target.id === interaction.user.id) return interaction.reply({ content: 'Select another member in the room.', ephemeral: true });
    await target.voice.setMute(action === 'mute', 'Temporary VC owner action');
  } else if (action === 'deafen' || action === 'undeafen') {
    const target = userId && voice.members.get(userId);
    if (!target || target.id === interaction.user.id) return interaction.reply({ content: 'Select another member in the room.', ephemeral: true });
    await target.voice.setDeaf(action === 'deafen', 'Temporary VC owner action');
  } else if (action === 'transfer-selected') {
    if (c.allowOwnerTransfer === false) return interaction.reply({ content: 'Owner transfer is disabled.', ephemeral: true });
    const target = userId && voice.members.get(userId);
    if (!target) return interaction.reply({ content: 'Select a member who is in the room.', ephemeral: true });
    room.ownerId = target.id;
    room.accessUsers.add(target.id);
    await voice.permissionOverwrites.edit(target.id, { Connect: true, Speak: true, ViewChannel: true });
    await guild.channels.cache.get(room.panelChannelId)?.permissionOverwrites.edit(target.id, {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false
    });
  } else if (action === 'panel-selected') {
    if (!userId) return interaction.reply({ content: 'Select a member first.', ephemeral: true });
    await grant(room, guild, userId, 'user', client);
  } else if (action === 'tts-toggle') {
    if (c.panelAllowTtsControl === false) return interaction.reply({ content: 'Room TTS controls are disabled.', ephemeral: true });
    room.tts = { ...(cfg(client).tts || {}), ...(room.tts || {}), enabled: room.tts.enabled === false };
  } else if (['tts-voice', 'tts-language', 'tts-rate', 'tts-volume'].includes(action)) {
    if (c.panelAllowTtsControl === false) return interaction.reply({ content: 'Room TTS controls are disabled.', ephemeral: true });
    return showForm(interaction, action);
  } else if (action === 'tts-reset') {
    if (c.panelAllowTtsControl === false) return interaction.reply({ content: 'Room TTS controls are disabled.', ephemeral: true });
    room.tts = {};
  } else if (action === 'tts-test') {
    if (c.panelAllowTtsControl === false) return interaction.reply({ content: 'Room TTS controls are disabled.', ephemeral: true });
    return interaction.reply({ content: 'Use `/tts <text>` while you are in this room to test the current room TTS settings.', ephemeral: true });
  } else if (action === 'reset-access') {
    const panel = guild.channels.cache.get(room.panelChannelId);
    for (const id of room.accessUsers) if (id !== room.ownerId) await panel?.permissionOverwrites.delete(id).catch(() => {});
    for (const id of room.accessRoles) await panel?.permissionOverwrites.delete(id).catch(() => {});
    if (c.syncPermissions !== false) {
      const v = guild.channels.cache.get(room.voiceChannelId);
      for (const id of room.accessUsers) if (id !== room.ownerId) await v?.permissionOverwrites.delete(id).catch(() => {});
      for (const id of room.accessRoles) await v?.permissionOverwrites.delete(id).catch(() => {});
    }
    room.accessUsers = new Set([room.ownerId]);
    room.accessRoles = new Set();
  } else if (action === 'delete') {
    return interaction.showModal(
      new ModalBuilder()
        .setCustomId('rn-tvc-modal:delete')
        .setTitle('Delete Temporary Room')
        .addComponents(
          new ActionRowBuilder().addComponents(
            new TextInputBuilder()
              .setCustomId('value')
              .setLabel('Type DELETE to confirm')
              .setStyle(TextInputStyle.Short)
              .setRequired(true)
              .setMaxLength(6)
          )
        )
    );
  }

  room.page = room.page || 'overview';
  return interaction.update(buildPayload(client, room));
}

async function handleSelect(interaction, client, rooms) {
  const room = roomFromPanel(interaction.channelId, rooms);
  if (!room || !canAccess(interaction, room)) {
    return interaction.reply({ content: 'You do not have access to this panel.', ephemeral: true });
  }
  const kind = interaction.customId.slice('rn-tvc:'.length);
  const value = interaction.values?.[0];
  if (!value) return interaction.reply({ content: 'Nothing was selected.', ephemeral: true });

  if (kind === 'page') {
    room.page = value;
    return interaction.update(buildPayload(client, room));
  }

  if (!canControl(interaction, room, client)) {
    return interaction.reply({ content: 'Only the room owner can use these controls.', ephemeral: true });
  }

  selections.set(key(interaction, kind), value);
  return interaction.reply({
    content: kind === 'member'
      ? 'Selected <@' + value + '>.'
      : 'Selected ' + (kind === 'access-role' ? '<@&' + value + '>' : '<@' + value + '>') + '.',
    ephemeral: true
  });
}

async function handleModal(interaction, client, rooms) {
  const room = roomFromPanel(interaction.channelId, rooms);
  if (!room || !canAccess(interaction, room)) {
    return interaction.reply({ content: 'You do not have access to this panel.', ephemeral: true });
  }
  if (!canControl(interaction, room, client)) {
    return interaction.reply({ content: 'Only the room owner can use these controls.', ephemeral: true });
  }

  const guild = interaction.guild;
  const voice = guild.channels.cache.get(room.voiceChannelId);
  const kind = interaction.customId.slice('rn-tvc-modal:'.length);
  const value = interaction.fields.getTextInputValue('value').trim();

  if (kind === 'delete') {
    if (value.toUpperCase() !== 'DELETE') {
      return interaction.reply({ content: 'Deletion cancelled. Type DELETE exactly to confirm.', ephemeral: true });
    }
    await interaction.reply({ content: 'Deleting the temporary room...', ephemeral: true });
    await deleteRoom(client, rooms, room, guild, 'Temporary VC owner deleted the room');
    return;
  }

  if (!voice) return interaction.reply({ content: 'The voice room no longer exists.', ephemeral: true });

  try {
    if (kind === 'rename') {
      const name = value.replace(/\s+/g, ' ').slice(0, 100);
      if (!name) throw new Error('Room name cannot be empty.');
      await voice.setName(name);
      await guild.channels.cache.get(room.panelChannelId)?.setName(panelSlug(client, name)).catch(() => {});
    } else if (kind === 'limit') {
      const limit = Number(value);
      if (!Number.isInteger(limit) || limit < 0 || limit > 99) throw new Error('Limit must be 0-99.');
      await voice.setUserLimit(limit);
    } else if (kind === 'bitrate') {
      const kbps = Number(value);
      const max = Math.min(Number(tempCfg(client).maxBitrate) || 384000, 384000) / 1000;
      if (!Number.isInteger(kbps) || kbps < 8 || kbps > max) throw new Error('Bitrate must be 8-' + max + ' kbps.');
      await voice.setBitrate(kbps * 1000);
    } else if (kind === 'region') {
      await voice.setRTCRegion(value.toLowerCase() === 'auto' || !value ? null : value.toLowerCase());
    } else if (kind.startsWith('tts-')) {
      room.tts = { ...(cfg(client).tts || {}), ...(room.tts || {}) };
      if (kind === 'tts-voice') room.tts.voice = value;
      if (kind === 'tts-language') room.tts.language = value;
      if (kind === 'tts-rate') { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Rate must be 0-100.'); room.tts.rate = n; }
      if (kind === 'tts-volume') { const n = Number(value); if (!Number.isFinite(n) || n < 0 || n > 100) throw new Error('Volume must be 0-100.'); room.tts.volume = n; }
    } else {
      throw new Error('Unknown panel form.');
    }

    room.page = kind.startsWith('tts-') ? 'audio' : 'room';
    await interaction.reply({ content: 'Room updated.', ephemeral: true });
    await refresh(client, room, room.page);
  } catch (e) {
    return interaction.reply({ content: 'Could not update the room: ' + (e?.message || e), ephemeral: true });
  }
}

async function channelUpdate(oldChannel, newChannel, client, rooms) {
  const room = rooms.get(newChannel.id);
  if (!room || newChannel.type !== ChannelType.GuildVoice || oldChannel.name === newChannel.name) return;
  const panel = newChannel.guild.channels.cache.get(room.panelChannelId);
  await panel?.setName(panelSlug(client, newChannel.name)).catch(() => {});
  await refresh(client, room, room.page || 'overview').catch(() => {});
}

async function recover(client, rooms) {
  const c = tempCfg(client);
  if (c.panelEnabled === false) return;
  for (const guild of client.guilds.cache.values()) {
    const channels = await guild.channels.fetch().catch(() => guild.channels.cache);
    for (const channel of channels.values()) {
      if (!channel?.isTextBased?.() || !channel.topic?.startsWith('RealmsNetwork temporary VC panel | ')) continue;
      const owner = channel.topic.match(/owner=(\d+)/)?.[1];
      const voiceId = channel.topic.match(/voice=(\d+)/)?.[1];
      if (!owner || !voiceId) continue;
      const voice = guild.channels.cache.get(voiceId) || await guild.channels.fetch(voiceId).catch(() => null);
      if (!voice || voice.type !== ChannelType.GuildVoice) {
        await channel.delete('Temporary VC voice channel missing').catch(() => {});
        continue;
      }

      const room = {
        guildId: guild.id,
        voiceChannelId: voice.id,
        panelChannelId: channel.id,
        panelMessageId: null,
        ownerId: owner,
        createdAt: channel.createdTimestamp || Date.now(),
        locked: !!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Connect),
        hidden: !!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel),
        accessUsers: new Set([owner]),
        accessRoles: new Set(),
        controlUsers: new Set([owner]),
        controlRoles: new Set(),
        bannedUsers: new Set(),
        tts: {},
        page: 'overview'
      };

      for (const [id, overwrite] of channel.permissionOverwrites.cache) {
        if (id === guild.roles.everyone.id || id === guild.members.me?.id) continue;
        if (overwrite.type === 0) room.accessRoles.add(id);
        if (overwrite.type === 1 && guild.members.cache.has(id)) room.accessUsers.add(id);
      }
      for (const [id, overwrite] of voice.permissionOverwrites.cache) {
        if (id === guild.roles.everyone.id || id === owner || overwrite.type !== 1) continue;
        if (overwrite.deny.has(PermissionFlagsBits.Connect) && !overwrite.allow.has(PermissionFlagsBits.Connect)) room.bannedUsers.add(id);
      }

      rooms.set(voice.id, room);
      await refresh(client, room, 'overview').catch(() => {});
    }
  }
}

async function cleanup(client, rooms) {
  const c = tempCfg(client);
  if (c.autoDeleteEmpty === false) return;
  for (const room of [...rooms.values()]) {
    const guild = client.guilds.cache.get(room.guildId);
    const voice = guild?.channels.cache.get(room.voiceChannelId);
    if (!guild) {
      rooms.delete(room.voiceChannelId);
      continue;
    }
    if (!voice) {
      rooms.delete(room.voiceChannelId);
      const panel = room.panelChannelId && guild.channels.cache.get(room.panelChannelId);
      await panel?.delete('Temporary VC voice channel missing').catch(() => {});
      continue;
    }
    if (voice.members.size === 0) {
      await deleteRoom(client, rooms, room, guild, 'Temporary voice room empty');
    }
  }
}

function initialize(client, rooms) {
  if (cleanupTimer) clearInterval(cleanupTimer);
  const seconds = Math.max(10, Number(tempCfg(client).cleanupIntervalSeconds || 30));
  cleanupTimer = setInterval(() => cleanup(client, rooms).catch(e =>
    console.error('[TempVC] Cleanup failed:', e?.stack || e)
  ), seconds * 1000);
  cleanupTimer.unref?.();
  client.once('ready', () => recover(client, rooms).catch(e =>
    console.error('[TempVC] Recovery failed:', e?.stack || e)
  ));
}

function destroy() {
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  selections.clear();
}

async function handle(interaction, client, rooms) {
  try {
    if (interaction.isButton?.() && interaction.customId.startsWith('rn-tvc:')) {
      return handleButton(interaction, client, rooms);
    }
    if ((interaction.isStringSelectMenu?.() || interaction.isUserSelectMenu?.() || interaction.isRoleSelectMenu?.()) &&
        interaction.customId.startsWith('rn-tvc:')) {
      return handleSelect(interaction, client, rooms);
    }
    if (interaction.isModalSubmit?.() && interaction.customId.startsWith('rn-tvc-modal:')) {
      return handleModal(interaction, client, rooms);
    }
  } catch (e) {
    console.error('[TempVC] Panel interaction failed:', e?.stack || e);
    if (!interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Panel action failed: ' + (e?.message || e), ephemeral: true }).catch(() => {});
    }
  }
}

module.exports = {
  create,
  refresh,
  deleteRoom,
  initialize,
  destroy,
  recover,
  cleanup,
  handle,
  channelUpdate,
  panelSlug
};
