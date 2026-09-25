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
const {
  joinVoiceChannel,
  createAudioPlayer,
  createAudioResource,
  entersState,
  VoiceConnectionStatus
} = require('@discordjs/voice');
const fs = require('node:fs');
const path = require('node:path');
const ttsService = require('./tts-service');

const selections = new Map();
let cleanupTimer = null;
let voiceCache = { at: 0, voices: [] };

function cfg(client) { return client.modules.get('voice')?.config || {}; }
function tv(client) { return cfg(client).temporaryVoice || {}; }
function brand(client) {
  const b = client.config.branding || {};
  return {
    server: b.serverName || 'RealmsNetwork',
    color: b.embedColor || '#8b5cf6',
    footer: b.footer || b.serverName || 'RealmsNetwork'
  };
}
function normalize(room) {
  room.accessUsers = room.accessUsers instanceof Set ? room.accessUsers : new Set(room.accessUsers || []);
  room.accessRoles = room.accessRoles instanceof Set ? room.accessRoles : new Set(room.accessRoles || []);
  room.bannedUsers = room.bannedUsers instanceof Set ? room.bannedUsers : new Set(room.bannedUsers || []);
  room.accessUsers.add(room.ownerId);
  room.page = room.page || 'overview';
  room.tts = {
    enabled: room.tts?.enabled !== false,
    voice: room.tts?.voice || tvDefaults().voice,
    lang: room.tts?.lang || tvDefaults().lang,
    rate: Number.isFinite(Number(room.tts?.rate)) ? Number(room.tts.rate) : tvDefaults().rate,
    volume: Number.isFinite(Number(room.tts?.volume)) ? Number(room.tts.volume) : tvDefaults().volume,
    maxCharacters: Number.isFinite(Number(room.tts?.maxCharacters)) ? Number(room.tts.maxCharacters) : tvDefaults().maxCharacters,
    languageFilter: room.tts?.languageFilter || 'all',
    voicePage: Math.max(0, Number(room.tts?.voicePage || 0))
  };
}
function tvDefaults() {
  return { voice: 'en-US-AriaNeural', lang: 'en-US', rate: 100, volume: 100, maxCharacters: 500 };
}
function roomFromPanel(channelId, rooms) {
  for (const room of rooms.values()) if (room.panelChannelId === channelId) return room;
  return null;
}
function key(interaction, kind) { return interaction.guildId + ':' + interaction.user.id + ':' + kind; }
function chosen(interaction, kind) { return selections.get(key(interaction, kind)); }
function canAccess(interaction, room) {
  normalize(room);
  if (interaction.user.id === room.ownerId) return true;
  if (room.accessUsers.has(interaction.user.id)) return true;
  return interaction.member?.roles?.cache ? [...room.accessRoles].some(id => interaction.member.roles.cache.has(id)) : false;
}
function canControl(interaction, room, client) {
  if (room.ownerId === interaction.user.id) return true;
  return tv(client).ownerOnlyControl === false;
}
function button(id, label, style=ButtonStyle.Secondary, disabled=false, emoji=null) {
  const b = new ButtonBuilder().setCustomId('rn-tvc:' + id).setLabel(label).setStyle(style).setDisabled(!!disabled);
  if (emoji) b.setEmoji(emoji);
  return b;
}
function nav(page) {
  return new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder().setCustomId('rn-tvc:page').setPlaceholder('Navigate Voice Control...')
      .addOptions(
        {label:'Overview',value:'overview',description:'Room status and quick controls',default:page==='overview'},
        {label:'Room Settings',value:'room',description:'Name, lock, visibility, limit, bitrate',default:page==='room'},
        {label:'Members',value:'members',description:'Kick, mute, deafen, move and manage members',default:page==='members'},
        {label:'Bans',value:'bans',description:'Ban and unban users from this temporary room',default:page==='bans'},
        {label:'Access',value:'access',description:'Choose who can use the control panel',default:page==='access'},
        {label:'TTS',value:'tts',description:'Voice, language, rate, volume and speech controls',default:page==='tts'},
        {label:'Music',value:'music',description:'Playback and queue controls for this VC',default:page==='music'},
        {label:'Danger Zone',value:'danger',description:'Transfer, reset or delete the room',default:page==='danger'}
      )
  );
}
function status(room, voice, panel) {
  const t = room.tts || tvDefaults();
  return [
    '**Voice:** ' + (voice ? '<#' + voice.id + '>' : 'Missing'),
    '**Panel:** ' + (panel ? '<#' + panel.id + '>' : 'Missing'),
    '**Owner:** <@' + room.ownerId + '>',
    '**Members:** ' + (voice?.members?.size || 0) + '/' + (voice?.userLimit || '∞'),
    '**Bitrate:** ' + (voice ? Math.round(voice.bitrate / 1000) + ' kbps' : 'unknown'),
    '**Locked:** ' + (room.locked ? 'Yes' : 'No'),
    '**Hidden:** ' + (room.hidden ? 'Yes' : 'No'),
    '**VC Bans:** ' + room.bannedUsers.size,
    '**Panel Users:** ' + room.accessUsers.size,
    '**Panel Roles:** ' + room.accessRoles.size,
    '**TTS:** ' + (t.enabled ? t.voice + ' • ' + t.lang : 'Disabled')
  ].join('\n');
}
async function getVoices(force=false) {
  if (!force && voiceCache.voices.length && Date.now() - voiceCache.at < 21600000) return voiceCache.voices;
  try {
    voiceCache.voices = await ttsService.listVoices(force);
    voiceCache.at = Date.now();
  } catch (e) {
    if (!voiceCache.voices.length) throw e;
  }
  return voiceCache.voices;
}
async function makePayload(client, room) {
  normalize(room);
  const b = brand(client);
  const guild = client.guilds.cache.get(room.guildId);
  const voice = guild?.channels.cache.get(room.voiceChannelId);
  const panel = guild?.channels.cache.get(room.panelChannelId);
  const page = room.page || 'overview';
  const rows = [nav(page)];
  let description = '';
  const c = tv(client);

  if (page === 'overview') {
    description = [
      c.panelDescription || 'Manage your temporary voice room.',
      '',
      status(room, voice, panel),
      '',
      'This panel is private. The room owner can choose additional users or roles under **Access**.',
      'Use **Members** for moderation and **TTS** for the full speech controls.'
    ].join('\n');
    rows.push(new ActionRowBuilder().addComponents(
      button(room.locked?'unlock':'lock',room.locked?'Unlock Room':'Lock Room',room.locked?ButtonStyle.Success:ButtonStyle.Primary,false,room.locked?'🔓':'🔒'),
      button(room.hidden?'unhide':'hide',room.hidden?'Show Room':'Hide Room',ButtonStyle.Secondary,false,room.hidden?'👁️':'🙈'),
      button('rename','Rename Room',ButtonStyle.Primary,c.allowOwnerRename===false,'✏️'),
      button('limit','User Limit',ButtonStyle.Primary,c.allowOwnerLimit===false,'👥'),
      button('bitrate','Bitrate',ButtonStyle.Primary,c.allowOwnerBitrate===false,'🎚️')
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button('members','Manage Members',ButtonStyle.Secondary,false,'🛡️'),
      button('bans','VC Bans',ButtonStyle.Danger,false,'⛔'),
      button('access','Panel Access',ButtonStyle.Secondary,false,'🔑'),
      button('tts','TTS',ButtonStyle.Secondary,c.allowOwnerTts===false,'🔊'),
      button('refresh','Refresh',ButtonStyle.Secondary,false,'🔄')
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button('delete','Delete Room',ButtonStyle.Danger,false,'🗑️'),
      button('danger','More',ButtonStyle.Secondary,false,'⚙️')
    ));
  } else if (page === 'room') {
    description = [
      '### Room Settings',
      '**Name:** ' + (voice?.name || 'Missing'),
      '**Lock:** ' + (room.locked ? 'Locked' : 'Unlocked'),
      '**Visibility:** ' + (room.hidden ? 'Hidden' : 'Visible'),
      '**User limit:** ' + (voice?.userLimit || 0) + ' (0 = unlimited)',
      '**Bitrate:** ' + (voice ? Math.round(voice.bitrate/1000) : 'unknown') + ' kbps',
      '',
      'All settings are applied to the actual Discord voice channel.'
    ].join('\n');
    rows.push(new ActionRowBuilder().addComponents(
      button('lock','Lock Room',ButtonStyle.Primary,room.locked||c.allowOwnerLock===false,'🔒'),
      button('unlock','Unlock Room',ButtonStyle.Success,!room.locked||c.allowOwnerUnlock===false,'🔓'),
      button('hide','Hide Room',ButtonStyle.Secondary,room.hidden||c.allowOwnerHide===false,'🙈'),
      button('unhide','Unhide Room',ButtonStyle.Secondary,!room.hidden||c.allowOwnerUnhide===false,'👁️'),
      button('rename','Rename Room',ButtonStyle.Primary,c.allowOwnerRename===false,'✏️')
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button('limit','Set Limit',ButtonStyle.Primary,c.allowOwnerLimit===false,'👥'),
      button('bitrate','Set Bitrate',ButtonStyle.Primary,c.allowOwnerBitrate===false,'🎚️'),
      button('reset-room','Reset Settings',ButtonStyle.Secondary,false,'♻️'),
      button('refresh','Refresh',ButtonStyle.Secondary,false,'🔄')
    ));
  } else if (page === 'members') {
    const names = voice?.members ? [...voice.members.values()].map(m => '<@'+m.id+'>').join(', ') : '';
    description = [
      '### Room Members',
      names || 'Nobody is connected.',
      '',
      'Select a member below, then use the moderation buttons. The bot must have the required Discord permissions.'
    ].join('\n');
    rows.push(new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId('rn-tvc:member').setPlaceholder('Select a member in this VC...').setMinValues(1).setMaxValues(1)
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button('kick','Kick',ButtonStyle.Danger,false,'👢'),
      button('mute','Mute',ButtonStyle.Secondary,false,'🔇'),
      button('unmute','Unmute',ButtonStyle.Success,false,'🔊'),
      button('deafen','Deafen',ButtonStyle.Secondary,false,'🙉'),
      button('undeafen','Undeafen',ButtonStyle.Success,false,'👂')
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button('ban-selected','Ban From VC',ButtonStyle.Danger,c.allowOwnerBan===false,'⛔'),
      button('transfer-selected','Transfer Owner',ButtonStyle.Success,c.allowOwnerTransfer===false,'👑'),
      button('panel-selected','Grant Panel',ButtonStyle.Primary,false,'🔑'),
      button('refresh','Refresh',ButtonStyle.Secondary,false,'🔄')
    ));
  } else if (page === 'bans') {
    const banned = [...room.bannedUsers].slice(0,25).map(id => '<@'+id+'>').join(', ') || 'No one is banned from this room.';
    description = ['### VC Bans','Users denied entry to this temporary voice room:',banned,'','Use the selector to ban or unban a user. Bans are enforced with a channel permission overwrite.'].join('\n');
    rows.push(new ActionRowBuilder().addComponents(
      new UserSelectMenuBuilder().setCustomId('rn-tvc:ban-user').setPlaceholder('Select a user...').setMinValues(1).setMaxValues(1)
    ));
    rows.push(new ActionRowBuilder().addComponents(
      button('ban-user','Ban From VC',ButtonStyle.Danger,c.allowOwnerBan===false,'⛔'),
      button('unban-user','Unban From VC',ButtonStyle.Success,false,'✅'),
      button('refresh','Refresh',ButtonStyle.Secondary,false,'🔄')
    ));
  } else if (page === 'access') {
    description = [
      '### Panel Access',
      '**Users:** ' + ([...room.accessUsers].map(id=>'<@'+id+'>').join(', ') || 'None'),
      '**Roles:** ' + ([...room.accessRoles].map(id=>'<@&'+id+'>').join(', ') || 'None'),
      '',
      'Only the room owner can change this list by default.',
      c.syncPermissions !== false ? 'Granted panel access is also granted access to the VC.' : 'Panel access is separate from VC access.'
    ].join('\n');
    rows.push(new ActionRowBuilder().addComponents(new UserSelectMenuBuilder().setCustomId('rn-tvc:access-user').setPlaceholder('Select user...').setMinValues(1).setMaxValues(1)));
    rows.push(new ActionRowBuilder().addComponents(
      button('grant-user','Grant User',ButtonStyle.Success,false,'➕'),
      button('revoke-user','Remove User',ButtonStyle.Danger,false,'➖')
    ));
    rows.push(new ActionRowBuilder().addComponents(new RoleSelectMenuBuilder().setCustomId('rn-tvc:access-role').setPlaceholder('Select role...').setMinValues(1).setMaxValues(1)));
    rows.push(new ActionRowBuilder().addComponents(
      button('grant-role','Grant Role',ButtonStyle.Success,false,'➕'),
      button('revoke-role','Remove Role',ButtonStyle.Danger,false,'➖'),
      button('reset-access','Reset Access',ButtonStyle.Secondary,false,'♻️')
    ));
  } else if (page === 'tts') {
    if (c.allowOwnerTts === false) {
      description = 'TTS controls are disabled for temporary room owners.';
    } else {
      const voices = await getVoices();
      const t = room.tts;
      const filtered = t.languageFilter === 'all' ? voices : voices.filter(v => String(v.Locale||'').toLowerCase().startsWith(String(t.languageFilter).toLowerCase()));
      const pages = Math.max(1,Math.ceil(filtered.length/5));
      t.voicePage = Math.min(Math.max(0,t.voicePage),pages-1);
      const current = filtered.slice(t.voicePage*5,t.voicePage*5+5);
      const languages = [...new Set(voices.map(v=>String(v.Locale||'').trim()).filter(Boolean))].sort();
      const langOptions = [{label:'All Languages',value:'all',description:'Show every API voice',emoji:'🌐'}]
        .concat(languages.slice(0,24).map(x=>({label:x,value:x,description:'Voices for '+x,emoji:'🗣️'})));
      const voiceOptions = current.map(v=>({
        label:String(v.ShortName||v.Name).slice(0,100),
        value:String(v.ShortName||v.Name).slice(0,100),
        description:(String(v.Locale||'')+' • '+String(v.Gender||'Unknown')).slice(0,100),
        default:String(v.ShortName||v.Name)===t.voice
      }));
      description = [
        '### Text to Speech',
        '**Enabled:** '+(t.enabled?'Yes':'No'),
        '**Voice:** '+t.voice,
        '**Language:** '+t.lang,
        '**Rate:** '+t.rate+'%',
        '**Volume:** '+t.volume+'%',
        '**Max characters:** '+t.maxCharacters,
        '',
        'API voices: **'+filtered.length+'** | Page **'+(t.voicePage+1)+'/'+pages,
        'Use the language menu, voice menu and paging buttons to browse dynamically.'
      ].join('\n');
      rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('rn-tvc:tts-language').setPlaceholder('Filter voices by API language...').addOptions(langOptions)));
      if(voiceOptions.length) rows.push(new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('rn-tvc:tts-voice').setPlaceholder('Select a voice...').addOptions(voiceOptions)));
      rows.push(new ActionRowBuilder().addComponents(
        button('tts-first','⏮',ButtonStyle.Secondary,t.voicePage<=0),
        button('tts-prev','◀',ButtonStyle.Primary,t.voicePage<=0),
        button('tts-next','▶',ButtonStyle.Primary,t.voicePage>=pages-1),
        button('tts-last','⏭',ButtonStyle.Secondary,t.voicePage>=pages-1),
        button('tts-refresh','Refresh Voices',ButtonStyle.Secondary,false,'🔄')
      ));
      rows.push(new ActionRowBuilder().addComponents(
        button(t.enabled?'tts-disable':'tts-enable',t.enabled?'Disable TTS':'Enable TTS',t.enabled?ButtonStyle.Danger:ButtonStyle.Success,false,t.enabled?'🔇':'🔊'),
        button('tts-test','Test TTS',ButtonStyle.Primary,false,'🗣️'),
        button('tts-rate','Rate',ButtonStyle.Secondary,false,'⏩'),
        button('tts-volume','Volume',ButtonStyle.Secondary,false,'🔊'),
        button('tts-max','Max Text',ButtonStyle.Secondary,false,'📏')
      ));
    }
  } else if (page === 'music') {
    const s = client.voiceSessions?.get(room.guildId);
    const q = s?.queue || [];
    description = [
      '### Voice Music',
      '**Now Playing:** ' + (s?.current?.title || 'Nothing'),
      '**Queue:** ' + q.length,
      '**Volume:** ' + (s?.volume ?? 100) + '%',
      '',
      q.length ? q.slice(0,10).map((x,n)=>(n+1)+'. '+x.title).join('\n') : 'Queue is empty.'
    ].join('\n');
    rows.push(new ActionRowBuilder().addComponents(
      button('music-skip','Skip',ButtonStyle.Primary,false,'⏭️'),
      button('music-stop','Stop',ButtonStyle.Danger,false,'⏹️'),
      button('music-refresh','Refresh',ButtonStyle.Secondary,false,'🔄')
    ));
  } else if (page === 'danger') {
    description = [
      '### Danger Zone',
      '**Owner:** <@'+room.ownerId+'>',
      '**Voice:** <#'+room.voiceChannelId+'>',
      '**Panel:** <#'+room.panelChannelId+'>',
      '',
      'Transfer ownership to another member, reset the room permissions, or permanently delete both channels.'
    ].join('\n');
    rows.push(new ActionRowBuilder().addComponents(
      button('claim','Claim Empty Room',ButtonStyle.Success,c.allowOwnerClaim===false,'👑'),
      button('reset-room','Reset Room',ButtonStyle.Secondary,false,'♻️'),
      button('reset-access','Reset Access',ButtonStyle.Secondary,false,'🔑'),
      button('delete','Delete Room',ButtonStyle.Danger,false,'🗑️')
    ));
  }

  return {
    embeds:[new EmbedBuilder().setColor(b.color).setTitle(b.server+' • '+(c.panelTitle||'Voice Control')).setDescription(description).setFooter({text:b.footer+' • '+page}).setTimestamp()],
    components:rows.slice(0,5)
  };
}
async function refresh(client, room, page) {
  normalize(room);
  if(page)room.page=page;
  const guild=client.guilds.cache.get(room.guildId);
  const channel=guild?.channels.cache.get(room.panelChannelId);
  if(!channel?.isTextBased())return null;
  const payload=await makePayload(client,room);
  let message=null;
  if(room.panelMessageId) {
    message=await channel.messages.fetch(room.panelMessageId).catch(()=>null);
    if(message) { await message.edit(payload).catch(()=>{}); return message; }
  }
  const recent=await channel.messages.fetch({limit:10}).catch(()=>null);
  message=recent?.find(m=>m.author?.id===guild.members.me?.id&&m.components?.some(row=>row.components.some(c=>String(c.customId||'').startsWith('rn-tvc:'))));
  if(message) { room.panelMessageId=message.id; await message.edit(payload).catch(()=>{}); return message; }
  message=await channel.send(payload);
  room.panelMessageId=message.id;
  return message;
}
function panelOverwrites(guild, ownerId) {
  return [
    {id:guild.roles.everyone.id,deny:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory]},
    {id:ownerId,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.ReadMessageHistory],deny:[PermissionFlagsBits.SendMessages]},
    {id:guild.members.me?.id||guild.client.user.id,allow:[PermissionFlagsBits.ViewChannel,PermissionFlagsBits.SendMessages,PermissionFlagsBits.ReadMessageHistory,PermissionFlagsBits.EmbedLinks,PermissionFlagsBits.ManageChannels,PermissionFlagsBits.ManageMessages]}
  ];
}
function roomForVoice(channelId) { for(const room of roomsForLookup.values()) if(room.voiceChannelId===channelId) return room; return null; }
let roomsForLookup=new Map();
async function create(client, member, voice, room) {
  const c=tv(client);
  if(c.panelEnabled===false)return null;
  const guild=member.guild;
  const panel=await guild.channels.create({
    name:panelSlug(client,voice.name),
    type:ChannelType.GuildText,
    parent:c.categoryId||voice.parentId||undefined,
    topic:'RealmsNetwork temporary VC panel | owner='+member.id+' | voice='+voice.id,
    permissionOverwrites:panelOverwrites(guild,member.id),
    reason:'Create temporary voice room control panel'
  });
  room.panelChannelId=panel.id;
  normalize(room);
  await syncPanelPerms(guild,room);
  await syncTopic(panel,room);
  const message=await refresh(client,room,'overview');
  if(c.panelAutoPin!==false&&message)await message.pin().catch(()=>{});
  return panel;
}
function panelSlug(client,name){
  const suffix=String(tv(client).panelSuffix||'-panel');
  const base=String(name||'room').toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s_-]+/gu,'').trim().replace(/\s+/g,'-').replace(/-+/g,'-');
  const roomName=(base||'room').slice(0,Math.max(1,100-suffix.length));
  return roomName+suffix;
}
async function syncPanelPerms(guild,room) {
  const panel=guild.channels.cache.get(room.panelChannelId);
  if(!panel?.permissionOverwrites)return;
  const keep=[guild.roles.everyone.id,guild.members.me?.id,room.ownerId];
  const existing=[...panel.permissionOverwrites.cache.keys()];
  for(const id of existing) if(!keep.includes(id)&&!room.accessUsers.has(id)&&!room.accessRoles.has(id)) await panel.permissionOverwrites.delete(id).catch(()=>{});
  await panel.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:false,SendMessages:false,ReadMessageHistory:false}).catch(()=>{});
  await panel.permissionOverwrites.edit(room.ownerId,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
  for(const id of room.accessUsers) if(id!==room.ownerId) await panel.permissionOverwrites.edit(id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
  for(const id of room.accessRoles) await panel.permissionOverwrites.edit(id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
}
async function syncVoicePerms(guild,room) {
  const voice=guild.channels.cache.get(room.voiceChannelId);
  if(!voice?.permissionOverwrites)return;
  await voice.permissionOverwrites.edit(guild.roles.everyone,{Connect:!room.locked,ViewChannel:!room.hidden}).catch(()=>{});
  const explicit=new Set([room.ownerId,...room.accessUsers]);
  for(const id of explicit) {
    await voice.permissionOverwrites.edit(id,{Connect:true,Speak:true,ViewChannel:true}).catch(()=>{});
  }
  for(const id of room.accessRoles) await voice.permissionOverwrites.edit(id,{Connect:true,ViewChannel:true}).catch(()=>{});
  for(const id of room.bannedUsers) await voice.permissionOverwrites.edit(id,{Connect:false}).catch(()=>{});
}
async function syncPermissions(guild,room) {
  await syncPanelPerms(guild,room);
  if(tv(guild.client).syncPermissions!==false)await syncVoicePerms(guild,room);
}
async function syncTopic(panel,room) {
  if(!panel?.setTopic)return;
  const data=Buffer.from(JSON.stringify({owner:room.ownerId,voice:room.voiceChannelId,tts:room.tts})).toString('base64url');
  await panel.setTopic('RealmsNetwork temporary VC panel | '+data).catch(()=>{});
}
async function applyBan(room,guild,id,reason='Temporary VC ban') {
  normalize(room);
  if(id===room.ownerId||id===guild.ownerId)throw new Error('That user cannot be banned from the room.');
  const member=guild.members.cache.get(id)||await guild.members.fetch(id).catch(()=>null);
  room.bannedUsers.add(id);
  await guild.channels.cache.get(room.voiceChannelId)?.permissionOverwrites.edit(id,{Connect:false});
  if(member?.voice?.channelId===room.voiceChannelId)await member.voice.disconnect(reason).catch(()=>{});
}
async function removeBan(room,guild,id) {
  normalize(room);
  room.bannedUsers.delete(id);
  const voice=guild.channels.cache.get(room.voiceChannelId);
  await voice?.permissionOverwrites.delete(id).catch(()=>{});
  if(tv(guild.client).syncPermissions!==false) {
    if(room.accessUsers.has(id)||id===room.ownerId) await voice?.permissionOverwrites.edit(id,{Connect:true,Speak:true,ViewChannel:true}).catch(()=>{});
  }
}
async function speak(client,room,text) {
  normalize(room);
  if(!room.tts.enabled)throw new Error('TTS is disabled for this room.');
  const guild=client.guilds.cache.get(room.guildId);
  const channel=guild?.channels.cache.get(room.voiceChannelId);
  if(!guild||!channel||channel.type!==ChannelType.GuildVoice)throw new Error('Voice room is unavailable.');
  if(!client.voiceSessions)client.voiceSessions=new Map();
  let s=client.voiceSessions.get(room.guildId);
  if(!s) {
    s={connection:null,player:createAudioPlayer(),queue:[],current:null,textChannelId:room.panelChannelId,volume:100};
    client.voiceSessions.set(room.guildId,s);
  }
  if(!s.connection||s.connection.joinConfig?.channelId!==channel.id) {
    s.connection?.destroy?.();
    s.connection=joinVoiceChannel({channelId:channel.id,guildId:guild.id,adapterCreator:guild.voiceAdapterCreator,selfDeaf:true,selfMute:false});
    s.connection.subscribe(s.player);
    await entersState(s.connection,VoiceConnectionStatus.Ready,10000);
  }
  const dir=path.join(__dirname,'../../data/tts');
  fs.mkdirSync(dir,{recursive:true});
  const safe=String(text).slice(0,Math.max(1,Math.min(2000,room.tts.maxCharacters||500)));
  const file=path.join(dir,room.guildId+'-room-'+room.voiceChannelId+'-'+Date.now()+'.mp3');
  await ttsService.synthesize(safe,file,room.tts);
  const resource=createAudioResource(file,{inlineVolume:true});
  resource.volume?.setVolume(Math.max(0,Math.min(1.5,(room.tts.volume||100)/100)));
  await new Promise((resolve,reject)=>{
    const onIdle=()=>{cleanup();resolve();};
    const onErr=e=>{cleanup();reject(e);};
    const cleanup=()=>{s.player.off('idle',onIdle);s.player.off('error',onErr);};
    s.player.once('idle',onIdle);
    s.player.once('error',onErr);
    s.player.play(resource);
  }).finally(()=>fs.rm(file,{force:true},()=>{}));
}
async function showForm(interaction,kind) {
  const config={
    rename:['Rename Room','New room name','',100],
    limit:['Set User Limit','User limit (0 = unlimited)','0-99',2],
    bitrate:['Set Bitrate','Bitrate in kbps','8-384',3],
    'tts-rate':['TTS Rate','Speech rate percent (100 = normal)','50-200',3],
    'tts-volume':['TTS Volume','Speech volume percent (100 = normal)','0-150',3],
    'tts-max':['TTS Max Text','Maximum TTS characters','50-2000',4],
    'tts-test':['Test TTS','Text to speak','Hello from your temporary room!',500]
  };
  const x=config[kind]||['Temporary Voice Room','Value','',100];
  return interaction.showModal(new ModalBuilder().setCustomId('rn-tvc-modal:'+kind).setTitle(x[0]).addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel(x[1]).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(x[3]).setPlaceholder(x[2]))
  ));
}
async function handleButton(interaction,client,rooms) {
  const room=roomFromPanel(interaction.channelId,rooms);
  if(!room||!canAccess(interaction,room))return interaction.reply({content:'You do not have access to this panel.',ephemeral:true});
  normalize(room);
  const action=interaction.customId.slice('rn-tvc:'.length);
  if(['refresh','members','access','bans','tts','music','danger','overview','room'].includes(action)) {
    room.page=action==='refresh'?room.page:action;
    return interaction.update(await makePayload(client,room));
  }
  if(['tts-first','tts-prev','tts-next','tts-last','tts-refresh'].includes(action)) {
    try {
      const voices=await getVoices(action==='tts-refresh');
      const filtered=room.tts.languageFilter==='all'?voices:voices.filter(v=>String(v.Locale||'').toLowerCase().startsWith(String(room.tts.languageFilter).toLowerCase()));
      const pages=Math.max(1,Math.ceil(filtered.length/5));
      if(action==='tts-first')room.tts.voicePage=0;
      if(action==='tts-prev')room.tts.voicePage=Math.max(0,room.tts.voicePage-1);
      if(action==='tts-next')room.tts.voicePage=Math.min(pages-1,room.tts.voicePage+1);
      if(action==='tts-last')room.tts.voicePage=pages-1;
      return interaction.update(await makePayload(client,room));
    } catch(e) { return interaction.reply({content:'Could not load TTS voices: '+e.message,ephemeral:true}); }
  }
  if(['refresh','music-refresh'].includes(action))return interaction.update(await makePayload(client,room));
  if(action==='claim') {
    if(tv(client).allowOwnerClaim===false)return interaction.reply({content:'Claiming is disabled.',ephemeral:true});
    const voice=interaction.guild.channels.cache.get(room.voiceChannelId);
    if(voice?.members?.size) return interaction.reply({content:'The room must be empty before it can be claimed.',ephemeral:true});
    room.ownerId=interaction.user.id; room.accessUsers=new Set([interaction.user.id]); room.accessRoles.clear();
    await syncPermissions(interaction.guild,room);
    await syncTopic(interaction.guild.channels.cache.get(room.panelChannelId),room);
    return interaction.update(await makePayload(client,room));
  }
  if(action==='delete') {
    return showDelete(interaction);
  }
  if(!canControl(interaction,room,client))return interaction.reply({content:'Only the temporary room owner can use these controls.',ephemeral:true});
  const guild=interaction.guild,voice=guild.channels.cache.get(room.voiceChannelId),c=tv(client);
  if(!voice)return interaction.reply({content:'The voice room no longer exists.',ephemeral:true});
  const memberId=chosen(interaction,'member')||chosen(interaction,'ban-user');
  const accessUser=chosen(interaction,'access-user');
  const accessRole=chosen(interaction,'access-role');
  if(['rename','limit','bitrate','tts-rate','tts-volume','tts-max','tts-test'].includes(action))return showForm(interaction,action);
  if(action==='lock'){room.locked=true;await syncVoicePerms(guild,room);}
  else if(action==='unlock'){room.locked=false;await syncVoicePerms(guild,room);}
  else if(action==='hide'){room.hidden=true;await syncVoicePerms(guild,room);}
  else if(action==='unhide'){room.hidden=false;await syncVoicePerms(guild,room);}
  else if(action==='reset-room'){room.locked=false;room.hidden=false;await syncVoicePerms(guild,room);await voice.setUserLimit(0).catch(()=>{});await voice.setBitrate(Math.min(Number(c.bitrate)||64000,Number(c.maxBitrate)||384000)).catch(()=>{});}
  else if(action==='grant-user'){if(!accessUser)return interaction.reply({content:'Select a user first.',ephemeral:true});await grant(room,guild,accessUser,'user',client);}
  else if(action==='revoke-user'){if(!accessUser)return interaction.reply({content:'Select a user first.',ephemeral:true});await revoke(room,guild,accessUser,'user',client);}
  else if(action==='grant-role'){if(!accessRole)return interaction.reply({content:'Select a role first.',ephemeral:true});await grant(room,guild,accessRole,'role',client);}
  else if(action==='revoke-role'){if(!accessRole)return interaction.reply({content:'Select a role first.',ephemeral:true});await revoke(room,guild,accessRole,'role',client);}
  else if(['kick','mute','unmute','deafen','undeafen','ban-selected'].includes(action)){
    const targetId=memberId, target=targetId&&guild.members.cache.get(targetId);
    if(!target||target.id===interaction.user.id)return interaction.reply({content:'Select another member first.',ephemeral:true});
    if(target.id===guild.ownerId)return interaction.reply({content:'The server owner cannot be managed from a room panel.',ephemeral:true});
    if(action==='kick')await target.voice.disconnect('Temporary VC owner action');
    if(action==='mute')await target.voice.setMute(true,'Temporary VC owner action');
    if(action==='unmute')await target.voice.setMute(false,'Temporary VC owner action');
    if(action==='deafen')await target.voice.setDeaf(true,'Temporary VC owner action');
    if(action==='undeafen')await target.voice.setDeaf(false,'Temporary VC owner action');
    if(action==='ban-selected'){if(c.allowOwnerBan===false)return interaction.reply({content:'VC bans are disabled.',ephemeral:true});await applyBan(room,guild,target.id);}
  }
  else if(action==='ban-user'){if(c.allowOwnerBan===false)return interaction.reply({content:'VC bans are disabled.',ephemeral:true});if(!memberId)return interaction.reply({content:'Select a user first.',ephemeral:true});await applyBan(room,guild,memberId);}
  else if(action==='unban-user'){if(!memberId)return interaction.reply({content:'Select a user first.',ephemeral:true});await removeBan(room,guild,memberId);}
  else if(action==='transfer-selected'){
    const target=memberId&&guild.members.cache.get(memberId);
    if(!target)return interaction.reply({content:'Select a member in the room first.',ephemeral:true});
    if(c.allowOwnerTransfer===false)return interaction.reply({content:'Owner transfer is disabled.',ephemeral:true});
    room.ownerId=target.id;room.accessUsers.add(target.id);await syncPermissions(guild,room);
  }
  else if(action==='panel-selected'){if(!memberId)return interaction.reply({content:'Select a member first.',ephemeral:true});await grant(room,guild,memberId,'user',client);}
  else if(action==='reset-access'){room.accessUsers=new Set([room.ownerId]);room.accessRoles=new Set();await syncPermissions(guild,room);}
  else if(action==='tts-enable'){room.tts.enabled=true;}
  else if(action==='tts-disable'){room.tts.enabled=false;}
  else if(action==='tts-test')return showForm(interaction,'tts-test');
  else if(action==='music-skip'){client.voiceSessions?.get(room.guildId)?.player?.stop(true);}
  else if(action==='music-stop'){const s=client.voiceSessions?.get(room.guildId);if(s){s.queue=[];s.current=null;s.player?.stop(true);s.connection?.destroy?.();}}
  await syncTopic(guild.channels.cache.get(room.panelChannelId),room);
  room.page=room.page||'overview';
  return interaction.update(await makePayload(client,room));
}
async function handleSelect(interaction,client,rooms) {
  const room=roomFromPanel(interaction.channelId,rooms);
  if(!room||!canAccess(interaction,room))return interaction.reply({content:'You do not have access to this panel.',ephemeral:true});
  normalize(room);
  const kind=interaction.customId.slice('rn-tvc:'.length),value=interaction.values?.[0];
  if(!value)return interaction.reply({content:'Nothing was selected.',ephemeral:true});
  if(kind==='page'){room.page=value;return interaction.update(await makePayload(client,room));}
  if(kind==='tts-language'){room.tts.languageFilter=value;room.tts.voicePage=0;await syncTopic(interaction.guild.channels.cache.get(room.panelChannelId),room);return interaction.update(await makePayload(client,room));}
  if(kind==='tts-voice'){room.tts.voice=value;const v=(await getVoices()).find(x=>String(x.ShortName||x.Name)===value);if(v?.Locale)room.tts.lang=v.Locale;await syncTopic(interaction.guild.channels.cache.get(room.panelChannelId),room);return interaction.update(await makePayload(client,room));}
  if(!canControl(interaction,room,client))return interaction.reply({content:'Only the temporary room owner can use these controls.',ephemeral:true});
  selections.set(key(interaction,kind),value);
  return interaction.reply({content:kind.startsWith('access-role')?'<@&'+value+'> selected.':'<@'+value+'> selected.',ephemeral:true});
}
async function handleModal(interaction,client,rooms) {
  const room=roomFromPanel(interaction.channelId,rooms);
  if(!room||!canAccess(interaction,room))return interaction.reply({content:'You do not have access to this panel.',ephemeral:true});
  if(!canControl(interaction,room,client))return interaction.reply({content:'Only the temporary room owner can use these controls.',ephemeral:true});
  normalize(room);
  const guild=interaction.guild,voice=guild.channels.cache.get(room.voiceChannelId),kind=interaction.customId.slice('rn-tvc-modal:'.length),value=interaction.fields.getTextInputValue('value').trim();
  if(kind==='delete'){
    if(value.toUpperCase()!=='DELETE')return interaction.reply({content:'Deletion cancelled. Type DELETE exactly to confirm.',ephemeral:true});
    await interaction.reply({content:'Deleting temporary room...',ephemeral:true});
    await deleteRoom(client,rooms,room,guild,'Temporary VC owner deleted the room');return;
  }
  try {
    if(kind==='rename'){const name=value.replace(/\s+/g,' ').slice(0,100);if(!name)throw new Error('Room name cannot be empty.');await voice.setName(name);}
    else if(kind==='limit'){const n=Number(value);if(!Number.isInteger(n)||n<0||n>99)throw new Error('Limit must be 0-99.');await voice.setUserLimit(n);}
    else if(kind==='bitrate'){const n=Number(value),max=Math.min(Number(tv(client).maxBitrate)||384000,384000)/1000;if(!Number.isInteger(n)||n<8||n>max)throw new Error('Bitrate must be 8-'+max+' kbps.');await voice.setBitrate(n*1000);}
    else if(kind==='tts-rate'){const n=Number(value);if(!Number.isInteger(n)||n<50||n>200)throw new Error('Rate must be 50-200%.');room.tts.rate=n;}
    else if(kind==='tts-volume'){const n=Number(value);if(!Number.isInteger(n)||n<0||n>150)throw new Error('Volume must be 0-150%.');room.tts.volume=n;}
    else if(kind==='tts-max'){const n=Number(value);if(!Number.isInteger(n)||n<50||n>2000)throw new Error('Max text must be 50-2000.');room.tts.maxCharacters=n;}
    else if(kind==='tts-test'){await speak(client,room,value);return interaction.reply({content:'TTS test played in the room.',ephemeral:true});}
    await syncTopic(guild.channels.cache.get(room.panelChannelId),room);
    room.page=kind.startsWith('tts-')?'tts':'room';
    await interaction.reply({content:'Updated.',ephemeral:true});
    await refresh(client,room,room.page);
  } catch(e) { return interaction.reply({content:'Could not apply that setting: '+(e?.message||e),ephemeral:true}); }
}
async function showDelete(interaction){
  return interaction.showModal(new ModalBuilder().setCustomId('rn-tvc-modal:delete').setTitle('Delete Temporary Room').addComponents(
    new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('value').setLabel('Type DELETE to confirm').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(6))
  ));
}
async function grant(room,guild,id,type,client){
  normalize(room);
  if(type==='role'){
    const role=guild.roles.cache.get(id);
    if(!role||role.managed||id===guild.roles.everyone.id)throw new Error('That role cannot be granted.');
    if(tv(client).panelAllowRoleAccess===false)throw new Error('Role access is disabled.');
    room.accessRoles.add(id);
  } else {
    const member=guild.members.cache.get(id)||await guild.members.fetch(id).catch(()=>null);
    if(!member||member.user.bot)throw new Error('That user cannot be granted.');
    if(tv(client).panelAllowUserAccess===false)throw new Error('User access is disabled.');
    room.accessUsers.add(id);
  }
  await syncPermissions(guild,room);
}
async function revoke(room,guild,id,type,client){
  normalize(room);
  if(id===room.ownerId)throw new Error('The owner cannot be removed.');
  if(type==='role')room.accessRoles.delete(id);else room.accessUsers.delete(id);
  await syncPermissions(guild,room);
}
async function deleteRoom(client,rooms,room,guild,reason){
  if(!room)return;
  rooms.delete(room.voiceChannelId);
  await guild.channels.cache.get(room.panelChannelId)?.delete(reason||'Temporary room deleted').catch(()=>{});
  await guild.channels.cache.get(room.voiceChannelId)?.delete(reason||'Temporary room deleted').catch(()=>{});
}
async function channelUpdate(oldChannel,newChannel,client,rooms){
  const room=rooms.get(newChannel.id);
  if(!room||newChannel.type!==ChannelType.GuildVoice)return;
  const panel=room.panelChannelId&&newChannel.guild.channels.cache.get(room.panelChannelId);
  if(oldChannel.name!==newChannel.name)await panel?.setName(panelSlug(client,newChannel.name)).catch(()=>{});
  await refresh(client,room,room.page||'overview').catch(()=>{});
}
async function recover(client,rooms){
  const c=tv(client);if(c.panelEnabled===false)return;
  for(const guild of client.guilds.cache.values()){
    const channels=await guild.channels.fetch().catch(()=>guild.channels.cache);
    for(const channel of channels.values()){
      if(!channel?.isTextBased?.()||!channel.topic?.startsWith('RealmsNetwork temporary VC panel | '))continue;
      let meta={};try{meta=JSON.parse(Buffer.from(channel.topic.slice('RealmsNetwork temporary VC panel | '.length),'base64url').toString('utf8'));}catch{}
      const owner=meta.owner||channel.topic.match(/owner=(\d+)/)?.[1];
      const voiceId=meta.voice||channel.topic.match(/voice=(\d+)/)?.[1];
      const voice=guild.channels.cache.get(voiceId)||await guild.channels.fetch(voiceId).catch(()=>null);
      if(!owner||!voice||voice.type!==ChannelType.GuildVoice){await channel.delete('Temporary VC voice channel missing').catch(()=>{});continue;}
      const room={guildId:guild.id,voiceChannelId:voice.id,panelChannelId:channel.id,panelMessageId:null,ownerId:owner,createdAt:channel.createdTimestamp||Date.now(),locked:!!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.Connect),hidden:!!voice.permissionOverwrites.cache.get(guild.roles.everyone.id)?.deny.has(PermissionFlagsBits.ViewChannel),accessUsers:new Set([owner]),accessRoles:new Set(),bannedUsers:new Set(),page:'overview',tts:meta.tts||undefined};
      for(const [id,ow] of channel.permissionOverwrites.cache){
        if(id===guild.roles.everyone.id||id===guild.members.me?.id)continue;
        if(ow.type===0)room.accessRoles.add(id);else if(ow.type===1)room.accessUsers.add(id);
      }
      for(const [id,ow] of voice.permissionOverwrites.cache){
        if(id===guild.roles.everyone.id||id===guild.members.me?.id||id===owner)continue;
        if(ow.type===1&&ow.deny.has(PermissionFlagsBits.Connect))room.bannedUsers.add(id);
      }
      normalize(room);
      rooms.set(voice.id,room);
      await syncPanelPerms(guild,room);
      await refresh(client,room,'overview').catch(()=>{});
    }
  }
}
async function cleanup(client,rooms){
  if(tv(client).autoDeleteEmpty===false)return;
  for(const room of [...rooms.values()]){
    const guild=client.guilds.cache.get(room.guildId),voice=guild?.channels.cache.get(room.voiceChannelId);
    if(!guild){rooms.delete(room.voiceChannelId);continue;}
    if(!voice){rooms.delete(room.voiceChannelId);await guild.channels.cache.get(room.panelChannelId)?.delete('Temporary VC voice channel missing').catch(()=>{});continue;}
    if(voice.members.size===0)await deleteRoom(client,rooms,room,guild,'Temporary voice room empty');
  }
}
function initialize(client,rooms){
  roomsForLookup=rooms;
  if(cleanupTimer)clearInterval(cleanupTimer);
  const seconds=Math.max(10,Number(tv(client).cleanupIntervalSeconds||30));
  cleanupTimer=setInterval(()=>cleanup(client,rooms).catch(e=>console.error('[TempVC] Cleanup failed:',e?.stack||e)),seconds*1000);
  cleanupTimer.unref?.();
  client.once('ready',()=>recover(client,rooms).catch(e=>console.error('[TempVC] Recovery failed:',e?.stack||e)));
}
function destroy(){if(cleanupTimer)clearInterval(cleanupTimer);cleanupTimer=null;selections.clear();}
async function handle(interaction,client,rooms){
  try{
    if(interaction.customId?.startsWith('rn-tvc:')&&(interaction.isButton?.()||interaction.isStringSelectMenu?.()||interaction.isUserSelectMenu?.()||interaction.isRoleSelectMenu?.())){
      if(interaction.isButton?.())return handleButton(interaction,client,rooms);
      return handleSelect(interaction,client,rooms);
    }
    if(interaction.customId?.startsWith('rn-tvc-modal:')&&interaction.isModalSubmit?.())return handleModal(interaction,client,rooms);
  }catch(e){
    console.error('[TempVC] Panel interaction failed:',e?.stack||e);
    if(!interaction.replied&&!interaction.deferred)await interaction.reply({content:'Panel action failed: '+(e?.message||e),ephemeral:true}).catch(()=>{});
  }
}
module.exports={create,refresh,deleteRoom,initialize,destroy,recover,cleanup,handle,channelUpdate,panelSlug,speak,makePayload,roomForVoice};
