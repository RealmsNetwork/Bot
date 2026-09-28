const {SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder,MessageFlags}=require('discord.js');
const tts=require('./tts-service');
const tempPanel=require('./temp-panel');

const TTS_ROOM_TTL_MS = 30 * 60 * 1000;
const MAX_TTS_ROOMS = 1000;

function pruneRuntimeRooms(map, now = Date.now()) {
  if (!map?.size) return;
  for (const [id, room] of map) {
    const active=room.ttsPlaying===true||room.ttsPump||room.ttsQueue?.length;
    if (!active && now - Number(room.lastUsedAt || 0) > TTS_ROOM_TTL_MS) map.delete(id);
  }
  if (map.size <= MAX_TTS_ROOMS) return;
  for (const [id, room] of map) {
    if (map.size <= MAX_TTS_ROOMS) break;
    const active=room.ttsPlaying===true||room.ttsPump||room.ttsQueue?.length;
    if (!active) map.delete(id);
  }
}

function roomFor(i){
  const id=i.member?.voice?.channelId;
  return i.client.voiceRooms?.get(id)||i.client.voiceTtsRooms?.get(id)||null;
}

function clientTtsConfig(client){
  return client.modules.get('voice')?.config?.tts||{};
}

function canControlTts(i, room) {
  return tempPanel.canControlTts(i, room, i.client);
}

function controlConfigEnabled(i) {
  const moduleConfig = i.client.modules.get('voice')?.config || {};
  const c = moduleConfig.temporaryVoice || {};
  const ttsConfig = moduleConfig.tts || {};
  return ttsConfig.enabled !== false && c.allowOwnerTts !== false;
}

function voiceSelectionEnabled(i) {
  return i.client.modules.get('voice')?.config?.tts?.allowUserVoiceSelection !== false;
}

function runtimeRoom(i){
  const existing=roomFor(i);
  if(existing) {
    existing.lastUsedAt=Date.now();
    return existing;
  }
  const id=i.member?.voice?.channelId;
  if(!id)return null;
  const now=Date.now();
  i.client.voiceTtsRooms=i.client.voiceTtsRooms||new Map();
  pruneRuntimeRooms(i.client.voiceTtsRooms,now);
  if(!i.client.voiceTtsRooms.has(id))i.client.voiceTtsRooms.set(id,{guildId:i.guildId,voiceChannelId:id,ownerId:i.user.id,accessUsers:new Set([i.user.id]),accessRoles:new Set(),bannedUsers:new Set(),ttsBrowser:{kind:null,page:0},lastUsedAt:now});
  else i.client.voiceTtsRooms.get(id).lastUsedAt=now;
  return i.client.voiceTtsRooms.get(id);
}

async function speak(i,provider,text,extra={}){
  if(!i.deferred&&!i.replied)await i.deferReply({flags:MessageFlags.Ephemeral});
  const requestedProvider=provider==null||provider===''?undefined:String(provider);
  const requestedLang=extra.lang==null||extra.lang===''?undefined:String(extra.lang);
  const requestedVoice=extra.voice==null||extra.voice===''?undefined:String(extra.voice);
  const publicAudio = i.client.modules.get('voice')?.config?.tts?.allowPublicAudio !== false;
  const realRoom = roomFor(i);
  if(!i.member?.voice?.channelId)return i.editReply({content:'Join a voice channel first.'});
  if(!realRoom && !publicAudio)return i.editReply({content:'Public TTS is disabled for this voice channel.'});
  const room=runtimeRoom(i);
  if(!room)return i.editReply({content:'Join a voice channel first.'});
  if(!publicAudio && !canControlTts(i,room))return i.editReply({content:'Public TTS is disabled for this room.'});
  const canCustomizeVoice=voiceSelectionEnabled(i)&&controlConfigEnabled(i);
  if((requestedLang!==undefined||requestedVoice!==undefined)&&!canCustomizeVoice)
    return i.editReply({content:'You cannot change the voice or language here.'});
  try{
    await tts.speak(i.client,room,text,i.member,{provider:requestedProvider,lang:requestedLang,voice:requestedVoice});
    return i.editReply({content:'Speaking now.'});
  }catch(e){
    console.error('[TempVC/TTS] Command:',e?.stack||e);
    return i.editReply({content:'TTS failed. Please try again in a moment.'}).catch(()=>{});
  }
}

function pageButtons(prefix,page,total){
  return new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(prefix+'-first').setEmoji('⏮️').setStyle(ButtonStyle.Secondary).setDisabled(page===0),
    new ButtonBuilder().setCustomId(prefix+'-prev').setEmoji('◀️').setStyle(ButtonStyle.Primary).setDisabled(page===0),
    new ButtonBuilder().setCustomId(prefix+'-next').setEmoji('▶️').setStyle(ButtonStyle.Primary).setDisabled(page>=total-1),
    new ButtonBuilder().setCustomId(prefix+'-last').setEmoji('⏭️').setStyle(ButtonStyle.Secondary).setDisabled(page>=total-1)
  );
}

function languageFilter(list,filter){
  if(filter==='af')return list.filter(x=>/^[a-f]/i.test(x.name));
  if(filter==='gl')return list.filter(x=>/^[g-l]/i.test(x.name));
  if(filter==='mr')return list.filter(x=>/^[m-r]/i.test(x.name));
  if(filter==='sz')return list.filter(x=>/^[s-z]/i.test(x.name));
  return list;
}

async function languageBrowser(i){
  await i.deferReply({flags:MessageFlags.Ephemeral});
  let all=[];
  try{all=await tts.listLanguages();}catch(e){return i.editReply('Could not load the languages right now. Please try again.');}
  let filter='all',page=0;
  const per=5;
  const filterMenu=()=>new ActionRowBuilder().addComponents(new StringSelectMenuBuilder().setCustomId('rn-tts-lang-filter').setPlaceholder('Filter languages...').addOptions([
    {label:'All',value:'all'},
    {label:'A-F',value:'af'},
    {label:'G-L',value:'gl'},
    {label:'M-R',value:'mr'},
    {label:'S-Z',value:'sz'}
  ]));
  const render=()=>{
    const filtered=languageFilter(all,filter);
    const total=Math.max(1,Math.ceil(filtered.length/per));
    page=Math.min(page,total-1);
    const items=filtered.slice(page*per,page*per+per);
    return {
      embeds:[new EmbedBuilder().setColor(0x8b5cf6).setTitle('Languages').setDescription(items.length?items.map(x=>x.name+' • '+x.code).join('\\n\\n'):'No languages found.').setFooter({text:'Page '+(page+1)+' of '+total+' • '+filtered.length+' languages'})],
      components:[filterMenu(),pageButtons('rn-tts-lang',page,total)]
    };
  };
  const msg=await i.editReply(render());
  const collector=msg.createMessageComponentCollector({time:120000});
  collector.on('collect',async x=>{
    if(x.user.id!==i.user.id)return x.reply({content:'Use /langs to open your own menu.',flags:MessageFlags.Ephemeral});
    if(x.isStringSelectMenu())filter=x.values[0],page=0;
    else {
      const filtered=languageFilter(all,filter),total=Math.max(1,Math.ceil(filtered.length/per));
      if(x.customId==='rn-tts-lang-first')page=0;
      if(x.customId==='rn-tts-lang-prev')page=Math.max(0,page-1);
      if(x.customId==='rn-tts-lang-next')page=Math.min(total-1,page+1);
      if(x.customId==='rn-tts-lang-last')page=total-1;
    }
    await x.update(render()).catch(e => console.error('[TempVC/TTS] Browser update:', e?.message || e));
  });
  collector.on('end',async()=>{await i.editReply({components:[]}).catch(()=>{});});
}

async function voiceBrowser(i){
  await i.deferReply({flags:MessageFlags.Ephemeral});
  let all=[];
  try{all=await tts.listVoices();}catch(e){return i.editReply('Could not load the voices right now. Please try again.');}
  let page=0;
  const per=5;
  const render=()=>{
    const total=Math.max(1,Math.ceil(all.length/per));
    page=Math.min(page,total-1);
    const items=all.slice(page*per,page*per+per);
    const text=items.length?items.map(v=>String(v.ShortName||v.Name)+' • '+String(v.Locale||'')+' • '+String(v.Gender||'')).join('\\n\\n'):'No voices found.';
    return {embeds:[new EmbedBuilder().setColor(0x8b5cf6).setTitle('Voices').setDescription(text).setFooter({text:'Page '+(page+1)+' of '+total+' • '+all.length+' voices'})],components:[pageButtons('rn-tts-voice',page,total)]};
  };
  const msg=await i.editReply(render());
  const collector=msg.createMessageComponentCollector({time:120000});
  collector.on('collect',async x=>{
    if(x.user.id!==i.user.id)return x.reply({content:'Use /voices to open your own menu.',flags:MessageFlags.Ephemeral});
    const total=Math.max(1,Math.ceil(all.length/per));
    if(x.customId==='rn-tts-voice-first')page=0;
    if(x.customId==='rn-tts-voice-prev')page=Math.max(0,page-1);
    if(x.customId==='rn-tts-voice-next')page=Math.min(total-1,page+1);
    if(x.customId==='rn-tts-voice-last')page=total-1;
    await x.update(render()).catch(e => console.error('[TempVC/TTS] Browser update:', e?.message || e));
  });
  collector.on('end',async()=>{await i.editReply({components:[]}).catch(()=>{});});
}

async function setLanguage(i){if(!i.deferred&&!i.replied)await i.deferReply({flags:MessageFlags.Ephemeral});const r=roomFor(i);if(!r)return i.editReply({content:'Join your temporary voice room first.'});if(!controlConfigEnabled(i)||!voiceSelectionEnabled(i)||!canControlTts(i,r))return i.editReply({content:'You cannot change the voice settings for this room.'});const value=i.options.getString('language',true);try{const list=await tts.listLanguages();const match=list.find(x=>x.code.toLowerCase()===value.toLowerCase()||x.name.toLowerCase()===value.toLowerCase());if(!match)return i.editReply({content:'That language was not found. Try /langs.'});r.tts=tts.settingsFor(r,i.client);r.tts.provider='google';r.tts.lang=match.code;if(!(await tempPanel.persistRoom(i.client,r)))return i.editReply({content:'Could not save that change. Please try again.'});return i.editReply({content:'Language set to **'+match.name+'**.'});}catch(e){return i.editReply({content:'Could not change the language right now. Please try again.'});}}

const commands=[
  {data:new SlashCommandBuilder().setName('tts').setDescription('Speak text out loud').addStringOption(o=>o.setName('text').setDescription('Text to speak').setRequired(true)).addStringOption(o=>o.setName('provider').setDescription('Voice style').addChoices({name:'Natural',value:'edge'},{name:'Classic',value:'google'},{name:'Alternate',value:'polly'})).addStringOption(o=>o.setName('lang').setDescription('Language')).addStringOption(o=>o.setName('voice').setDescription('Voice name')),execute:async i=>speak(i,i.options.getString('provider'),i.options.getString('text',true),{lang:i.options.getString('lang'),voice:i.options.getString('voice')})},
  {data:new SlashCommandBuilder().setName('google').setDescription('Speak in your voice channel').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addStringOption(o=>o.setName('lang').setDescription('Language')),execute:async i=>speak(i,'google',i.options.getString('text',true),{lang:i.options.getString('lang')||undefined})},
  {data:new SlashCommandBuilder().setName('polly').setDescription('Speak in your voice channel').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addStringOption(o=>o.setName('voice').setDescription('Voice name')),execute:async i=>speak(i,'polly',i.options.getString('text',true),{voice:i.options.getString('voice')||undefined})},
  {data:new SlashCommandBuilder().setName('autotts').setDescription('Enable or disable AutoTTS for your temporary room').addBooleanOption(o=>o.setName('enabled').setDescription('Enable AutoTTS').setRequired(true)),execute:async i=>{await i.deferReply({flags:MessageFlags.Ephemeral});const r=roomFor(i);if(!r)return i.editReply({content:'Join your temporary voice room first.'});if(!controlConfigEnabled(i)||!canControlTts(i,r))return i.editReply({content:'You do not have permission to change TTS settings for this room.'});r.tts=tts.settingsFor(r,i.client);r.tts.autoTts=i.options.getBoolean('enabled',true);if(!(await tempPanel.persistRoom(i.client,r)))return i.editReply({content:'Could not save that change. Please try again.'});return i.editReply({content:'AutoTTS '+(r.tts.autoTts?'enabled':'disabled')+' for this room.'});}},
  {data:new SlashCommandBuilder().setName('autottsprovider').setDescription('Choose the AutoTTS voice').addStringOption(o=>o.setName('provider').setDescription('Voice style').setRequired(true).addChoices({name:'Natural',value:'edge'},{name:'Classic',value:'google'},{name:'Alternate',value:'polly'})),execute:async i=>{await i.deferReply({flags:MessageFlags.Ephemeral});const r=roomFor(i);if(!r)return i.editReply({content:'Join your temporary voice room first.'});if(!controlConfigEnabled(i)||!canControlTts(i,r))return i.editReply({content:'You do not have permission to change TTS settings for this room.'});r.tts=tts.settingsFor(r,i.client);r.tts.provider=i.options.getString('provider',true);if(!(await tempPanel.persistRoom(i.client,r)))return i.editReply({content:'Could not save that change. Please try again.'});return i.editReply({content:'AutoTTS voice style updated.'});}},
  {data:new SlashCommandBuilder().setName('ttslangs').setDescription('Browse languages'),execute:languageBrowser},
  {data:new SlashCommandBuilder().setName('langs').setDescription('Browse languages'),execute:languageBrowser},
  {data:new SlashCommandBuilder().setName('ttsvoices').setDescription('Browse voices'),execute:voiceBrowser},
  {data:new SlashCommandBuilder().setName('voices').setDescription('Browse voices'),execute:voiceBrowser},
  {data:new SlashCommandBuilder().setName('lang').setDescription('Set your room language').addStringOption(o=>o.setName('language').setDescription('Language name or code').setRequired(true)),execute:setLanguage},
  {data:new SlashCommandBuilder().setName('voice').setDescription('Change your voice').addStringOption(o=>o.setName('voice').setDescription('Voice').setRequired(true)),execute:async i=>{if(!i.deferred&&!i.replied)await i.deferReply({flags:MessageFlags.Ephemeral});const r=roomFor(i);if(!r)return i.editReply({content:'Join your temporary voice room first.'});if(!controlConfigEnabled(i)||!voiceSelectionEnabled(i)||!canControlTts(i,r))return i.editReply({content:'You cannot change the voice settings for this room.'});const name=i.options.getString('voice',true);try{const list=await tts.listVoices();const v=list.find(x=>(x.ShortName||x.Name)===name);if(!v)return i.editReply({content:'That voice was not found. Try /voices.'});r.tts=tts.settingsFor(r,i.client);r.tts.provider='edge';r.tts.voice=name;r.tts.lang=v.Locale||r.tts.lang;if(!(await tempPanel.persistRoom(i.client,r)))return i.editReply({content:'The setting changed in memory but could not be safely saved. Please try again.'});return i.editReply({content:'Voice set to **'+name+'**.'});}catch(e){return i.editReply({content:'Could not change your voice right now. Please try again.'});}}}
];


const autoCommand=commands.find(x=>x.data.name==='autotts');
if(autoCommand){
  autoCommand.data.setDescription('Enable or disable AutoTTS for your voice channel');
  autoCommand.execute=async i=>{
    await i.deferReply({flags:MessageFlags.Ephemeral});
    const room=roomFor(i)||runtimeRoom(i);
    if(!room)return i.editReply({content:'Join a voice channel first.'});
    if(!controlConfigEnabled(i)||!canControlTts(i,room))
      return i.editReply({content:'You do not have permission to change TTS settings for this voice channel.'});
    room.tts=tts.settingsFor(room,i.client);
    room.tts.autoTts=i.options.getBoolean('enabled',true);
    room.tts.autoTtsAnyTextChannel=clientTtsConfig(i.client).autoTtsAnyTextChannel===true;
    room.tts.autoTtsChannelId=i.channelId;
    room.lastUsedAt=Date.now();
    if (room.voiceChannelId && i.client.voiceTtsRooms?.has(room.voiceChannelId)) {
      i.client.voiceTtsRooms.set(room.voiceChannelId, room);
    }
    const saved=await tempPanel.persistRoom(i.client,room).catch(()=>true);
    if(!saved)return i.editReply({content:'AutoTTS changed in memory but could not be saved.'});
    return i.editReply({content:'AutoTTS '+(room.tts.autoTts?'enabled':'disabled')+' for '+(room.tts.autoTtsAnyTextChannel===true?'this voice channel.':'this text channel.')});
  };
}

let leaveTimer=null;
const emptySince=new Map();

async function leaveEmptyTtsRooms(client){
  const configured=Number(client.modules.get('voice')?.config?.music?.leaveDelaySeconds);
  const delay=Math.max(30,Number.isFinite(configured)&&configured>0?configured:180)*1000;
  const rooms=[...(client.voiceTtsRooms?.values?.()||[]),...(client.voiceRooms?.values?.()||[])];
  for(const room of rooms){
    const connection=room?.ttsConnection;
    if(!connection)continue;
    const session=client.voiceSessions?.get(room.guildId);
    if(session?.connection===connection)continue;
    const guild=client.guilds.cache.get(room.guildId);
    const channel=guild?.channels?.cache.get(room.voiceChannelId);
    if(!channel)continue;
    const humans=channel.members.filter(m=>!m.user.bot).size;
    const key=String(room.guildId)+':'+String(room.voiceChannelId);
    if(humans>0){emptySince.delete(key);continue;}
    if(!emptySince.has(key))emptySince.set(key,Date.now());
    if(Date.now()-emptySince.get(key)<delay)continue;
    try{await tts.stop(room,client);}catch{}
    try{connection.destroy?.();}catch{}
    if(room.ttsConnection===connection)room.ttsConnection=null;
    emptySince.delete(key);
  }
}

const listeners=[
  {event:'messageCreate',handle:async(message,client)=>{
    if(message.author?.bot||!message.guild||!message.member)return;
    const voiceId=message.member.voice?.channelId;
    if(!voiceId)return;

    // AutoTTS is supported in both TempVCs and normal voice channels.
    const room=client.voiceRooms?.get(voiceId)||client.voiceTtsRooms?.get(voiceId);
    if(!room?.tts?.autoTts)return;

    const allowed=room.tts.autoTtsAnyTextChannel===true||!room.tts.autoTtsChannelId||room.tts.autoTtsChannelId===message.channelId;
    if(!allowed)return;

    const content=String(message.cleanContent||'').trim();
    if(!content)return;
    try{
      room.lastUsedAt=Date.now();
      await tts.speak(client,room,content,message.member);
    }catch(e){console.error('[Voice/TTS Auto]',e?.stack||e);}
  }}
];

async function initialize(client){
  if(leaveTimer)clearInterval(leaveTimer);
  leaveTimer=setInterval(()=>leaveEmptyTtsRooms(client).catch(e=>console.error('[Voice/TTS] Auto leave:',e?.message||e)),5000);
  leaveTimer.unref?.();
}

async function destroy(){
  if(leaveTimer)clearInterval(leaveTimer);
  leaveTimer=null;
  emptySince.clear();
}

module.exports={commands ,listeners,initialize,destroy};
