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
const MAX_AUDIO_BYTES = 8 * 1024 * 1024;
const MAX_REMOTE_BYTES = 8 * 1024 * 1024;
const DEFAULT_HTTP_TIMEOUT = 15000;
const ALLOWED_AUDIO_TYPES = new Set([
  'audio/mpeg',
  'audio/mp3',
  'audio/ogg',
  'audio/opus',
  'audio/wav',
  'audio/x-wav',
  'application/ogg',
  'application/octet-stream'
]);

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function shortHash(value) {
  return String(value || '').slice(0, 16);
}

function timeoutSignal(ms, baseSignal = null) {
  const timeout = AbortSignal.timeout(Math.max(1000, Number(ms) || DEFAULT_HTTP_TIMEOUT));
  return baseSignal ? AbortSignal.any([baseSignal, timeout]) : timeout;
}

async function fetchWithTimeout(url, options = {}, timeoutMs = DEFAULT_HTTP_TIMEOUT) {
  const signal = timeoutSignal(timeoutMs, options.signal);
  try {
    return await fetch(url, { ...options, signal });
  } catch (e) {
    if (e?.name === 'TimeoutError' || (signal.aborted && signal.reason?.name === 'TimeoutError')) {
      throw new Error('TTS request timed out.');
    }
    throw e;
  }
}

async function hashFile(file) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256');
    const stream = fs.createReadStream(file);
    stream.on('data', chunk => hash.update(chunk));
    stream.on('error', reject);
    stream.on('end', () => resolve(hash.digest('hex')));
  });
}

async function validateAudioFile(file, maxBytes = MAX_AUDIO_BYTES) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size <= 0) throw new Error('TTS provider returned an empty audio file.');
  if (stat.size > maxBytes) throw new Error('TTS audio response exceeded the safety size limit.');
  return { size: stat.size, sha256: await hashFile(file) };
}

async function readRemoteAudio(response, maxBytes = MAX_REMOTE_BYTES) {
  const type = String(response.headers.get('content-type') || '').split(';')[0].trim().toLowerCase();
  const length = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error('TTS audio response exceeded the safety size limit.');
  if (type && !ALLOWED_AUDIO_TYPES.has(type)) throw new Error('TTS provider returned an unexpected content type.');
  const chunks = [];
  let total = 0;
  if (!response.body) throw new Error('TTS API returned no audio body');
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('TTS audio response exceeded the safety size limit.');
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock?.();
  }
  const buffer = Buffer.concat(chunks);
  if (!buffer.length) throw new Error('TTS provider returned an empty audio response.');
  return { buffer, type, sha256: sha256(buffer) };
}

function secMsGec() {
  const ticks = BigInt(Math.floor(Date.now() / 1000) + 11644473600) * 10000000n;
  const rounded = ticks - (ticks % 3000000000n);
  return createHash('sha256').update(String(rounded) + TRUSTED_CLIENT_TOKEN, 'ascii').digest('hex').toUpperCase();
}

async function listVoices(force = false) {
  if (!force && cache.voices.length && Date.now() - cache.at < 21600000) return cache.voices;
  const url = VOICE_LIST_URL + '&Sec-MS-GEC=' + secMsGec() + '&Sec-MS-GEC-Version=1-' + CHROMIUM_FULL_VERSION;
  const r = await fetchWithTimeout(url, {
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
  const r = await fetchWithTimeout(GOOGLE_LANG_URL, { headers: { 'user-agent': 'RealmsNetwork-Bot/0.2', accept: 'application/json,*/*' } });
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
    timeout: Math.max(5000, Number(settings.timeoutMs ?? settings.timeout ?? DEFAULT_HTTP_TIMEOUT))
  });
  await tts.ttsPromise(String(text), file);
  return file;
}

async function remoteStream(url, timeoutMs = DEFAULT_HTTP_TIMEOUT, maxBytes = MAX_REMOTE_BYTES) {
  const r = await fetchWithTimeout(url, { headers: { 'user-agent': 'RealmsNetwork-Bot/0.2', accept: 'audio/*,*/*;q=0.1' } }, timeoutMs);
  if (!r.ok) throw new Error('TTS API HTTP ' + r.status);
  const audio = await readRemoteAudio(r, maxBytes);
  console.info('[TempVC/TTS] Remote audio SHA-256:', shortHash(audio.sha256), 'bytes:', audio.buffer.length);
  return Readable.from(audio.buffer);
}

async function setBotMute(client,room,mute){try{const guild=client.guilds.cache.get(room.guildId);const me=await guild?.members.fetchMe().catch(()=>guild?.members.me);if(!me?.voice?.channelId||me.voice.channelId!==room.voiceChannelId)return false;if(me.voice.serverMute!==mute)await me.voice.setMute(mute,'Room TTS '+(mute?'idle':'speaking'));return true;}catch(e){console.error('[TempVC/TTS] Bot mute:',e?.message||e);return false;}}

function ensurePlayer(room,client) {
  if (!Array.isArray(room.ttsQueue)) room.ttsQueue = [];
  if (room.ttsPlaying === undefined) room.ttsPlaying = false;
  if (room.ttsPlayer) return room.ttsPlayer;
  room.ttsPlayer = createAudioPlayer();
  room.ttsPlayer.on(AudioPlayerStatus.Idle, () => {
    room.ttsPlaying = false;
    playNext(room,client).catch(e => console.error('[TempVC/TTS]', e?.stack || e));
  });
  room.ttsPlayer.on('error', e => {
    console.error('[TempVC/TTS] Player:', e?.stack || e?.message || e);
    room.ttsPlaying = false;
    playNext(room,client).catch(err => console.error('[TempVC/TTS] Queue recovery:', err?.message || err));
  });
  return room.ttsPlayer;
}

async function ensureConnection(client, room) {
  if (room.ttsConnectionPromise) return room.ttsConnectionPromise;
  room.ttsConnectionPromise = (async () => {
    const guild = client.guilds.cache.get(room.guildId);
    const channel = guild?.channels.cache.get(room.voiceChannelId);
    if (!guild || !channel) throw new Error('Temporary voice room no longer exists.');

    let connection = client.voiceSessions?.get(guild.id)?.connection || room.ttsConnection;
    if (connection?.joinConfig?.channelId !== channel.id) {
      connection?.destroy?.();
      connection = null;
    }

    if (connection) {
      const state = connection.state.status;
      if (state === VoiceConnectionStatus.Destroyed) {
        connection = null;
      } else if (state === VoiceConnectionStatus.Disconnected) {
        const rejoined = connection.rejoin();
        if (rejoined) {
          try {
            await entersState(connection, VoiceConnectionStatus.Ready, 15000);
          } catch {
            connection.destroy();
            connection = null;
          }
        } else {
          connection.destroy();
          connection = null;
        }
      } else if (state !== VoiceConnectionStatus.Ready) {
        try {
          await entersState(connection, VoiceConnectionStatus.Ready, 15000);
        } catch {
          connection.destroy();
          connection = null;
        }
      }
    }

    if (!connection) {
      connection = joinVoiceChannel({
        channelId: channel.id,
        guildId: guild.id,
        adapterCreator: guild.voiceAdapterCreator,
        selfDeaf: true,
        selfMute: false
      });
      try {
        await entersState(connection, VoiceConnectionStatus.Ready, 15000);
      } catch (e) {
        connection.destroy();
        throw e;
      }
      const session = client.voiceSessions?.get(guild.id);
      if (session) session.connection = connection;
    }

    room.ttsConnection = connection;
    return connection;
  })();

  try {
    return await room.ttsConnectionPromise;
  } finally {
    room.ttsConnectionPromise = null;
  }
}

function settingsFor(room, client) {
  const c = client.modules.get('voice')?.config?.tts || {};
  room.tts = room.tts && typeof room.tts === 'object' ? room.tts : {};
  if (!room.tts.provider) room.tts.provider = c.provider || 'edge';
  if (!room.tts.voice) room.tts.voice = c.defaultVoice || 'en-US-AriaNeural';
  if (!room.tts.lang) room.tts.lang = c.defaultLanguage || 'en-US';
  if (!Number.isFinite(Number(room.tts.rate))) room.tts.rate = 100;
  room.tts.rate = Math.max(50, Math.min(Number(c.maxRate || 150), Number(room.tts.rate)));
  if (!Number.isFinite(Number(room.tts.volume))) room.tts.volume = Number(c.maxVolume || 100);
  room.tts.volume = Math.max(0, Math.min(Number(c.maxVolume || 150), Number(room.tts.volume)));
  room.tts.timeoutMs = Math.max(1000, Math.min(120000, Number(c.timeoutMs || DEFAULT_HTTP_TIMEOUT)));
  room.tts.maxAudioBytes = Math.max(64 * 1024, Math.min(32 * 1024 * 1024, Number(c.maxAudioBytes || MAX_AUDIO_BYTES)));
  room.tts.maxRemoteBytes = Math.max(64 * 1024, Math.min(32 * 1024 * 1024, Number(c.maxRemoteBytes || MAX_REMOTE_BYTES)));
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
  const generation = room.ttsGeneration || 0;
  try {
    let resource;
    let file = null;
    if (item.settings.provider === 'edge') {
      const dir = path.join(__dirname, '../../data/tts');
      await fs.promises.mkdir(dir, { recursive: true });
      file = path.join(dir, room.guildId + '-' + room.voiceChannelId + '-' + Date.now() + '-' + Math.random().toString(36).slice(2) + '.mp3');
      await synthesizeEdge(item.text, file, item.settings);
      const verified = await validateAudioFile(file, item.settings.maxAudioBytes);
      console.info('[TempVC/TTS] Edge audio SHA-256:', shortHash(verified.sha256), 'bytes:', verified.size);
      resource = createAudioResource(file, { inputType: StreamType.Arbitrary });
    } else if (item.settings.provider === 'google') {
      const text = encodeURIComponent(item.text.slice(0, 200));
      const lang = encodeURIComponent(item.settings.lang || 'en');
      resource = createAudioResource(await remoteStream(GOOGLE_TTS_URL + '?ie=UTF-8&q=' + text + '&tl=' + lang + '&client=tw-ob', item.settings.timeoutMs, item.settings.maxRemoteBytes), { inputType: StreamType.Arbitrary });
    } else if (item.settings.provider === 'polly') {
      resource = createAudioResource(await remoteStream(POLLY_TTS_URL + '?voice=' + encodeURIComponent(item.settings.voice || 'Brian') + '&text=' + encodeURIComponent(item.text.slice(0, 200)), item.settings.timeoutMs, item.settings.maxRemoteBytes), { inputType: StreamType.Arbitrary });
    } else {
      throw new Error('Unsupported TTS provider: ' + item.settings.provider);
    }
    if (generation !== (room.ttsGeneration || 0) || !room.ttsQueue?.length || room.ttsQueue[0] !== item) {
      if (file) await fs.promises.rm(file, { force: true }).catch(() => {});
      room.ttsPlaying = false;
      return;
    }
    if (!room.ttsConnection || room.ttsConnection.state.status !== VoiceConnectionStatus.Ready) {
      await ensureConnection(client, room);
    }
    if (generation !== (room.ttsGeneration || 0) || !room.ttsQueue?.length || room.ttsQueue[0] !== item) {
      if (file) await fs.promises.rm(file, { force: true }).catch(() => {});
      room.ttsPlaying = false;
      return;
    }
    if (!room.ttsConnection || room.ttsConnection.state.status !== VoiceConnectionStatus.Ready) throw new Error('Voice connection is unavailable.');
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
    if (file) await fs.promises.rm(file, { force: true }).catch(() => {});
    await playNext(room,client);
    return;
  }
  room.ttsQueue.shift();
}

async function pump(room, client) {
  if (room.ttsPump) return room.ttsPump;
  room.ttsPump = playNext(room, client).finally(() => {
    room.ttsPump = null;
  });
  return room.ttsPump;
}

async function speak(client, room, text, member) {
  const settings = { ...settingsFor(room, client) };
  if (settings.enabled === false) throw new Error('TTS is disabled for this room.');
  let phrase = String(text || '').replace(/\s+/g, ' ').trim();
  if (!phrase) throw new Error('TTS text cannot be empty.');
  const max = Math.max(20, Number(client.modules.get('voice')?.config?.tts?.maxCharacters || 500));
  phrase = phrase.slice(0, max);
  if (settings.prefixName && member?.displayName) phrase = member.displayName + ' says ' + phrase;
  const queueLimit = Math.max(1, Math.min(100, Number(client.modules.get('voice')?.config?.tts?.maxQueueSize || 20)));
  if ((room.ttsQueue?.length || 0) >= queueLimit) throw new Error('TTS queue is full. Please wait for the current speech to finish.');
  if (!room.guildId || !room.voiceChannelId) throw new Error('Invalid temporary voice room state.');
  await ensureConnection(client, room);
  ensurePlayer(room,client);
  room.ttsQueue.push({ text: phrase, settings, requestedAt: Date.now(), requestHash: shortHash(sha256(JSON.stringify({ phrase, settings }))) });
  if (!room.ttsPlaying) await pump(room,client);
}

async function stop(room,client) {
  if (!room) return false;
  room.ttsGeneration = (room.ttsGeneration || 0) + 1;
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
