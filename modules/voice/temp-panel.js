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
const tts = require('./tts-service');

let cleanupTimer = null;
const selections = new Map();

function cfg(client) { return client.modules.get('voice')?.config || {}; }
function tc(client) { return cfg(client).temporaryVoice || {}; }

function brand(client) {
  const b = client.config.branding || {};
  return {
    server: b.serverName || 'RealmsNetwork',
    color: b.embedColor || '#8b5cf6',
    footer: b.footer || b.serverName || 'RealmsNetwork'
  };
}

function panelSlug(client, name) {
  const suffix = String(tc(client).panelSuffix || '-panel');
  const raw = String(name || 'room')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^\p{L}\p{N}\s_-]+/gu, '')
    .trim()
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-');
  const base = (raw || 'room').slice(0, Math.max(1, 100 - suffix.length));
  return base + suffix;
}

function normalizeRoom(room, client) {
  room.accessUsers = room.accessUsers instanceof Set ? room.accessUsers : new Set(room.accessUsers || []);
  room.accessRoles = room.accessRoles instanceof Set ? room.accessRoles : new Set(room.accessRoles || []);
  room.bannedUsers = room.bannedUsers instanceof Set ? room.bannedUsers : new Set(room.bannedUsers || []);
  room.accessUsers.add(room.ownerId);
  room.page = room.page || 'overview';
  room.tts = tts.settingsFor(room, client);
  if (room.operatorControls === undefined) room.operatorControls = tc(client).panelAccessCanControl !== false;
  if (room.syncPermissions === undefined) room.syncPermissions = tc(client).syncPermissions !== false;
  room.ttsBrowser = room.ttsBrowser || { kind: null, page: 0 };
  return room;
}

function roomFromPanel(channelId, rooms) {
  for (const room of rooms.values()) if (room.panelChannelId === channelId) return room;
  return null;
}

function selectionKey(interaction, kind) {
  return interaction.guildId + ':' + interaction.user.id + ':' + kind;
}

function selected(interaction, kind) {
  return selections.get(selectionKey(interaction, kind));
}

function canAccess(interaction, room) {
  normalizeRoom(room, interaction.client);
  if (!interaction.member) return false;
  if (interaction.user.id === room.ownerId || room.accessUsers.has(interaction.user.id)) return true;
  return [...room.accessRoles].some(id => interaction.member.roles?.cache?.has(id));
}

function ownerOnlyAction(action) {
  return ['claim','delete','reset-access','transfer-selected'].includes(action);
}

function canControl(interaction, room, client, action) {
  if (interaction.user.id === room.ownerId) return true;
  if (ownerOnlyAction(action)) return false;
  return room.operatorControls !== false;
}

function pageMenu(page) {
  const pages = [
    ['overview','Overview','Room status and quick actions'],
    ['room','Room','Lock, name, limit, bitrate, region and chat controls'],
    ['members','Members','Kick, mute, deafen and inspect members'],
    ['moderation','Moderation','Kick and ban members from this room'],
    ['access','Access','Choose who can use this control panel'],
    ['tts','TTS','Provider, voice, language and AutoTTS'],
    ['permissions','Permissions','Panel and voice permission synchronization'],
    ['utilities','Utilities','Refresh, rebuild, invites and cleanup'],
    ['danger','Danger Zone','Reset or delete the temporary room']
  ];
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId('rn-tvc:page')
      .setPlaceholder('Navigate temporary VC control center...')
      .addOptions(pages.map(([value,label,description]) => ({
        value, label, description, default: value === page
      })))
  );
}

function button(id, label, style = ButtonStyle.Secondary, disabled = false) {
  return new ButtonBuilder()
    .setCustomId('rn-tvc:' + id)
    .setLabel(label)
    .setStyle(style)
    .setDisabled(!!disabled);
}

function status(room, voice) {
  return [
    '**Voice:** ' + (voice ? '<#' + voice.id + '>' : 'missing'),
    '**Owner:** <@' + room.ownerId + '>',
    '**Members:** ' + (voice?.members?.size || 0) + '/' + (voice?.userLimit || '∞'),
    '**Bitrate:** ' + (voice ? Math.round(voice.bitrate / 1000) + ' kbps' : 'unknown'),
    '**Region:** ' + (voice?.rtcRegion || 'Automatic'),
    '**Video quality:** ' + (voice?.videoQualityMode || 'Auto'),
    '**Chat slowmode:** ' + (voice?.rateLimitPerUser || 0) + 's',
    '**Locked:** ' + (room.locked ? 'Yes' : 'No'),
    '**Hidden:** ' + (room.hidden ? 'Yes' : 'No'),
    '**VC bans:** ' + room.bannedUsers.size,
    '**Panel users:** ' + Math.max(0, room.accessUsers.size - 1),
    '**Panel roles:** ' + room.accessRoles.size
  ].join('\n');
}

function buildPayload(client, room, extras = {}) {
  normalizeRoom(room, client);
  const guild = client.guilds.cache.get(room.guildId);
  const voice = guild?.channels.cache.get(room.voiceChannelId);
  const c = tc(client);
  const b = brand(client);
  const page = room.page || 'overview';
  const rows = [pageMenu(page)];
  let description;

  if (page === 'overview') {
    description = (c.panelDescription || 'Manage your temporary voice room.') +
      '\n\n' + status(room, voice) +
      '\n\nThis control center only affects this temporary room.';
    rows.push(
      new ActionRowBuilder().addComponents(
        button(room.locked ? 'unlock' : 'lock', room.locked ? 'Unlock Room' : 'Lock Room', room.locked ? ButtonStyle.Success : ButtonStyle.Primary),
        button(room.hidden ? 'unhide' : 'hide', room.hidden ? 'Show Room' : 'Hide Room'),
        button('rename','Rename Room',ButtonStyle.Primary,c.allowOwnerRename === false),
        button('limit','Set Limit',ButtonStyle.Primary,c.allowOwnerLimit === false),
        button('bitrate','Bitrate',ButtonStyle.Primary,c.allowOwnerBitrate === false)
      ),
      new ActionRowBuilder().addComponents(
        button('members','Members'),
        button('moderation','Moderation'),
        button('access','Access'),
        button('tts','TTS'),
        button('refresh','Refresh')
      ),
      new ActionRowBuilder().addComponents(
        button('invite','Invite',ButtonStyle.Success),
        button('sync-perms','Sync Permissions'),
        button('utilities','Utilities'),
        button('danger','Danger Zone',ButtonStyle.Danger)
      )
    );
  } else if (page === 'room') {
    description = '### Room Administration\nEdit the actual Discord voice channel and its room behavior.';
    rows.push(
      new ActionRowBuilder().addComponents(
        button('lock','Lock Room',ButtonStyle.Primary,room.locked),
        button('unlock','Unlock Room',ButtonStyle.Success,!room.locked),
        button('hide','Hide Room',ButtonStyle.Secondary,room.hidden),
        button('unhide','Show Room',ButtonStyle.Secondary,!room.hidden),
        button('rename','Rename Room',ButtonStyle.Primary,c.allowOwnerRename === false)
      ),
      new ActionRowBuilder().addComponents(
        button('limit','User Limit',ButtonStyle.Primary,c.allowOwnerLimit === false),
        button('bitrate','Bitrate',ButtonStyle.Primary,c.allowOwnerBitrate === false),
        button('region','Voice Region'),
        button('quality','Video Quality'),
        button('slowmode','Chat Slowmode')
      ),
      new ActionRowBuilder().addComponents(
        button('invite','Create Invite',ButtonStyle.Success),
        button('reset-room','Reset Room'),
        button('refresh','Refresh')
      )
    );
  } else if (page === 'members') {
    description = '### Member Control\nSelect a member with the menu. Moderation applies to people in this room.';
    rows.push(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('rn-tvc:member')
          .setPlaceholder('Select a member...')
          .setMinValues(1).setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button('kick','Kick',ButtonStyle.Danger,c.allowOwnerKick === false),
        button('mute','Mute',ButtonStyle.Secondary,c.allowOwnerMute === false),
        button('unmute','Unmute',ButtonStyle.Success,c.allowOwnerMute === false),
        button('deafen','Deafen',ButtonStyle.Secondary,c.allowOwnerDeafen === false),
        button('undeafen','Undeafen',ButtonStyle.Success,c.allowOwnerDeafen === false)
      ),
      new ActionRowBuilder().addComponents(
        button('ban','Ban From VC',ButtonStyle.Danger),
        button('unban','Unban From VC',ButtonStyle.Success),
        button('panel-selected','Grant Panel',ButtonStyle.Primary),
        button('revoke-panel-selected','Remove Panel',ButtonStyle.Danger),
        button('transfer-selected','Transfer Owner',ButtonStyle.Success,c.allowOwnerTransfer === false)
      )
    );
  } else if (page === 'moderation') {
    description = '### Voice Room Moderation\nKick disconnects once. Ban blocks Connect until the owner unbans the member.';
    rows.push(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder()
          .setCustomId('rn-tvc:member')
          .setPlaceholder('Select a target...')
          .setMinValues(1).setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button('kick','Kick',ButtonStyle.Danger,c.allowOwnerKick === false),
        button('ban','Ban From VC',ButtonStyle.Danger),
        button('unban','Unban From VC',ButtonStyle.Success),
        button('mute','Mute',ButtonStyle.Secondary,c.allowOwnerMute === false),
        button('deafen','Deafen',ButtonStyle.Secondary,c.allowOwnerDeafen === false)
      ),
      new ActionRowBuilder().addComponents(
        button('unmute','Unmute',ButtonStyle.Success,c.allowOwnerMute === false),
        button('undeafen','Undeafen',ButtonStyle.Success,c.allowOwnerDeafen === false),
        button('panel-selected','Grant Panel',ButtonStyle.Primary),
        button('revoke-panel-selected','Remove Panel',ButtonStyle.Danger),
        button('refresh','Refresh')
      )
    );
  } else if (page === 'access') {
    const users = [...room.accessUsers].filter(id => id !== room.ownerId).map(id => '<@' + id + '>').join(', ') || 'None';
    const roles = [...room.accessRoles].map(id => '<@&' + id + '>').join(', ') || 'None';
    description = '### Panel Access\n**Users:** ' + users + '\n**Roles:** ' + roles +
      '\n\nOwner chooses who can open the panel. Operators can control non-dangerous features when panelAccessCanControl is enabled.';
    rows.push(
      new ActionRowBuilder().addComponents(
        new UserSelectMenuBuilder().setCustomId('rn-tvc:access-user').setPlaceholder('Select a user...').setMinValues(1).setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button('grant-user','Grant User',ButtonStyle.Success),
        button('revoke-user','Remove User',ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        new RoleSelectMenuBuilder().setCustomId('rn-tvc:access-role').setPlaceholder('Select a role...').setMinValues(1).setMaxValues(1)
      ),
      new ActionRowBuilder().addComponents(
        button('grant-role','Grant Role',ButtonStyle.Success),
        button('revoke-role','Remove Role',ButtonStyle.Danger)
      )
    );
  } else if (page === 'tts') {
    const s = room.tts;
    description = [
      '### Text To Speech',
      '**Enabled:** ' + (s.enabled ? 'Yes' : 'No'),
      '**Auto TTS:** ' + (s.autoTts ? 'Enabled' : 'Disabled'),
      '**Provider:** ' + s.provider,
      '**Language:** ' + s.lang,
      '**Voice:** ' + s.voice,
      '**Rate:** ' + s.rate + '%',
      '**Volume:** ' + s.volume + '%',
      '**Name prefix:** ' + (s.prefixName ? 'Enabled' : 'Disabled'),
      '',
      'Voice and language catalogs are pulled dynamically from their APIs.'
    ].join('\n');
    rows.push(
      new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId('rn-tvc:tts-provider')
          .setPlaceholder('Choose TTS provider')
          .addOptions(
            { label:'Microsoft Edge', value:'edge', description:'Natural neural voices', default:s.provider === 'edge' },
            { label:'Google', value:'google', description:'Google Translate TTS', default:s.provider === 'google' },
            { label:'StreamElements / Polly', value:'polly', description:'Polly-compatible endpoint', default:s.provider === 'polly' }
          )
      ),
      new ActionRowBuilder().addComponents(
        button(s.enabled ? 'tts-disable' : 'tts-enable',s.enabled ? 'Disable TTS' : 'Enable TTS',s.enabled ? ButtonStyle.Danger : ButtonStyle.Success),
        button(s.autoTts ? 'autotts-disable' : 'autotts-enable',s.autoTts ? 'Disable AutoTTS' : 'Enable AutoTTS',s.autoTts ? ButtonStyle.Danger : ButtonStyle.Success),
        button(s.prefixName ? 'prefix-disable' : 'prefix-enable',s.prefixName ? 'No Name Prefix' : 'Add Name Prefix'),
        button('speak','Speak',ButtonStyle.Primary),
        button('tts-stop','Stop',ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        button('tts-voices','Browse Voices',ButtonStyle.Primary),
        button('tts-languages','Browse Languages',ButtonStyle.Primary),
        button('tts-voice-manual','Set Voice',ButtonStyle.Primary),
        button('rate-down','Rate -'),
        button('rate-up','Rate +')
      ),
      new ActionRowBuilder().addComponents(
        button('volume','Volume'),
        button('room-chat','Room Chat'),
        button('refresh','Refresh')
      )
    );
  } else if (page === 'tts-voices') {
    const list = extras.voices || [];
    const p = extras.pageNum || 0;
    const total = Math.max(1,Math.ceil(list.length/25));
    const items = list.slice(p*25,p*25+25);
    description = '### Edge Voice Browser\nPage ' + (p+1) + ' of ' + total + ' • ' + list.length + ' API voices';
    const select = new StringSelectMenuBuilder().setCustomId('rn-tvc:tts-voice').setPlaceholder('Choose an Edge voice...');
    const options = items.map(v => ({
      label:String(v.FriendlyName || v.ShortName || v.Name || 'Voice').slice(0,100),
      value:String(v.ShortName || v.Name).slice(0,100),
      description:String((v.Locale || '') + ' • ' + (v.Gender || '')).slice(0,100)
    }));
    if(options.length) select.addOptions(options);
    rows.push(new ActionRowBuilder().addComponents(select));
    rows.push(new ActionRowBuilder().addComponents(
      button('voice-first','First',ButtonStyle.Secondary,p===0),
      button('voice-prev','Prev',ButtonStyle.Primary,p===0),
      button('voice-next','Next',ButtonStyle.Primary,p>=total-1),
      button('voice-last','Last',ButtonStyle.Secondary,p>=total-1),
      button('tts','Back')
    ));
  } else if (page === 'tts-languages') {
    const list = extras.languages || [];
    const p = extras.pageNum || 0;
    const total = Math.max(1,Math.ceil(list.length/25));
    const items = list.slice(p*25,p*25+25);
    description = '### Language Browser\nPage ' + (p+1) + ' of ' + total + ' • ' + list.length + ' API languages';
    const select = new StringSelectMenuBuilder().setCustomId('rn-tvc:tts-language').setPlaceholder('Choose a Google language...');
    const options = items.map(x => ({
      label:String(x.name).slice(0,100),
      value:String(x.code).slice(0,100),
      description:String(x.code).slice(0,100)
    }));
    if(options.length) select.addOptions(options);
    if(options.length) rows.push(new ActionRowBuilder().addComponents(select));
    rows.push(new ActionRowBuilder().addComponents(
      button('lang-first','First',ButtonStyle.Secondary,p===0),
      button('lang-prev','Prev',ButtonStyle.Primary,p===0),
      button('lang-next','Next',ButtonStyle.Primary,p>=total-1),
      button('lang-last','Last',ButtonStyle.Secondary,p>=total-1),
      button('tts','Back')
    ));
  } else if (page === 'permissions') {
    description = [
      '### Permission Management',
      '**Panel users:** ' + Math.max(0,room.accessUsers.size-1),
      '**Panel roles:** ' + room.accessRoles.size,
      '**Sync to VC:** ' + (room.syncPermissions !== false ? 'Enabled' : 'Disabled'),
      '**Operator controls:** ' + (room.operatorControls !== false ? 'Enabled' : 'Disabled'),
      '',
      'Owner-only actions stay protected.'
    ].join('\n');
    rows.push(new ActionRowBuilder().addComponents(
      button('sync-perms','Sync Panel → VC',ButtonStyle.Primary),
      button('toggle-sync',c.syncPermissions === false ? 'Enable Sync' : 'Disable Sync'),
      button('toggle-operators',c.panelAccessCanControl === false ? 'Enable Operators' : 'Disable Operators'),
      button('access','Manage Access'),
      button('refresh','Refresh')
    ));
  } else if (page === 'utilities') {
    description = '### Utilities\nRoom maintenance and helper actions.';
    rows.push(
      new ActionRowBuilder().addComponents(
        button('refresh','Refresh'),
        button('rebuild','Rebuild Panel',ButtonStyle.Primary),
        button('invite','Create Invite',ButtonStyle.Success),
        button('sync-perms','Sync Permissions'),
        button('tts-stop','Stop TTS',ButtonStyle.Danger)
      ),
      new ActionRowBuilder().addComponents(
        button('disconnect-bot','Disconnect Bot',ButtonStyle.Danger),
        button('room-chat','Open Room Chat'),
        button('tts','TTS'),
        button('overview','Overview')
      )
    );
  } else {
    description = '### Danger Zone\nReset Access clears custom panel access, roles and VC bans. Delete Room destroys both temporary channels.';
    rows.push(new ActionRowBuilder().addComponents(
      button('reset-access','Reset Access',ButtonStyle.Danger),
      button('delete','Delete Room',ButtonStyle.Danger),
      button('refresh','Refresh')
    ));
  }

  return {
    embeds:[new EmbedBuilder()
      .setColor(b.color)
      .setTitle(b.server + ' • ' + (c.panelTitle || 'Voice Control Center'))
      .setDescription(description)
      .setFooter({text:b.footer + ' • temporary VC • ' + page})
      .setTimestamp()],
    components:rows.slice(0,5)
  };
}

async function refresh(client, room, page = room.page || 'overview') {
  normalizeRoom(room,client);
  room.page=page;
  const guild=client.guilds.cache.get(room.guildId);
  const panel=guild?.channels.cache.get(room.panelChannelId);
  if(!panel?.isTextBased())return null;

  const extras={};
  if(page==='tts-voices'){
    extras.voices=await tts.listVoices().catch(e=>{console.error('[TempVC/TTS] Voices:',e?.message||e);return[];});
    extras.pageNum=room.ttsBrowser?.page||0;
    room.ttsBrowser={kind:'voices',page:extras.pageNum};
  } else if(page==='tts-languages'){
    extras.languages=await tts.listLanguages().catch(e=>{console.error('[TempVC/TTS] Languages:',e?.message||e);return[];});
    extras.pageNum=room.ttsBrowser?.page||0;
    room.ttsBrowser={kind:'languages',page:extras.pageNum};
  }

  const p=buildPayload(client,room,extras);
  if(room.panelMessageId){
    try{
      const msg=await panel.messages.fetch(room.panelMessageId);
      await msg.edit(p);
      return msg;
    }catch{}
  }
  const msg=await panel.send(p);
  room.panelMessageId=msg.id;
  return msg;
}

function panelOverwrites(guild,ownerId){
  return [
    {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
    {id:ownerId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory],deny:[PermissionFlagsBits.SendMessages]},
    {id:guild.members.me?.id || guild.client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages]}
  ];
}

async function create(client,member,voice,room){
  const c=tc(client);
  if(c.panelEnabled===false)return null;
  const guild=member.guild;
  const panel=await guild.channels.create({
    name:panelSlug(client,voice.name),
    type:ChannelType.GuildText,
    parent:c.categoryId || voice.parentId || undefined,
    topic:'RealmsNetwork temporary VC panel | owner='+member.id+' | voice='+voice.id,
    permissionOverwrites:panelOverwrites(guild,member.id),
    reason:'Create temporary voice room control panel'
  });
  room.panelChannelId=panel.id;
  room.accessUsers=new Set([room.ownerId]);
  room.accessRoles=new Set();
  room.bannedUsers=room.bannedUsers instanceof Set?room.bannedUsers:new Set();
  const msg=await refresh(client,room,'overview');
  if(c.panelAutoPin!==false&&msg)await msg.pin().catch(()=>{});
  return panel;
}

async function deleteRoom(client,rooms,room,guild,reason='Temporary voice room deleted'){
  if(!room)return;
  rooms.delete(room.voiceChannelId);
  tts.stop(room);
  room.ttsConnection?.destroy?.();
  const panel=room.panelChannelId&&guild.channels.cache.get(room.panelChannelId);
  const voice=guild.channels.cache.get(room.voiceChannelId);
  await panel?.delete(reason).catch(()=>{});
  if(voice&&voice.members.size){
    for(const member of voice.members.values())if(!member.user.bot)await member.voice.disconnect(reason).catch(()=>{});
  }
  await voice?.delete(reason).catch(()=>{});
}

async function syncPermissions(room,guild,client){
  normalizeRoom(room,client);
  const voice=guild.channels.cache.get(room.voiceChannelId);
  const panel=guild.channels.cache.get(room.panelChannelId);
  if(!voice||!panel)return;
  for(const id of room.accessUsers){
    if(room.bannedUsers.has(id))continue;
    await panel.permissionOverwrites.edit(id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
    await voice.permissionOverwrites.edit(id,{ViewChannel:true,Connect:true,Speak:true}).catch(()=>{});
  }
  for(const id of room.accessRoles){
    await panel.permissionOverwrites.edit(id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
    await voice.permissionOverwrites.edit(id,{ViewChannel:true,Connect:true,Speak:true}).catch(()=>{});
  }
  for(const id of room.bannedUsers)await voice.permissionOverwrites.edit(id,{ViewChannel:false,Connect:false}).catch(()=>{});
}

async function grant(room,guild,id,type,client){
  normalizeRoom(room,client);
  if(room.bannedUsers.has(id))throw new Error('Unban that member before granting access.');
  if(type==='role'){
    const role=guild.roles.cache.get(id);
    if(!role||role.managed||id===guild.roles.everyone.id)throw new Error('That role cannot be granted.');
    if(tc(client).panelAllowRoleAccess===false)throw new Error('Role access is disabled.');
    room.accessRoles.add(id);
  }else{
    const member=guild.members.cache.get(id)||await guild.members.fetch(id).catch(()=>null);
    if(!member||member.user.bot)throw new Error('That user cannot be granted.');
    if(tc(client).panelAllowUserAccess===false)throw new Error('User access is disabled.');
    room.accessUsers.add(id);
  }
  await syncPermissions(room,guild,client);
}

async function revoke(room,guild,id,type,client){
  normalizeRoom(room,client);
  if(id===room.ownerId)throw new Error('The owner cannot be removed from panel access.');
  if(type==='role')room.accessRoles.delete(id);else room.accessUsers.delete(id);
  await guild.channels.cache.get(room.panelChannelId)?.permissionOverwrites.delete(id).catch(()=>{});
  if(room.syncPermissions!==false)await guild.channels.cache.get(room.voiceChannelId)?.permissionOverwrites.delete(id).catch(()=>{});
}

async function showForm(interaction,kind){
  const titles={rename:'Rename Room',limit:'User Limit',bitrate:'Voice Bitrate',region:'Voice Region',slowmode:'Chat Slowmode',rate:'TTS Rate',volume:'TTS Volume',speak:'Speak With TTS','tts-voice-manual':'Set TTS Voice'};
  const labels={rename:'New room name',limit:'0 = unlimited, 1-99 = limit',bitrate:'Bitrate in kbps',region:'Discord RTC region, blank = automatic',slowmode:'Slowmode seconds, 0-21600',rate:'Speech rate, 50-150',volume:'TTS volume, 0-150',speak:'Text to speak','tts-voice-manual':'Edge or Polly voice name'};
  const max={rename:100,limit:3,bitrate:5,region:32,slowmode:5,rate:3,volume:3,speak:500,'tts-voice-manual':100}[kind]||100;
  const modal=new ModalBuilder().setCustomId('rn-tvc-modal:'+kind).setTitle(titles[kind]||'Temporary VC');
  modal.addComponents(new ActionRowBuilder().addComponents(
    new TextInputBuilder().setCustomId('value').setLabel(labels[kind]||'Value').setStyle(kind==='speak'?TextInputStyle.Paragraph:TextInputStyle.Short).setRequired(kind!=='region').setMaxLength(max)
  ));
  return interaction.showModal(modal);
}

async function getMember(interaction){
  const id=selected(interaction,'member');
  if(!id)return null;
  return interaction.guild.members.cache.get(id)||await interaction.guild.members.fetch(id).catch(()=>null);
}

async function handleButton(interaction,client,rooms){
  const room=roomFromPanel(interaction.channelId,rooms);
  if(!room||!canAccess(interaction,room))return interaction.reply({content:'You do not have access to this panel.',ephemeral:true});
  normalizeRoom(room,client);
  const action=interaction.customId.slice('rn-tvc:'.length);
  if(!canControl(interaction,room,client,action))return interaction.reply({content:'Only the room owner can use that control.',ephemeral:true});

  if(['overview','room','members','moderation','access','tts','permissions','utilities','danger'].includes(action))return interaction.update(await refresh(client,room,action));
  if(action==='refresh')return interaction.update(await refresh(client,room,room.page));
  if(action==='tts-voices'||action==='tts-languages'){
    room.ttsBrowser={kind:action==='tts-voices'?'voices':'languages',page:0};
    return interaction.update(await refresh(client,room,action));
  }
  if(action.startsWith('voice-')||action.startsWith('lang-')){
    const kind=action.startsWith('voice-')?'voices':'languages';
    const prefix=kind==='voices'?'voice-':'lang-';
    const list=kind==='voices'?await tts.listVoices().catch(()=>[]):await tts.listLanguages().catch(()=>[]);
    const pages=Math.max(1,Math.ceil(list.length/25));
    let p=room.ttsBrowser?.page||0;
    if(action===prefix+'first')p=0;
    else if(action===prefix+'prev')p=Math.max(0,p-1);
    else if(action===prefix+'next')p=Math.min(pages-1,p+1);
    else if(action===prefix+'last')p=pages-1;
    room.ttsBrowser={kind,page:p};
    return interaction.update(await refresh(client,room,kind==='voices'?'tts-voices':'tts-languages'));
  }

  const guild=interaction.guild;
  const voice=guild.channels.cache.get(room.voiceChannelId);
  const c=tc(client);
  const member=await getMember(interaction);

  if(['rename','limit','bitrate','region','slowmode','rate','volume','speak','tts-voice-manual'].includes(action))return showForm(interaction,action);
  if(!voice&&action!=='delete')return interaction.reply({content:'The voice room no longer exists.',ephemeral:true});

  if(action==='lock'){room.locked=true;await voice.permissionOverwrites.edit(guild.roles.everyone,{Connect:false});}
  else if(action==='unlock'){room.locked=false;await voice.permissionOverwrites.edit(guild.roles.everyone,{Connect:true});}
  else if(action==='hide'){room.hidden=true;await voice.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:false});}
  else if(action==='unhide'){room.hidden=false;await voice.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:true});}
  else if(action==='reset-room'){room.locked=false;room.hidden=false;await voice.permissionOverwrites.edit(guild.roles.everyone,{Connect:true,ViewChannel:true});await voice.setUserLimit(0);await voice.setBitrate(Math.min(64000,Number(c.maxBitrate)||384000)).catch(()=>{});}
  else if(action==='quality'){
    const cur=String(voice.videoQualityMode||'auto').toLowerCase();
    const next=cur==='auto'?'full':'auto';
    await voice.setVideoQualityMode(next);
  }
  else if(action==='invite'){
    const invite=await voice.createInvite({maxAge:86400,maxUses:0,unique:true,reason:'Temporary VC invite'});
    return interaction.reply({content:'Invite created: '+invite.url,ephemeral:true});
  }
  else if(action==='kick'){
    if(!member||member.id===interaction.user.id)return interaction.reply({content:'Select another member first.',ephemeral:true});
    await member.voice.disconnect('Temporary VC kick');
  }
  else if(action==='ban'){
    if(!member||member.id===interaction.user.id)return interaction.reply({content:'Select another member first.',ephemeral:true});
    room.bannedUsers.add(member.id);
    room.accessUsers.delete(member.id);
    await voice.permissionOverwrites.edit(member.id,{ViewChannel:false,Connect:false});
    await guild.channels.cache.get(room.panelChannelId)?.permissionOverwrites.delete(member.id).catch(()=>{});
    await member.voice.disconnect('Banned from temporary VC').catch(()=>{});
  }
  else if(action==='unban'){
    if(!member)return interaction.reply({content:'Select a member first.',ephemeral:true});
    room.bannedUsers.delete(member.id);
    await voice.permissionOverwrites.delete(member.id).catch(()=>{});
  }
  else if(action==='mute'||action==='unmute'){
    if(!member||member.id===interaction.user.id)return interaction.reply({content:'Select another member first.',ephemeral:true});
    await member.voice.setMute(action==='mute','Temporary VC moderation');
  }
  else if(action==='deafen'||action==='undeafen'){
    if(!member||member.id===interaction.user.id)return interaction.reply({content:'Select another member first.',ephemeral:true});
    await member.voice.setDeaf(action==='deafen','Temporary VC moderation');
  }
  else if(action==='transfer-selected'){
    if(!member)return interaction.reply({content:'Select a member first.',ephemeral:true});
    if(room.bannedUsers.has(member.id))return interaction.reply({content:'That member is banned from the room.',ephemeral:true});
    room.ownerId=member.id;room.accessUsers.add(member.id);room.operatorControls=room.operatorControls!==false;
    await voice.permissionOverwrites.edit(member.id,{ViewChannel:true,Connect:true,Speak:true});
    await guild.channels.cache.get(room.panelChannelId)?.permissionOverwrites.edit(member.id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false});
  }
  else if(action==='panel-selected'){
    if(!member)return interaction.reply({content:'Select a member first.',ephemeral:true});
    await grant(room,guild,member.id,'user',client);
  }
  else if(action==='revoke-panel-selected'){
    if(!member)return interaction.reply({content:'Select a member first.',ephemeral:true});
    await revoke(room,guild,member.id,'user',client);
  }
  else if(action==='grant-user'){const id=selected(interaction,'access-user');if(!id)return interaction.reply({content:'Select a user first.',ephemeral:true});await grant(room,guild,id,'user',client);}
  else if(action==='revoke-user'){const id=selected(interaction,'access-user');if(!id)return interaction.reply({content:'Select a user first.',ephemeral:true});await revoke(room,guild,id,'user',client);}
  else if(action==='grant-role'){const id=selected(interaction,'access-role');if(!id)return interaction.reply({content:'Select a role first.',ephemeral:true});await grant(room,guild,id,'role',client);}
  else if(action==='revoke-role'){const id=selected(interaction,'access-role');if(!id)return interaction.reply({content:'Select a role first.',ephemeral:true});await revoke(room,guild,id,'role',client);}
  else if(action==='reset-access'){
    room.accessUsers=new Set([room.ownerId]);room.accessRoles=new Set();room.bannedUsers=new Set();
    for(const id of [...voice.permissionOverwrites.cache.keys()])if(id!==guild.roles.everyone.id&&id!==guild.members.me?.id&&id!==room.ownerId)await voice.permissionOverwrites.delete(id).catch(()=>{});
    const panel=guild.channels.cache.get(room.panelChannelId);
    for(const id of [...(panel?.permissionOverwrites?.cache?.keys()||[])])if(id!==guild.roles.everyone.id&&id!==guild.members.me?.id&&id!==room.ownerId)await panel.permissionOverwrites.delete(id).catch(()=>{});
  }
  else if(action==='sync-perms')await syncPermissions(room,guild,client);
  else if(action==='toggle-sync')room.syncPermissions=room.syncPermissions===false;
  else if(action==='toggle-operators')room.operatorControls=room.operatorControls===false;
  else if(action==='rebuild'){room.panelMessageId=null;await refresh(client,room,room.page);return;}
  else if(action==='disconnect-bot'){client.voiceSessions?.get(guild.id)?.connection?.destroy?.();room.ttsConnection?.destroy?.();}
  else if(action==='room-chat')return interaction.reply({content:'Open <#'+room.voiceChannelId+'> to use Discord voice-channel chat and AutoTTS.',ephemeral:true});
  else if(action==='tts-enable')room.tts.enabled=true;
  else if(action==='tts-disable')room.tts.enabled=false;
  else if(action==='autotts-enable')room.tts.autoTts=true;
  else if(action==='autotts-disable')room.tts.autoTts=false;
  else if(action==='prefix-enable')room.tts.prefixName=true;
  else if(action==='prefix-disable')room.tts.prefixName=false;
  else if(action==='tts-stop')tts.stop(room);
  else if(action==='speak')return showForm(interaction,'speak');
  else if(action==='rate-down')room.tts.rate=Math.max(50,(Number(room.tts.rate)||100)-10);
  else if(action==='rate-up')room.tts.rate=Math.min(150,(Number(room.tts.rate)||100)+10);
  else if(action==='volume')return showForm(interaction,'volume');
  else if(action==='delete'){
    return interaction.showModal(new ModalBuilder().setCustomId('rn-tvc-modal:delete').setTitle('Delete Temporary Room').addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Type DELETE to confirm').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6))
    ));
  }
  return interaction.update(await refresh(client,room,room.page));
}

async function handleSelect(interaction,client,rooms){
  const room=roomFromPanel(interaction.channelId,rooms);
  if(!room||!canAccess(interaction,room))return interaction.reply({content:'You do not have access to this panel.',ephemeral:true});
  normalizeRoom(room,client);
  const kind=interaction.customId.slice('rn-tvc:'.length);
  const value=interaction.values?.[0];
  if(!value)return interaction.reply({content:'Nothing was selected.',ephemeral:true});
  if(kind==='page')return interaction.update(await refresh(client,room,value));
  if(!canControl(interaction,room,client,kind))return interaction.reply({content:'Only the room owner can use that selection.',ephemeral:true});
  if(kind==='tts-provider'){room.tts.provider=value;return interaction.update(await refresh(client,room,'tts'));}
  if(kind==='tts-voice'){
    const voices=await tts.listVoices().catch(()=>[]);
    const match=voices.find(v=>(v.ShortName||v.Name)===value);
    if(!match)return interaction.reply({content:'That voice is no longer available. Refresh and try again.',ephemeral:true});
    room.tts.voice=value;room.tts.lang=match.Locale||room.tts.lang;
    return interaction.update(await refresh(client,room,'tts'));
  }
  if(kind==='tts-language'){room.tts.lang=value;return interaction.update(await refresh(client,room,'tts'));}
  if(kind==='member'||kind==='access-user'||kind==='access-role'){
    selections.set(selectionKey(interaction,kind),value);
    return interaction.reply({content:kind==='member'?'Selected <@'+value+'>.':'Selected '+(kind==='access-role'?'<@&'+value+'>':'<@'+value+'>')+'.',ephemeral:true});
  }
  return interaction.reply({content:'Unknown panel selection.',ephemeral:true});
}

async function handleModal(interaction,client,rooms){
  const room=roomFromPanel(interaction.channelId,rooms);
  if(!room||!canAccess(interaction,room))return interaction.reply({content:'You do not have access to this panel.',ephemeral:true});
  const kind=interaction.customId.slice('rn-tvc-modal:'.length);
  if(kind!=='delete'&&!canControl(interaction,room,client,kind))return interaction.reply({content:'Only the room owner can use that control.',ephemeral:true});
  const value=interaction.fields.getTextInputValue('value').trim();
  const guild=interaction.guild;
  const voice=guild.channels.cache.get(room.voiceChannelId);
  if(kind==='delete'){
    if(value.toUpperCase()!=='DELETE')return interaction.reply({content:'Deletion cancelled. Type DELETE exactly to confirm.',ephemeral:true});
    await interaction.reply({content:'Deleting the temporary room...',ephemeral:true});
    return deleteRoom(client,rooms,room,guild,'Temporary VC owner deleted the room');
  }
  if(!voice)return interaction.reply({content:'The voice room no longer exists.',ephemeral:true});
  try{
    if(kind==='rename'){
      const name=value.replace(/\s+/g,' ').slice(0,100);if(!name)throw new Error('Room name cannot be empty.');
      await voice.setName(name);await guild.channels.cache.get(room.panelChannelId)?.setName(panelSlug(client,name)).catch(()=>{});
    }else if(kind==='limit'){
      const n=Number(value);if(!Number.isInteger(n)||n<0||n>99)throw new Error('Limit must be 0-99.');await voice.setUserLimit(n);
    }else if(kind==='bitrate'){
      const n=Number(value);const max=Math.min(Number(tc(client).maxBitrate)||384000,384000)/1000;if(!Number.isInteger(n)||n<8||n>max)throw new Error('Bitrate must be 8-'+max+' kbps.');await voice.setBitrate(n*1000);
    }else if(kind==='region'){
      if(value&&!/^[a-z0-9-]+$/i.test(value))throw new Error('Invalid RTC region.');await voice.setRTCRegion(value||null);
    }else if(kind==='slowmode'){
      const n=Number(value);if(!Number.isInteger(n)||n<0||n>21600)throw new Error('Slowmode must be 0-21600 seconds.');await voice.setRateLimitPerUser(n);
    }else if(kind==='rate'){
      const n=Number(value);if(!Number.isInteger(n)||n<50||n>150)throw new Error('TTS rate must be 50-150.');room.tts.rate=n;
    }else if(kind==='volume'){
      const n=Number(value);if(!Number.isInteger(n)||n<0||n>150)throw new Error('TTS volume must be 0-150.');room.tts.volume=n;
    }else if(kind==='speak'){
      await tts.speak(client,room,value,interaction.member);
    }else if(kind==='tts-voice-manual'){
      room.tts.voice=value;
    }else throw new Error('Unknown panel form.');
    room.page=kind==='speak'?'tts':'room';
    await interaction.reply({content:'Updated.',ephemeral:true});
    await refresh(client,room,room.page);
  }catch(e){return interaction.reply({content:'Could not update: '+(e?.message||e),ephemeral:true});}
}

async function handle(interaction,client,rooms){
  try{
    if(interaction.isButton?.()&&interaction.customId.startsWith('rn-tvc:'))return handleButton(interaction,client,rooms);
    if((interaction.isStringSelectMenu?.()||interaction.isUserSelectMenu?.()||interaction.isRoleSelectMenu?.())&&interaction.customId.startsWith('rn-tvc:'))return handleSelect(interaction,client,rooms);
    if(interaction.isModalSubmit?.()&&interaction.customId.startsWith('rn-tvc-modal:'))return handleModal(interaction,client,rooms);
  }catch(e){
    console.error('[TempVC/Panel]',e?.stack||e);
    if(!interaction.replied&&!interaction.deferred)await interaction.reply({content:'Panel action failed: '+(e?.message||e),ephemeral:true}).catch(()=>{});
  }
}

async function recover(client,rooms){
  if(tc(client).panelEnabled===false)return;
  for(const guild of client.guilds.cache.values()){
    const channels=await guild.channels.fetch().catch(()=>guild.channels.cache);
    for(const channel of channels.values()){
      if(!channel?.isTextBased?.()||!channel.topic?.startsWith('RealmsNetwork temporary VC panel | '))continue;
      const owner=channel.topic.match(/owner=(\d+)/)?.[1];
      const voiceId=channel.topic.match(/voice=(\d+)/)?.[1];
      if(!owner||!voiceId)continue;
      const voice=guild.channels.cache.get(voiceId)||await guild.channels.fetch(voiceId).catch(()=>null);
      if(!voice||voice.type!==ChannelType.GuildVoice){await channel.delete('Temporary VC voice channel missing').catch(()=>{});continue;}
      const room={
        guildId:guild.id,voiceChannelId:voice.id,panelChannelId:channel.id,panelMessageId:null,
        ownerId:owner,createdAt:channel.createdTimestamp||Date.now(),
        locked:!!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Connect),
        hidden:!!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel),
        accessUsers:new Set([owner]),accessRoles:new Set(),bannedUsers:new Set(),page:'overview',operatorControls:tc(client).panelAccessCanControl !== false,syncPermissions:tc(client).syncPermissions !== false,ttsBrowser:{kind:null,page:0}
      };
      for(const [id,ow] of channel.permissionOverwrites.cache){
        if(id===guild.roles.everyone.id||id===guild.members.me?.id)continue;
        if(ow.type===0&&ow.allow.has(PermissionFlagsBits.ViewChannel))room.accessRoles.add(id);
        if(ow.type===1&&ow.allow.has(PermissionFlagsBits.ViewChannel))room.accessUsers.add(id);
      }
      for(const [id,ow] of voice.permissionOverwrites.cache){
        if(id===guild.roles.everyone.id||id===guild.members.me?.id||id===owner)continue;
        if(ow.type===1&&ow.deny.has(PermissionFlagsBits.Connect))room.bannedUsers.add(id);
      }
      rooms.set(voice.id,room);
      await refresh(client,room,'overview').catch(()=>{});
    }
  }
}

async function cleanup(client,rooms){
  if(tc(client).autoDeleteEmpty===false)return;
  for(const room of [...rooms.values()]){
    const guild=client.guilds.cache.get(room.guildId);
    if(!guild){rooms.delete(room.voiceChannelId);continue;}
    const voice=guild.channels.cache.get(room.voiceChannelId);
    if(!voice){
      rooms.delete(room.voiceChannelId);
      const panel=room.panelChannelId&&guild.channels.cache.get(room.panelChannelId);
      await panel?.delete('Temporary VC voice channel missing').catch(()=>{});
      continue;
    }
    if(voice.members.size===0)await deleteRoom(client,rooms,room,guild,'Temporary voice room empty');
  }
}

function initialize(client,rooms){
  if(cleanupTimer)clearInterval(cleanupTimer);
  cleanupTimer=setInterval(()=>cleanup(client,rooms).catch(e=>console.error('[TempVC] Cleanup:',e?.stack||e)),Math.max(10,Number(tc(client).cleanupIntervalSeconds||30))*1000);
  cleanupTimer.unref?.();
  client.once('ready',()=>recover(client,rooms).catch(e=>console.error('[TempVC] Recovery:',e?.stack||e)));
}

function destroy(){
  if(cleanupTimer)clearInterval(cleanupTimer);
  cleanupTimer=null;
  selections.clear();
}

module.exports={create,refresh,deleteRoom,initialize,destroy,recover,cleanup,handle,panelSlug,syncPermissions,normalizeRoom};
