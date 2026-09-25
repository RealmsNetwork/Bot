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
let voiceFetchPromise = null;
let languageFetchPromise = null;
const MAX_JSON_BYTES = 2 * 1024 * 1024;
const SUPPORTED_PROVIDERS = new Set(['edge','google','polly']);
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

function hasAudioSignature(buffer) {
  if (!buffer || buffer.length < 4) return false;
  if (buffer.subarray(0, 4).toString('ascii') === 'OggS') return true;
  if (buffer.subarray(0, 4).toString('ascii') === 'RIFF' && buffer.subarray(8, 12).toString('ascii') === 'WAVE') return true;
  if (buffer.subarray(0, 3).toString('ascii') === 'ID3') return true;
  return buffer[0] === 0xff && (buffer[1] & 0xe0) === 0xe0;
}

async function validateAudioFile(file, maxBytes = MAX_AUDIO_BYTES) {
  const stat = await fs.promises.stat(file);
  if (!stat.isFile() || stat.size <= 0) throw new Error('TTS provider returned an empty audio file.');
  if (stat.size > maxBytes) throw new Error('TTS audio response exceeded the safety size limit.');
  const head = Buffer.alloc(Math.min(32, stat.size));
  const fd = await fs.promises.open(file, 'r');
  try {
    await fd.read(head, 0, head.length, 0);
  } finally {
    await fd.close();
  }
  if (!hasAudioSignature(head)) throw new Error('TTS provider returned an invalid audio file.');
  return { size: stat.size, sha256: await hashFile(file) };
}

async function readResponseBuffer(response, maxBytes = MAX_JSON_BYTES) {
  const length = Number(response.headers.get('content-length') || 0);
  if (Number.isFinite(length) && length > maxBytes) throw new Error('TTS API response exceeded the safety size limit.');
  if (!response.body) throw new Error('TTS API returned no response body');
  const chunks = [];
  let total = 0;
  const reader = response.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > maxBytes) throw new Error('TTS API response exceeded the safety size limit.');
      chunks.push(Buffer.from(value));
    }
  } catch (e) {
    await reader.cancel().catch(() => {});
    throw e;
  } finally {
    reader.releaseLock?.();
  }
  return Buffer.concat(chunks);
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
  if (!hasAudioSignature(buffer.subarray(0, 32))) throw new Error('TTS provider returned invalid audio data.');
  return { buffer, type, sha256: sha256(buffer) };
}

function secMsGec() {
  const ticks = BigInt(Math.floor(Date.now() / 1000) + 11644473600) * 10000000n;
  const rounded = ticks - (ticks % 3000000000n);
  return createHash('sha256').update(String(rounded) + TRUSTED_CLIENT_TOKEN, 'ascii').digest('hex').toUpperCase();
}

async function listVoices(force = false) {
  if (!force && cache.voices.length && Date.now() - cache.at < 21600000) return cache.voices;
  if (voiceFetchPromise) return voiceFetchPromise;
  voiceFetchPromise = (async () => {
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
    const data = JSON.parse((await readResponseBuffer(r)).toString('utf8'));
    cache.voices = Array.isArray(data) ? data.filter(v => v?.ShortName || v?.Name) : [];
    cache.at = Date.now();
    return cache.voices;
  })();
  try {
    return await voiceFetchPromise;
  } finally {
    voiceFetchPromise = null;
  }
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
  if (languageFetchPromise) return languageFetchPromise;
  languageFetchPromise = (async () => {
    const r = await fetchWithTimeout(GOOGLE_LANG_URL, { headers: { 'user-agent': 'RealmsNetwork-Bot/0.2', accept: 'application/json,*/*' } });
    if (!r.ok) throw new Error('Google language API HTTP ' + r.status);
    const data = JSON.parse((await readResponseBuffer(r)).toString('utf8'));
    languageCache.values = Object.entries(data || {})
      .map(([code, name]) => ({ code: String(code), name: String(name) }))
      .filter(x => x.code && x.name)
      .sort((a, b) => a.name.localeCompare(b.name));
    languageCache.at = Date.now();
    return languageCache.values;
  })();
  try {
    return await languageFetchPromise;
  } finally {
    languageFetchPromise = null;
  }
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
  const timeoutMs = Math.max(1000, Number(settings.timeoutMs ?? settings.timeout ?? DEFAULT_HTTP_TIMEOUT));
  const tts = new EdgeTTS({
    voice: settings.voice || 'en-US-AriaNeural',
    lang: settings.lang || 'en-US',
    outputFormat: settings.outputFormat || 'audio-24khz-96kbitrate-mono-mp3',
    rate: rateValue(settings.rate),
    pitch: settings.pitch || 'default',
    volume: volumeValue(settings.volume),
    timeout: timeoutMs
  });
  let timer;
  let timedOut = false;
  const pending = tts.ttsPromise(String(text), file);
  pending.finally(() => {
    if (timedOut) fs.promises.rm(file, { force: true }).catch(() => {});
  }).catch(() => {});
  try {
    await Promise.race([
      pending,
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Edge TTS request timed out.')), timeoutMs);
        timer.unref?.();
      })
    ]);
  } catch (e) {
    if (e?.message === 'Edge TTS request timed out.') timedOut = true;
    throw e;
  } finally {
    clearTimeout(timer);
  }
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

function pauseMusicForTts(client, room) {
  const session = client.voiceSessions?.get(room.guildId);
  if (!session?.connection || session.connection !== room.ttsConnection) return;
  if (session.player?.state?.status !== AudioPlayerStatus.Playing) return;
  if (session.player.pause(false)) room.ttsPausedMusic = true;
}

function resumeMusicAfterTts(client, room) {
  if (!room.ttsPausedMusic) return;
  room.ttsPausedMusic = false;
  const session = client.voiceSessions?.get(room.guildId);
  if (!session?.connection || session.connection !== room.ttsConnection) return;
  if (!session.current) return;
  session.connection.subscribe(session.player);
  if (session.player?.state?.status === AudioPlayerStatus.Paused) session.player.unpause();
}

function ensurePlayer(room,client) {
  if (!Array.isArray(room.ttsQueue)) room.ttsQueue = [];
  if (room.ttsPlaying === undefined) room.ttsPlaying = false;
  if (room.ttsPlayer) return room.ttsPlayer;
  room.ttsPlayer = createAudioPlayer();
  room.ttsPlayer.on(AudioPlayerStatus.Idle, () => {
    const file = room.ttsCurrentFile;
    room.ttsCurrentFile = null;
    if (file) fs.promises.rm(file, { force: true }).catch(e => console.error('[TempVC/TTS] Audio cleanup:', e?.message || e));
    room.ttsPlaying = false;
    pump(room,client).catch(e => console.error('[TempVC/TTS]', e?.stack || e));
  });
  room.ttsPlayer.on('error', e => {
    const file = room.ttsCurrentFile;
    room.ttsCurrentFile = null;
    if (file) fs.promises.rm(file, { force: true }).catch(err => console.error('[TempVC/TTS] Audio cleanup:', err?.message || err));
    console.error('[TempVC/TTS] Player:', e?.stack || e?.message || e);
    room.ttsPlaying = false;
    pump(room,client).catch(err => console.error('[TempVC/TTS] Queue recovery:', err?.message || err));
  });
  return room.ttsPlayer;
}

async function ensureConnection(client, room) {
  const existingSession = client.voiceSessions?.get(room.guildId);
  const existingPromise = existingSession?.connectionPromise || room.ttsConnectionPromise;
  if (existingPromise) return existingPromise;

  const work = (async () => {
    const guild = client.guilds.cache.get(room.guildId);
    const channel = guild?.channels.cache.get(room.voiceChannelId);
    if (!guild || !channel) throw new Error('Temporary voice room no longer exists.');

    const session = client.voiceSessions?.get(guild.id);
    let connection = room.ttsConnection || session?.connection;
    if (connection?.joinConfig?.channelId !== channel.id) {
      const previousTtsRoom = [...(client.voiceRooms?.values?.() || [])].find(candidate => candidate !== room && candidate.ttsConnection === connection);
      if (previousTtsRoom) await stop(previousTtsRoom, client).catch(e => console.error('[TempVC/TTS] Failed to stop previous TTS room:', e?.message || e));
      if (session && (session.current || session.queue?.length)) {
        session.queue = [];
        session.current = null;
        session.player?.stop(true);
        console.warn('[TempVC/TTS] Stopping music session because the bot is moving into the TTS room.');
      }
      connection?.destroy?.();
      if (session?.connection === connection) session.connection = null;
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
      if (session) session.connection = connection;
    }

    room.ttsConnection = connection;
    return connection;
  })();

  if (existingSession) existingSession.connectionPromise = work;
  else room.ttsConnectionPromise = work;
  try {
    return await work;
  } finally {
    if (existingSession?.connectionPromise === work) existingSession.connectionPromise = null;
    if (!existingSession && room.ttsConnectionPromise === work) room.ttsConnectionPromise = null;
  }
}

function finiteConfigNumber(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function settingsFor(room, client) {
  const c = client.modules.get('voice')?.config?.tts || {};
  room.tts = room.tts && typeof room.tts === 'object' ? room.tts : {};
  if (!SUPPORTED_PROVIDERS.has(room.tts.provider)) room.tts.provider = SUPPORTED_PROVIDERS.has(c.provider) ? c.provider : 'edge';
  if (!room.tts.voice) room.tts.voice = c.defaultVoice || 'en-US-AriaNeural';
  if (!room.tts.lang) room.tts.lang = c.defaultLanguage || 'en-US';

  const maxRate = finiteConfigNumber(c.maxRate, 150, 50, 150);
  const maxVolume = finiteConfigNumber(c.maxVolume, 100, 0, 150);
  room.tts.rate = finiteConfigNumber(room.tts.rate, 100, 50, maxRate);
  room.tts.volume = finiteConfigNumber(room.tts.volume, maxVolume, 0, maxVolume);
  room.tts.timeoutMs = finiteConfigNumber(c.timeoutMs, DEFAULT_HTTP_TIMEOUT, 1000, 120000);
  room.tts.maxAudioBytes = finiteConfigNumber(c.maxAudioBytes, MAX_AUDIO_BYTES, 64 * 1024, 32 * 1024 * 1024);
  room.tts.maxRemoteBytes = finiteConfigNumber(c.maxRemoteBytes, MAX_REMOTE_BYTES, 64 * 1024, 32 * 1024 * 1024);
  if (c.enabled === false) room.tts.enabled = false;
  else if (room.tts.enabled === undefined) room.tts.enabled = true;
  if (room.tts.autoTts === undefined) room.tts.autoTts = false;
  if (room.tts.prefixName === undefined) room.tts.prefixName = true;
  return room.tts;
}

async function playNext(room,client) {
  if (!room.ttsQueue?.length) {
    room.ttsPlaying = false;
    resumeMusicAfterTts(client, room);
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
    if (!await setBotMute(client,room,false)) throw new Error('The bot could not unmute itself for TTS playback.');
    if (generation !== (room.ttsGeneration || 0) || !room.ttsQueue?.length || room.ttsQueue[0] !== item) {
      if (file) await fs.promises.rm(file, { force: true }).catch(() => {});
      room.ttsPlaying = false;
      return;
    }
    pauseMusicForTts(client, room);
    room.ttsConnection.subscribe(room.ttsPlayer);
    room.ttsPlaying = true;
    room.ttsCurrentFile = file;
    room.ttsPlayer.play(resource);
  } catch (e) {
    console.error('[TempVC/TTS] Synthesis:', e?.stack || e?.message || e);
    const stillCurrent = room.ttsQueue?.[0] === item && generation === (room.ttsGeneration || 0);
    if (stillCurrent) room.ttsQueue.shift();
    room.ttsPlaying = false;
    if (file) await fs.promises.rm(file, { force: true }).catch(() => {});
    if (room.ttsCurrentFile === file) room.ttsCurrentFile = null;
    return;
  }
  room.ttsQueue.shift();
}

async function pump(room, client) {
  if (room.ttsPump) return room.ttsPump;
  room.ttsPump = (async () => {
    try {
      await playNext(room, client);
    } finally {
      room.ttsPump = null;
      if (!room.ttsPlaying && room.ttsQueue?.length) {
        queueMicrotask(() => pump(room, client).catch(e => console.error('[TempVC/TTS] Queue restart:', e?.stack || e)));
      }
    }
  })();
  return room.ttsPump;
}

async function speak(client, room, text, member, overrides = {}) {
  const settings = { ...settingsFor(room, client) };
  if (overrides.provider !== undefined) settings.provider = String(overrides.provider).toLowerCase();
  if (overrides.lang !== undefined) settings.lang = String(overrides.lang);
  if (overrides.voice !== undefined) settings.voice = String(overrides.voice);
  if (!SUPPORTED_PROVIDERS.has(settings.provider)) throw new Error('Unsupported TTS provider: ' + settings.provider);
  if (overrides.lang === undefined && settings.provider === 'google') settings.lang = 'en';
  if (overrides.voice === undefined && settings.provider === 'polly') settings.voice = 'Brian';
  if (settings.enabled === false) throw new Error('TTS is disabled for this room.');
  let phrase = String(text || '').replace(/\s+/g, ' ').trim();
  if (!phrase) throw new Error('TTS text cannot be empty.');
  const configuredMax = Number(client.modules.get('voice')?.config?.tts?.maxCharacters);
  const max = Number.isFinite(configuredMax) ? Math.max(1, Math.min(2000, configuredMax)) : 500;
  phrase = phrase.slice(0, max);
  if (settings.prefixName && member?.displayName) phrase = (member.displayName + ' says ' + phrase).slice(0, max);
  const queueLimit = finiteConfigNumber(client.modules.get('voice')?.config?.tts?.maxQueueSize, 20, 1, 100);
  if ((room.ttsQueue?.length || 0) >= queueLimit) throw new Error('TTS queue is full. Please wait for the current speech to finish.');
  if (!room.guildId || !room.voiceChannelId) throw new Error('Invalid temporary voice room state.');

  const cooldownMs = finiteConfigNumber(client.modules.get('voice')?.config?.tts?.cooldownSeconds, 0, 0, 60) * 1000;
  let cooldownUserId = null;
  let cooldownSetAt = null;
  if (cooldownMs > 0 && member?.id) {
    if (!(room.ttsCooldowns instanceof Map)) room.ttsCooldowns = new Map();
    const now = Date.now();
    const previous = room.ttsCooldowns.get(member.id) || 0;
    const remaining = cooldownMs - (now - previous);
    if (remaining > 0) throw new Error('TTS cooldown active. Please wait ' + Math.ceil(remaining / 1000) + 's.');
    cooldownUserId = member.id;
    cooldownSetAt = now;
    room.ttsCooldowns.set(member.id, now);
    if (room.ttsCooldowns.size > 1000) {
      for (const [id, at] of room.ttsCooldowns) {
        if (now - at >= cooldownMs) room.ttsCooldowns.delete(id);
        if (room.ttsCooldowns.size <= 1000) break;
      }
    }
  }

  const generation = room.ttsGeneration || 0;
  try {
    await ensureConnection(client, room);
  } catch (e) {
    if (cooldownUserId && room.ttsCooldowns?.get(cooldownUserId) === cooldownSetAt) room.ttsCooldowns.delete(cooldownUserId);
    throw e;
  }
  if (generation !== (room.ttsGeneration || 0)) {
    if (cooldownUserId && room.ttsCooldowns?.get(cooldownUserId) === cooldownSetAt) room.ttsCooldowns.delete(cooldownUserId);
    throw new Error('TTS request was cancelled.');
  }
  ensurePlayer(room,client);
  room.ttsQueue.push({ text: phrase, settings, requestedAt: Date.now(), requestHash: shortHash(sha256(JSON.stringify({ phrase, settings }))) });
  if (!room.ttsPlaying) await pump(room,client);
}

async function stop(room,client) {
  if (!room) return false;
  room.ttsGeneration = (room.ttsGeneration || 0) + 1;
  room.ttsCooldowns?.clear?.();
  room.ttsQueue = [];
  room.ttsPlaying = false;
  const currentFile = room.ttsCurrentFile;
  room.ttsCurrentFile = null;
  room.ttsPlayer?.stop(true);
  if (currentFile) await fs.promises.rm(currentFile, { force: true }).catch(() => {});
  resumeMusicAfterTts(client, room);
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
