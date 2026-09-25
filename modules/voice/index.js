const {SlashCommandBuilder,EmbedBuilder,ChannelType,MessageFlags}=require('discord.js');
const {joinVoiceChannel,createAudioPlayer,createAudioResource,AudioPlayerStatus,VoiceConnectionStatus,entersState}=require('@discordjs/voice');
const play=require('play-dl');
const tts=require('./tts-service');
const tempPanel=require('./temp-panel');
const ttsCommands=require('./tts-commands');
const sessions=new Map();
const tempRooms=new Map();
const creatingTempRooms=new Set();
function cfg(client){return client.modules.get('voice')?.config||{};}
function edgePercent(value,neutral=100){const n=Number(value);if(!Number.isFinite(n)||n===neutral)return 'default';const delta=n-neutral;return (delta>=0?'+':'')+delta+'%';}
function brand(client){const b=client.config.branding||{};return{server:b.serverName||'RealmsNetwork',bot:b.botName||'RealmsNetwork Bot',color:b.embedColor||'#8b5cf6',footer:b.footer||b.serverName||'RealmsNetwork'};}
function embed(client,title,description){const b=brand(client);return new EmbedBuilder().setColor(b.color).setTitle(title).setDescription(description).setFooter({text:b.footer}).setTimestamp();}
function session(guildId){if(!sessions.has(guildId))sessions.set(guildId,{connection:null,player:createAudioPlayer(),queue:[],current:null,textChannelId:null,volume:100});return sessions.get(guildId);}
async function connect(member,client){
  if(!member?.voice?.channel)return null;
  const s=session(member.guild.id);

  if(s.connectionPromise)await s.connectionPromise.catch(()=>{});
  if(s.connection?.state?.status===VoiceConnectionStatus.Destroyed)s.connection=null;
  if(s.connection?.joinConfig?.channelId===member.voice.channel.id&&s.connection.state.status===VoiceConnectionStatus.Ready)return s;

  if(s.connection){
    const previous=s.connection;
    const ttsRoom=[...tempRooms.values()].find(r=>r.ttsConnection===previous);
    if(ttsRoom)await tts.stop(ttsRoom,client).catch(e=>console.error('[Voice/TTS] Failed to stop TTS before channel switch:',e?.message||e));
    previous.destroy();
    s.connection=null;
  }

  const work=(async()=>{
    const connection=joinVoiceChannel({
      channelId:member.voice.channel.id,
      guildId:member.guild.id,
      adapterCreator:member.guild.voiceAdapterCreator,
      selfDeaf:true
    });
    s.connection=connection;
    connection.subscribe(s.player);
    try{
      await entersState(connection,VoiceConnectionStatus.Ready,15000);
    }catch(e){
      if(s.connection===connection)s.connection=null;
      connection.destroy();
      throw e;
    }
    return s;
  })();

  s.connectionPromise=work;
  try{return await work;}
  finally{if(s.connectionPromise===work)s.connectionPromise=null;}
}
async function playNext(guildId,client){const s=sessions.get(guildId);if(!s||!s.queue.length){if(s)s.current=null;return;}const track=s.queue.shift();s.current=track;try{const stream=await play.stream(track.url,{quality:2,discordPlayerCompatibility:false});const resource=createAudioResource(stream.stream,{inputType:stream.type,inlineVolume:true});resource.volume?.setVolume(Math.max(0,Math.min(1.5,s.volume/100)));s.player.play(resource);if(s.textChannelId){const ch=client.channels.cache.get(s.textChannelId);if(ch?.isTextBased()&&cfg(client).music.announceNowPlaying)await ch.send({embeds:[embed(client,'Now Playing',`**${track.title}**\n${track.url}`)]}).catch(()=>{});}}catch(e){console.error('[Voice/Music]',e.message);s.current=null;await playNext(guildId,client);}}
function ensurePlayerHooks(guildId,client){const s=session(guildId);if(s._hooks)return;s._hooks=true;s.player.on(AudioPlayerStatus.Idle,()=>playNext(guildId,client).catch(e=>console.error('[Voice/Music]',e)));s.player.on('error',e=>{console.error('[Voice/Music]',e.message);playNext(guildId,client).catch(()=>{});});}
async function createTempRoom(member,client){const c=cfg(client).temporaryVoice||{};if(!c.enabled||!c.triggerChannelId||member.voice.channelId!==c.triggerChannelId)return null;const guild=member.guild;const name=String(c.nameTemplate||"{user}'s Room").replaceAll('{user}',member.displayName).replaceAll('{username}',member.user.username).slice(0,100);const options={name,type:ChannelType.GuildVoice,permissionOverwrites:[]};if(c.categoryId)options.parent=c.categoryId;if(Number(c.bitrate)>0)options.bitrate=Math.min(Number(c.bitrate),Number(c.maxBitrate)||384000);if(Number.isInteger(Number(c.userLimit))&&Number(c.userLimit)>=0)options.userLimit=Number(c.userLimit);const channel=await guild.channels.create(options);tempRooms.set(channel.id,{guildId:guild.id,voiceChannelId:channel.id,panelChannelId:null,panelMessageId:null,ownerId:member.id,createdAt:Date.now(),locked:!!c.defaultLocked,hidden:!!c.defaultHidden,accessUsers:new Set([member.id]),accessRoles:new Set(),controlUsers:new Set([member.id]),controlRoles:new Set(),bannedUsers:new Set(),tts:{},page:'overview',emptySince:null,recoveryGraceUntil:0});await channel.permissionOverwrites.edit(member.id,{Connect:true,Speak:true,ViewChannel:true});await tempPanel.create(client,member,channel,tempRooms.get(channel.id)).catch(e=>console.error(`[TempVC] Panel creation failed for ${channel.id}: ${e?.stack||e?.message||e}`));if(c.defaultLocked)await channel.permissionOverwrites.edit(guild.roles.everyone,{Connect:false});if(c.defaultHidden)await channel.permissionOverwrites.edit(guild.roles.everyone,{ViewChannel:false});await member.voice.setChannel(channel).catch(()=>{});return channel;}
function ownerOf(channelId){return tempRooms.get(channelId);}
const commands=[
{data:new SlashCommandBuilder().setName('play').setDescription('Play or queue music').addStringOption(o=>o.setName('query').setDescription('URL or search query').setRequired(true)),execute:async(i,client)=>{const c=cfg(client).music;if(!c.enabled)return i.reply({content:'Music is disabled.',flags:MessageFlags.Ephemeral});if(!i.member.voice.channel)return i.reply({content:'Join a voice channel first.',flags:MessageFlags.Ephemeral});const ttsRoom=[...tempRooms.values()].find(r=>r.guildId===i.guildId&&r.voiceChannelId===i.member.voice.channelId);if(ttsRoom?.ttsPlaying||ttsRoom?.ttsQueue?.length)return i.reply({content:'TTS is currently active in this voice room. Wait for it to finish before starting music.',flags:MessageFlags.Ephemeral});await i.deferReply();ensurePlayerHooks(i.guildId,client);const query=i.options.getString('query',true);let result;try{if(/^https?:\/\//i.test(query)){const info=await play.video_basic_info(query);result=[{title:info.video_details.title,url:info.video_details.url,duration:info.video_details.durationInSec||0}];}else{const found=await play.search(query,{limit:Math.max(1,Math.min(c.searchLimit||5,10)),source:{youtube:'video'}});result=found.map(x=>({title:x.title,url:x.url,duration:x.durationInSec||0}));}}catch(e){return i.editReply(`Music search failed: ${e.message}`);}if(!result?.length)return i.editReply('No results found.');const s=await connect(i.member,client);for(const track of result.slice(0,1)){if(track.duration>(c.maxTrackLengthSeconds||7200))continue;if(s.queue.length>=(c.maxQueueSize||100))break;s.queue.push(track);}s.textChannelId=i.channelId;const wasPlaying=!!s.current;await i.editReply(wasPlaying?`Queued **${result[0].title}**.`:`Starting **${result[0].title}**.`);if(!wasPlaying)await playNext(i.guildId,client);}},
{data:new SlashCommandBuilder().setName('skip').setDescription('Skip the current track'),execute:async(i,client)=>{const s=sessions.get(i.guildId);if(!s?.current)return i.reply({content:'Nothing is playing.',flags:MessageFlags.Ephemeral});s.player.stop(true);return i.reply('Skipped.');}},
{data:new SlashCommandBuilder().setName('stop').setDescription('Stop music and clear the queue'),execute:async(i)=>{const s=sessions.get(i.guildId);if(!s)return i.reply({content:'Nothing is playing.',flags:MessageFlags.Ephemeral});const ttsRoom=[...tempRooms.values()].find(r=>r.guildId===i.guildId&&r.ttsConnection===s.connection);s.queue=[];s.current=null;s.player.stop(true);if(ttsRoom?.ttsPlaying||ttsRoom?.ttsQueue?.length)return i.reply('Stopped music. TTS remains active.');s.connection?.destroy();sessions.delete(i.guildId);return i.reply('Stopped and cleared the queue.');}},
{data:new SlashCommandBuilder().setName('queue').setDescription('Show the music queue'),execute:async(i,client)=>{const s=sessions.get(i.guildId);return i.reply({embeds:[embed(client,'Music Queue',s?.queue?.length?s.queue.map((x,n)=>`${n+1}. **${x.title}**`).join('\n'):'The queue is empty.')]});}},
{data:new SlashCommandBuilder().setName('volume').setDescription('Set music volume').addIntegerOption(o=>o.setName('percent').setDescription('0-150').setRequired(true).setMinValue(0).setMaxValue(150)),execute:async(i,client)=>{const s=sessions.get(i.guildId);if(!s)return i.reply({content:'Nothing is playing.',flags:MessageFlags.Ephemeral});const max=cfg(client).music.maxVolume||150;s.volume=Math.min(i.options.getInteger('percent',true),max);return i.reply(`Volume set to **${s.volume}%**.`);}},
{data:new SlashCommandBuilder().setName('nowplaying').setDescription('Show the current track'),execute:async(i,client)=>{const s=sessions.get(i.guildId);return i.reply({embeds:[embed(client,'Now Playing',s?.current?`**${s.current.title}**\n${s.current.url}`:'Nothing is playing.')]});}},
{data:new SlashCommandBuilder().setName('vcpanel').setDescription('Open your temporary voice room control panel'),execute:async(i,client)=>{const c=cfg(client).temporaryVoice||{};const room=ownerOf(i.member.voice.channelId);if(!room)return i.reply({content:'You are not in a temporary voice room.',flags:MessageFlags.Ephemeral});if(c.panelEnabled===false||c.allowOwnerPanel===false)return i.reply({content:'The temporary VC control panel is disabled.',flags:MessageFlags.Ephemeral});if(!room.panelChannelId)return i.reply({content:'This room does not have a control panel.',flags:MessageFlags.Ephemeral});return i.reply({content:'Your temporary room panel is <#'+room.panelChannelId+'>.',flags:MessageFlags.Ephemeral});}}
];
const listeners=[
{event:'interactionCreate',handle:async(interaction,client)=>{const id=interaction.customId||'';if(id.startsWith('rn-tvc:')||id.startsWith('rn-tvc-modal:'))return tempPanel.handle(interaction,client,tempRooms);}},
{event:'messageCreate',handle:async(message,client)=>{if(message.author?.bot||!message.guild)return;const room=tempRooms.get(message.channelId);if(!room)return;const t=room.tts||{};if(t.enabled!==true||t.autoTts!==true)return;try{await require('./tts-service').speak(client,room,message.cleanContent,message.member);}catch(e){console.error('[TempVC/TTS Auto]',e?.message||e);}}},
{event:'channelUpdate',handle:async(oldChannel,newChannel,client)=>{if(newChannel?.type===ChannelType.GuildVoice)await tempPanel.channelUpdate(oldChannel,newChannel,client,tempRooms);}},
{event:'voiceStateUpdate',handle:async(oldState,newState,client)=>{
  const c=cfg(client).temporaryVoice||{};
  if(newState.channelId&&tempRooms.has(newState.channelId)&&newState.member&&!newState.member.user.bot){
    const room=tempRooms.get(newState.channelId);
    if(room?.bannedUsers?.has(newState.member.id)){
      await newState.member.voice.disconnect('Banned from temporary voice room').catch(()=>{});
      return;
    }
    if(room?.emptySince){
      room.emptySince=null;
      room.recoveryGraceUntil=0;
      await tempPanel.persistRoom(client,room).catch(()=>{});
    }
  }
  if(c.enabled&&newState.channelId===String(c.triggerChannelId||'')&&newState.member&&!newState.member.user.bot&&!creatingTempRooms.has(newState.member.id)){
    creatingTempRooms.add(newState.member.id);
    try{await createTempRoom(newState.member,client);}
    catch(e){console.error(`[TempVC] Failed to create room for ${newState.member.user.tag}: ${e?.stack||e?.message||e}`);}
    finally{creatingTempRooms.delete(newState.member.id);}
  }
  if(oldState.channelId&&tempRooms.has(oldState.channelId)){
    const room=tempRooms.get(oldState.channelId);
    if(room&&room.ownerId===oldState.member?.id&&newState.channelId!==oldState.channelId&&c.autoTransferOnOwnerLeave!==false&&oldState.channel?.members?.size>0){
      const next=[...oldState.channel.members.values()].filter(member=>member.id!==oldState.member?.id&&!member.user.bot&&!room.bannedUsers?.has(member.id)).sort((a,b)=>(a.joinedTimestamp||0)-(b.joinedTimestamp||0))[0];
      if(next){
        room.ownerId=next.id;
        room.accessUsers?.add(next.id);
        room.controlUsers?.add(next.id);
        await oldState.guild.channels.cache.get(room.voiceChannelId)?.permissionOverwrites.edit(next.id,{Connect:true,Speak:true,ViewChannel:true}).catch(()=>{});
        await oldState.guild.channels.cache.get(room.panelChannelId)?.permissionOverwrites.edit(next.id,{ViewChannel:true,ReadMessageHistory:true,SendMessages:false}).catch(()=>{});
        await tempPanel.refresh(client,room,'overview').catch(()=>{});
      }
    }
    if(oldState.channel?.members.size===0){
      room.emptySince=Date.now();
      room.recoveryGraceUntil=0;
      await tempPanel.persistRoom(client,room).catch(()=>{});
    }
  }
}}
];
const extra=[
{data:new SlashCommandBuilder().setName('vcname').setDescription('Rename your temporary voice room').addStringOption(o=>o.setName('name').setDescription('New name').setRequired(true)),execute:async(i,client)=>{const c=cfg(client).temporaryVoice||{};const room=ownerOf(i.member.voice.channelId);if(!room||room.ownerId!==i.user.id)return i.reply({content:'You do not own this room.',flags:MessageFlags.Ephemeral});if(c.allowOwnerRename===false)return i.reply({content:'Room renaming is disabled.',flags:MessageFlags.Ephemeral});await i.deferReply({flags:MessageFlags.Ephemeral});const name=i.options.getString('name',true).replace(/\s+/g,' ').trim().slice(0,100);if(!name)return i.editReply({content:'Room name cannot be empty.'});try{await i.member.voice.channel.setName(name);return i.editReply({content:'Room renamed.'});}catch(e){return i.editReply({content:'Could not rename the room.'}).catch(()=>{});}}},
{data:new SlashCommandBuilder().setName('vclimit').setDescription('Set your temporary voice room limit').addIntegerOption(o=>o.setName('limit').setDescription('0-99').setRequired(true).setMinValue(0).setMaxValue(99)),execute:async(i,client)=>{const c=cfg(client).temporaryVoice||{};const room=ownerOf(i.member.voice.channelId);if(!room||room.ownerId!==i.user.id)return i.reply({content:'You do not own this room.',flags:MessageFlags.Ephemeral});if(c.allowOwnerLimit===false)return i.reply({content:'Room user limits are disabled.',flags:MessageFlags.Ephemeral});await i.deferReply({flags:MessageFlags.Ephemeral});try{await i.member.voice.channel.setUserLimit(i.options.getInteger('limit',true));return i.editReply({content:'Room limit updated.'});}catch(e){return i.editReply({content:'Could not update the room limit.'}).catch(()=>{});}}}
];
module.exports={commands:[...commands,...extra,...ttsCommands.commands],listeners,initialize:async(client)=>{client.voiceRooms=tempRooms;client.voiceSessions=sessions;client.voiceTtsRooms=client.voiceTtsRooms||new Map();tempPanel.initialize(client,tempRooms);},destroy:async()=>{tempPanel.destroy();for(const s of sessions.values())s.connection?.destroy();sessions.clear();}};
