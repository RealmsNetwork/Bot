const {SlashCommandBuilder,EmbedBuilder,ActionRowBuilder,ButtonBuilder,ButtonStyle,StringSelectMenuBuilder}=require('discord.js');
const tts=require('./tts-service');

function roomFor(i){
  return i.client.voiceRooms?.get(i.member?.voice?.channelId)||null;
}

function runtimeRoom(i){
  const existing=roomFor(i);
  if(existing)return existing;
  const id=i.member?.voice?.channelId;
  if(!id)return null;
  i.client.voiceTtsRooms=i.client.voiceTtsRooms||new Map();
  if(!i.client.voiceTtsRooms.has(id))i.client.voiceTtsRooms.set(id,{guildId:i.guildId,voiceChannelId:id,ownerId:i.user.id,accessUsers:new Set([i.user.id]),accessRoles:new Set(),bannedUsers:new Set(),ttsBrowser:{kind:null,page:0}});
  return i.client.voiceTtsRooms.get(id);
}

async function speak(i,provider,text,extra={}){
  if(!i.deferred&&!i.replied)await i.deferReply({ephemeral:true});
  const room=runtimeRoom(i);
  if(!room)return i.editReply({content:'Join a voice channel first.'});
  room.tts=tts.settingsFor(room,i.client);
  room.tts.provider=provider;
  if(extra.lang)room.tts.lang=extra.lang;
  if(extra.voice)room.tts.voice=extra.voice;
  try{
    await tts.speak(i.client,room,text,i.member);
    return i.editReply({content:'Speaking now.'});
  }catch(e){
    return i.editReply({content:'TTS failed: '+(e?.message||e)}).catch(()=>{});
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
  await i.deferReply({ephemeral:true});
  let all=[];
  try{all=await tts.listLanguages();}catch(e){return i.editReply('Could not load the language API: '+e.message);}
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
      embeds:[new EmbedBuilder().setColor(0x8b5cf6).setTitle('Available Google TTS Languages').setDescription(items.length?items.map(x=>x.name+' • '+x.code).join('\\n\\n'):'No languages found.').setFooter({text:'Page '+(page+1)+' of '+total+' • '+filtered.length+' languages'})],
      components:[filterMenu(),pageButtons('rn-tts-lang',page,total)]
    };
  };
  const msg=await i.editReply(render());
  const collector=msg.createMessageComponentCollector({time:120000});
  collector.on('collect',async x=>{
    if(x.user.id!==i.user.id)return x.reply({content:'Run /ttslangs to browse your own menu.',ephemeral:true});
    if(x.isStringSelectMenu())filter=x.values[0],page=0;
    else {
      const filtered=languageFilter(all,filter),total=Math.max(1,Math.ceil(filtered.length/per));
      if(x.customId==='rn-tts-lang-first')page=0;
      if(x.customId==='rn-tts-lang-prev')page=Math.max(0,page-1);
      if(x.customId==='rn-tts-lang-next')page=Math.min(total-1,page+1);
      if(x.customId==='rn-tts-lang-last')page=total-1;
    }
    await x.update(render());
  });
  collector.on('end',async()=>{await i.editReply({components:[]}).catch(()=>{});});
}

async function voiceBrowser(i){
  await i.deferReply({ephemeral:true});
  let all=[];
  try{all=await tts.listVoices();}catch(e){return i.editReply('Could not load the Edge voice API: '+e.message);}
  let page=0;
  const per=5;
  const render=()=>{
    const total=Math.max(1,Math.ceil(all.length/per));
    page=Math.min(page,total-1);
    const items=all.slice(page*per,page*per+per);
    const text=items.length?items.map(v=>String(v.ShortName||v.Name)+' • '+String(v.Locale||'')+' • '+String(v.Gender||'')).join('\\n\\n'):'No voices found.';
    return {embeds:[new EmbedBuilder().setColor(0x8b5cf6).setTitle('Available Edge TTS Voices').setDescription(text).setFooter({text:'Page '+(page+1)+' of '+total+' • '+all.length+' voices'})],components:[pageButtons('rn-tts-voice',page,total)]};
  };
  const msg=await i.editReply(render());
  const collector=msg.createMessageComponentCollector({time:120000});
  collector.on('collect',async x=>{
    if(x.user.id!==i.user.id)return x.reply({content:'Run /ttsvoices to browse your own menu.',ephemeral:true});
    const total=Math.max(1,Math.ceil(all.length/per));
    if(x.customId==='rn-tts-voice-first')page=0;
    if(x.customId==='rn-tts-voice-prev')page=Math.max(0,page-1);
    if(x.customId==='rn-tts-voice-next')page=Math.min(total-1,page+1);
    if(x.customId==='rn-tts-voice-last')page=total-1;
    await x.update(render());
  });
  collector.on('end',async()=>{await i.editReply({components:[]}).catch(()=>{});});
}

async function setLanguage(i){if(!i.deferred&&!i.replied)await i.deferReply({ephemeral:true});const r=runtimeRoom(i);if(!r)return i.editReply({content:'Join a voice channel first.'});const value=i.options.getString('language',true);try{const list=await tts.listLanguages();const match=list.find(x=>x.code.toLowerCase()===value.toLowerCase()||x.name.toLowerCase()===value.toLowerCase());if(!match)return i.editReply({content:'That Google language was not found. Use /ttslangs.'});r.tts=tts.settingsFor(r,i.client);r.tts.provider='google';r.tts.lang=match.code;return i.editReply({content:'Google TTS language set to **'+match.name+'** ('+match.code+').'});}catch(e){return i.editReply({content:'Language lookup failed: '+e.message});}}

const commands=[
  {data:new SlashCommandBuilder().setName('tts').setDescription('Speak text using the selected TTS provider').addStringOption(o=>o.setName('text').setDescription('Text to speak').setRequired(true)).addStringOption(o=>o.setName('provider').setDescription('TTS provider').addChoices({name:'Microsoft Edge',value:'edge'},{name:'Google',value:'google'},{name:'StreamElements / Polly',value:'polly'})).addStringOption(o=>o.setName('lang').setDescription('Language / locale code')).addStringOption(o=>o.setName('voice').setDescription('Voice name')),execute:async i=>speak(i,i.options.getString('provider')||'edge',i.options.getString('text',true),{lang:i.options.getString('lang'),voice:i.options.getString('voice')})},
  {data:new SlashCommandBuilder().setName('google').setDescription('Play Google TTS in your voice channel').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addStringOption(o=>o.setName('lang').setDescription('Google language code')),execute:async i=>speak(i,'google',i.options.getString('text',true),{lang:i.options.getString('lang')||'en'})},
  {data:new SlashCommandBuilder().setName('polly').setDescription('Play Polly-compatible TTS in your voice channel').addStringOption(o=>o.setName('text').setDescription('Text').setRequired(true)).addStringOption(o=>o.setName('voice').setDescription('Voice name')),execute:async i=>speak(i,'polly',i.options.getString('text',true),{voice:i.options.getString('voice')||'Brian'})},
  {data:new SlashCommandBuilder().setName('autotts').setDescription('Enable or disable AutoTTS for your temporary room').addBooleanOption(o=>o.setName('enabled').setDescription('Enable AutoTTS').setRequired(true)),execute:async i=>{await i.deferReply({ephemeral:true});const r=roomFor(i);if(!r)return i.editReply({content:'Join your temporary voice room first.'});r.tts=tts.settingsFor(r,i.client);r.tts.autoTts=i.options.getBoolean('enabled',true);return i.editReply({content:'AutoTTS '+(r.tts.autoTts?'enabled':'disabled')+' for this room.'});}},
  {data:new SlashCommandBuilder().setName('autottsprovider').setDescription('Choose the AutoTTS provider').addStringOption(o=>o.setName('provider').setDescription('Provider').setRequired(true).addChoices({name:'Microsoft Edge',value:'edge'},{name:'Google',value:'google'},{name:'StreamElements / Polly',value:'polly'})),execute:async i=>{await i.deferReply({ephemeral:true});const r=roomFor(i);if(!r)return i.editReply({content:'Join your temporary voice room first.'});r.tts=tts.settingsFor(r,i.client);r.tts.provider=i.options.getString('provider',true);return i.editReply({content:'AutoTTS provider set to **'+r.tts.provider+'**.'});}},
  {data:new SlashCommandBuilder().setName('ttslangs').setDescription('Browse Google TTS languages'),execute:languageBrowser},
  {data:new SlashCommandBuilder().setName('langs').setDescription('Browse Google TTS languages'),execute:languageBrowser},
  {data:new SlashCommandBuilder().setName('ttsvoices').setDescription('Browse Edge TTS voices'),execute:voiceBrowser},
  {data:new SlashCommandBuilder().setName('voices').setDescription('Browse Edge TTS voices'),execute:voiceBrowser},
  {data:new SlashCommandBuilder().setName('lang').setDescription('Set your room Google TTS language').addStringOption(o=>o.setName('language').setDescription('Language name or code').setRequired(true)),execute:setLanguage},
  {data:new SlashCommandBuilder().setName('voice').setDescription('Set the Edge TTS voice').addStringOption(o=>o.setName('voice').setDescription('Edge voice short name').setRequired(true)),execute:async i=>{if(!i.deferred&&!i.replied)await i.deferReply({ephemeral:true});const r=runtimeRoom(i);if(!r)return i.editReply({content:'Join a voice channel first.'});const name=i.options.getString('voice',true);try{const list=await tts.listVoices();const v=list.find(x=>(x.ShortName||x.Name)===name);if(!v)return i.editReply({content:'That Edge voice was not found. Use /ttsvoices.'});r.tts=tts.settingsFor(r,i.client);r.tts.provider='edge';r.tts.voice=name;r.tts.lang=v.Locale||r.tts.lang;return i.editReply({content:'Edge TTS voice set to **'+name+'**.'});}catch(e){return i.editReply({content:'Voice lookup failed: '+e.message});}}}
];

module.exports={commands};
