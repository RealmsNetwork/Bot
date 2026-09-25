const { createHash } = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { Readable } = require('node:stream');
const {
  createAudioPlayer,
  createAudioResource,
  AudioPlayerStatus,
  VoiceConnectionStatus,
  joinVoiceChannel,
  entersState,
  StreamType
} = require('@discordjs/voice');
const { EdgeTTS } = require('node-edge-tts');

const TRUSTED_CLIENT_TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM_FULL_VERSION = '143.0.3650.75';
const VOICE_LIST_URL = 'https://speech.platform.bing.com/consumer/speech/synthesize/readaloud/voices/list?trustedclienttoken=' + TRUSTED_CLIENT_TOKEN;
const GOOGLE_LANG_URL = 'https://translate.googleapis.com/translate_a/l?client=gtx&hl=en';
const GOOGLE_TTS_URL = 'https://translate.google.com/translate_tts';
const POLLY_TTS_URL = 'https://api.streamelements.com/kappa/v2/speech';
const cache = { at: 0, voices: [] };
const languageCache = { at: 0, values: [] };

function secMsGec() {
  const ticks = BigInt(Math.floor(Date.now() / 1000) + 11644473600) * 10000000n;
  const rounded = ticks - (ticks % 3000000000n);
  return createHash('sha256').update(String(rounded) + TRUSTED_CLIENT_TOKEN, 'ascii').digest('hex').toUpperCase();
}

async function listVoices(force = false) {
  if (!force && cache.voices.length && Date.now() - cache.at < 21600000) return cache.voices;
  const url = VOICE_LIST_URL + '&Sec-MS-GEC=' + secMsGec() + '&Sec-MS-GEC-Version=1-' + CHROMIUM_FULL_VERSION;
  const r = await fetch(url, {
    headers: {
      Accept: '*/*',
      'Accept-Language': 'en-US,en;q=0.9',
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/' +
        CHROMIUM_FULL_VERSION.split('.')[0] + '.0.0.0 Safari/537.36 Edg/' + CHROMIUM_FULL_VERSION.split('.')[0] + '.0.0.0'
    }
  });
  if (!r.ok) throw new Error('Edge voices API HTTP ' + r.status);
  const data = await r.json();
  cache.voices = Array.isArray(data) ? data.filter(v => v?.ShortName || v?.Name) : [];
  cache.at = Date.now();
  return cache.voices;
}

function languageList(voices) {
  const map = new Map();
  for (const v of voices || []) {
    const locale = String(v.Locale || '').trim();
    const code = locale.split('-')[0].toLowerCase();
    if (!code) continue;
    if (!map.has(code)) map.set(code, { code, name: String(v.LocaleName || code.toUpperCase()), locales: new Set() });
    map.get(code).locales.add(locale);
  }
  return [...map.values()]
    .map(x => ({ ...x, locales: [...x.locales].sort() }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function listLanguages(force = false) {
  if (!force && languageCache.values.length && Date.now() - languageCache.at < 21600000) return languageCache.values;
  const r = await fetch(GOOGLE_LANG_URL, { headers: { 'user-agent': 'RealmsNetwork-Bot/0.2', accept: 'application/json,*/*' } });
  if (!r.ok) throw new Error('Google language API HTTP ' + r.status);
  const data = await r.json();
  languageCache.values = Object.entries(data || {})
    .map(([code, name]) => ({ code: String(code), name: String(name) }))
    .filter(x => x.code && x.name)
    .sort((a, b) => a.name.localeCompare(b.name));
  languageCache.at = Date.now();
  return languageCache.values;
}

function rateValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 100) return 'default';
  return (n > 100 ? '+' : '') + (n - 100) + '%';
}

function volumeValue(value) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 100) return 'default';
  return (n > 100 ? '+' : '') + (n - 100) + '%';
}

async function synthesizeEdge(text, file, settings = {}) {
  const tts = new EdgeTTS({
    voice: settings.voice || 'en-US-AriaNeural',
    lang: settings.lang || 'en-US',
    outputFormat: settings.outputFormat || 'audio-24khz-96kbitrate-mono-mp3',
    rate: rateValue(settings.rate),
    pitch: settings.pitch || 'default',
    volume: volumeValue(settings.volume),
    timeout: Math.max(5000, Number(settings.timeout || 15000))
  });
  await tts.ttsPromise(String(text), file);
  return file;
}

async function remoteStream(url) {
  const r = await fetch(url, { headers: { 'user-agent': 'RealmsNetwork-Bot/0.2' } });
  if (!r.ok) throw new Error('TTS API HTTP ' + r.status);
  if (!r.body) throw new Error('TTS API returned no audio body');
  if (typeof Readable.fromWeb === 'function') return Readable.fromWeb(r.body);
  return Readable.from(Buffer.from(await r.arrayBuffer()));
}

async function setBotMute(client,room,mute){try{const guild=client.guilds.cache.get(room.guildId);const me=await guild?.members.fetchMe().catch(()=>guild?.members.me);if(!me?.voice?.channelId||me.voice.channelId!==room.voiceChannelId)return false;if(me.voice.serverMute!==mute)await me.voice.setMute(mute,'Room TTS '+(mute?'idle':'speaking'));return true;}catch(e){console.error('[TempVC/TTS] Bot mute:',e?.message||e);return false;}}

function ensurePlayer(room,client) {
  if (room.ttsPlayer) return room.ttsPlayer;
  room.ttsPlayer = createAudioPlayer();
  room.ttsQueue = [];
  room.ttsPlaying = false;
  room.ttsPlayer.on(AudioPlayerStatus.Idle, () => {
    room.ttsPlaying = false;
    playNext(room).catch(e => console.error('[TempVC/TTS]', e?.stack || e));
  });
  room.ttsPlayer.on('error', e => {
    console.error('[TempVC/TTS] Player:', e?.message || e);
    room.ttsPlaying = false;
    room.ttsQueue?.shift();
    playNext(room,client).catch(() => {});
  });
  return room.ttsPlayer;
}

async function ensureConnection(client, room) {
  const guild = client.guilds.cache.get(room.guildId);
  const channel = guild?.channels.cache.get(room.voiceChannelId);
  if (!guild || !channel) throw new Error('Temporary voice room no longer exists.');
  let connection = client.voiceSessions?.get(guild.id)?.connection || room.ttsConnection;
  if (connection?.joinConfig?.channelId !== channel.id) {
    if (connection) connection.destroy();
    connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: guild.id,
      adapterCreator: guild.voiceAdapterCreator,
      selfDeaf: true,
      selfMute: false
    });
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    const session = client.voiceSessions?.get(guild.id);
    if (session) session.connection = connection;
  }
  room.ttsConnection = connection;
  return connection;
}

function settingsFor(room, client) {
  const c = client.modules.get('voice')?.config?.tts || {};
  room.tts = room.tts && typeof room.tts === 'object' ? room.tts : {};
  if (!room.tts.provider) room.tts.provider = c.provider || 'edge';
  if (!room.tts.voice) room.tts.voice = c.defaultVoice || 'en-US-AriaNeural';
  if (!room.tts.lang) room.tts.lang = c.defaultLanguage || 'en-US';
  if (!Number.isFinite(Number(room.tts.rate))) room.tts.rate = 100;
  if (!Number.isFinite(Number(room.tts.volume))) room.tts.volume = Number(c.maxVolume || 100);
  if (room.tts.enabled === undefined) room.tts.enabled = c.enabled !== false;
  if (room.tts.autoTts === undefined) room.tts.autoTts = false;
  if (room.tts.prefixName === undefined) room.tts.prefixName = true;
  return room.tts;
}

async function playNext(room,client) {
  if (!room.ttsQueue?.length) {
    room.ttsPlaying = false;
    return;
  }
  const item = room.ttsQueue[0];
  try {
    let resource;
    let file = null;
    if (item.settings.provider === 'edge') {
      const dir = path.join(__dirname, '../../data/tts');
      fs.mkdirSync(dir, { recursive: true });
      file = path.join(dir, room.guildId + '-' + room.voiceChannelId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mp3');
      await synthesizeEdge(item.text, file, item.settings);
      resource = createAudioResource(file, { inputType: StreamType.Arbitrary });
    } else if (item.settings.provider === 'google') {
      const text = encodeURIComponent(item.text.slice(0, 200));
      const lang = encodeURIComponent(item.settings.lang || 'en');
      resource = createAudioResource(await remoteStream(GOOGLE_TTS_URL + '?ie=UTF-8&q=' + text + '&tl=' + lang + '&client=tw-ob'), { inputType: StreamType.Arbitrary });
    } else if (item.settings.provider === 'polly') {
      resource = createAudioResource(await remoteStream(POLLY_TTS_URL + '?voice=' + encodeURIComponent(item.settings.voice || 'Brian') + '&text=' + encodeURIComponent(item.text.slice(0, 200))), { inputType: StreamType.Arbitrary });
    } else {
      throw new Error('Unsupported TTS provider: ' + item.settings.provider);
    }
    if (!room.ttsConnection || room.ttsConnection.state.status === VoiceConnectionStatus.Destroyed) throw new Error('Voice connection is unavailable.');
    ensurePlayer(room,client);
    await setBotMute(client,room,false);
    room.ttsConnection.subscribe(room.ttsPlayer);
    room.ttsPlaying = true;
    room.ttsPlayer.play(resource);
    if (file) setTimeout(() => fs.rm(file, { force: true }, () => {}), 120000);
  } catch (e) {
    console.error('[TempVC/TTS] Synthesis:', e?.stack || e?.message || e);
    room.ttsQueue.shift();
    room.ttsPlaying = false;
    await playNext(room);
    return;
  }
  room.ttsQueue.shift();
}

async function speak(client, room, text, member) {
  const settings = { ...settingsFor(room, client) };
  if (settings.enabled === false) throw new Error('TTS is disabled for this room.');
  let phrase = String(text || '').replace(/\s+/g, ' ').trim();
  if (!phrase) throw new Error('TTS text cannot be empty.');
  const max = Math.max(20, Number(client.modules.get('voice')?.config?.tts?.maxCharacters || 500));
  phrase = phrase.slice(0, max);
  if (settings.prefixName && member?.displayName) phrase = member.displayName + ' says ' + phrase;
  await ensureConnection(client, room);
  ensurePlayer(room,client);
  room.ttsQueue.push({ text: phrase, settings });
  if (!room.ttsPlaying) await playNext(room,client);
}

async function stop(room,client) {
  if (!room) return false;
  room.ttsQueue = [];
  room.ttsPlaying = false;
  room.ttsPlayer?.stop(true);
  try{const guild=client?.guilds?.cache?.get(room.guildId);const me=await guild?.members.fetchMe().catch(()=>guild?.members.me);if(me?.voice?.channelId===room.voiceChannelId&&me.voice.serverMute!==true)await me.voice.setMute(true,'Room TTS stopped');}catch{}
  return true;
}

module.exports = {
  listVoices,
  listLanguages,
  languageList,
  synthesize: synthesizeEdge,
  settingsFor,
  speak,
  stop,
  rateValue,
  volumeValue
};
