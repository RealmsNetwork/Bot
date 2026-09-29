const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  MessageFlags,
  ModalBuilder,
  SlashCommandBuilder,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} = require('discord.js');

const {
  AudioPlayerStatus,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel
} = require('@discordjs/voice');

const { spawn } = require('node:child_process');
const { PassThrough, Readable } = require('node:stream');
const fs = require('node:fs');
const path = require('node:path');
const play = require('play-dl');

let YTDlpWrap = null;
let ytdlp = null;
let ytdlpPromise = null;
let spotifyTokenCache = { value: null, expiresAt: 0 };
let sessions = null;
let monitorTimer = null;
let panelTimer = null;

const SORTS = [
  ['popular', 'Popular'],
  ['relevance', 'Relevance'],
  ['newest', 'Newest'],
  ['oldest', 'Oldest'],
  ['shortest', 'Shortest'],
  ['longest', 'Longest'],
  ['az', 'A-Z'],
  ['za', 'Z-A']
];

const SOURCES = [
  ['auto', 'Auto'],
  ['youtube', 'YouTube'],
  ['youtube music', 'YouTube Music'],
  ['soundcloud', 'SoundCloud'],
  ['spotify', 'Spotify'],
  ['apple', 'Apple Music'],
  ['deezer', 'Deezer'],
  ['tidal', 'Tidal'],
  ['bandcamp', 'Bandcamp']
];

function cfg(client) {
  return client.modules.get('voice')?.config || {};
}

function mc(client) {
  return cfg(client).music || {};
}

function brand(client) {
  const b = client.config.branding || {};
  return {
    color: b.embedColor || '#8b5cf6',
    footer: b.footer || b.serverName || 'RealmsNetwork'
  };
}

function makeEmbed(client, title, description) {
  const b = brand(client);
  return new EmbedBuilder()
    .setColor(b.color)
    .setTitle(title)
    .setDescription(description || '')
    .setFooter({ text: b.footer })
    .setTimestamp();
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value)));
}

function clean(value, max) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, max || 300);
}

function seconds(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

function fmt(secondsValue) {
  const total = seconds(secondsValue);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? h + ':' + String(m).padStart(2, '0') + ':' + String(s).padStart(2, '0') : m + ':' + String(s).padStart(2, '0');
}

function fmtMs(ms) {
  return fmt(Math.floor(Math.max(0, Number(ms) || 0) / 1000));
}

function host(url) {
  try { return new URL(url).hostname.toLowerCase(); } catch { return ''; }
}

function normalizeUrl(value) {
  let valueString = String(value || '').trim();
  if (!valueString) return '';
  valueString = valueString.replace(/^<|>$/g, '').trim();
  try {
    const parsed = new URL(valueString);
    if (!/^https?:$/i.test(parsed.protocol)) return '';
    return parsed.toString();
  } catch {
    return '';
  }
}

function detect(url) {
  const normalized = normalizeUrl(url);
  const h = host(normalized);
  if (!h) return 'query';

  const youtubeHosts = new Set([
    'youtube.com',
    'youtu.be',
    'youtube-nocookie.com'
  ]);
  const isYoutube = youtubeHosts.has(h) ||
    h.endsWith('.youtube.com') ||
    h.endsWith('.youtube-nocookie.com');

  if (isYoutube) {
    return h === 'music.youtube.com' || h === 'music.youtube-nocookie.com' ? 'youtube_music' : 'youtube';
  }
  if (h === 'soundcloud.com' || h.endsWith('.soundcloud.com')) return 'soundcloud';
  if (h === 'open.spotify.com' || h.endsWith('.spotify.com') || h === 'spotify.link') return 'spotify';
  if (h === 'music.apple.com') return 'apple';
  if (h === 'deezer.com' || h.endsWith('.deezer.com') || h.includes('deezer.page.link')) return 'deezer';
  if (h === 'tidal.com' || h.endsWith('.tidal.com') || h === 'listen.tidal.com') return 'tidal';
  if (h === 'bandcamp.com' || h.endsWith('.bandcamp.com')) return 'bandcamp';
  if (/\.(mp3|wav|ogg|flac|m4a|aac|opus|webm)(\?.*)?$/i.test(url)) return 'direct';
  if (/\.(m3u|m3u8|pls)(\?.*)?$/i.test(url) || /icecast|shoutcast|radio/i.test(url)) return 'radio';
  return 'unknown';
}

function sourceLabel(value) {
  const item = SOURCES.find(x => x[0] === String(value || '').toLowerCase());
  return item ? item[1] : clean(value, 40) || 'Direct';
}

function sourceEnabled(client, source) {
  const s = mc(client).sources || {};
  const key = {
    youtube: 'youtube',
    youtube_music: 'youtubeMusic',
    soundcloud: 'soundcloud',
    spotify: 'spotifySearch',
    apple: 'appleMusicSearch',
    deezer: 'deezerSearch',
    tidal: 'tidalSearch',
    bandcamp: 'bandcamp'
  }[source];
  return key ? s[key] !== false : true;
}

function normalize(value) {
  return clean(value, 240).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}

function similarity(a, b) {
  const aa = new Set(normalize(a).split(' ').filter(Boolean));
  const bb = new Set(normalize(b).split(' ').filter(Boolean));
  if (!aa.size || !bb.size) return 0;
  let hits = 0;
  for (const word of aa) if (bb.has(word)) hits++;
  return hits / Math.max(aa.size, bb.size);
}

function getSession(guildId, client) {
  let s = sessions.get(guildId);
  if (s) return s;
  const c = mc(client);
  s = {
    connection: null,
    connectionPromise: null,
    player: createAudioPlayer(),
    queue: [],
    history: [],
    current: null,
    resource: null,
    textChannelId: null,
    volume: clamp(c.defaultVolume == null ? 100 : c.defaultVolume, 0, c.maxVolume == null ? 150 : c.maxVolume),
    maxVolume: clamp(c.maxVolume == null ? 150 : c.maxVolume, 0, 150),
    loop: 'off',
    skipVotes: new Set(),
    startedAt: 0,
    pausedAt: 0,
    transition: false,
    streamCleanup: null,
    emptySince: 0,
    panel: {
      messageId: null,
      channelId: null,
      query: '',
      source: 'auto',
      sort: 'popular',
      results: [],
      page: 0,
      selected: null,
      view: 'search'
    },
    hooks: false
  };
  sessions.set(guildId, s);
  installHooks(guildId, client);
  return s;
}

async function connect(member, client) {
  if (!member?.voice?.channel) throw new Error('Join a voice channel first.');
  const s = getSession(member.guild.id, client);

  if (s.connectionPromise) await s.connectionPromise.catch(() => {});
  if (s.connection?.state?.status === VoiceConnectionStatus.Destroyed) s.connection = null;

  if (s.connection?.joinConfig?.channelId === member.voice.channelId && s.connection.state.status === VoiceConnectionStatus.Ready) {
    s.connection.subscribe(s.player);
    return s;
  }

  if (s.connection) {
    // Moving between voice channels must not kill the current audio player.
    try { s.connection.destroy(); } catch {}
    s.connection = null;
  }

  const promise = (async () => {
    const connection = joinVoiceChannel({
      channelId: member.voice.channelId,
      guildId: member.guild.id,
      adapterCreator: member.guild.voiceAdapterCreator,
      selfDeaf: true
    });
    s.connection = connection;
    connection.subscribe(s.player);
    await entersState(connection, VoiceConnectionStatus.Ready, 15000);
    return s;
  })();

  s.connectionPromise = promise;
  try { return await promise; }
  finally {
    if (s.connectionPromise === promise) s.connectionPromise = null;
    s.transition = false;
  }
}

async function spotifyToken() {
  const id = process.env.SPOTIFY_CLIENT_ID?.trim();
  const secret = process.env.SPOTIFY_CLIENT_SECRET?.trim();
  if (!id || !secret) return null;
  if (spotifyTokenCache.value && spotifyTokenCache.expiresAt > Date.now() + 30000) return spotifyTokenCache.value;

  const response = await fetch('https://accounts.spotify.com/api/token', {
    method: 'POST',
    headers: {
      authorization: 'Basic ' + Buffer.from(id + ':' + secret).toString('base64'),
      'content-type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });

  if (!response.ok) throw new Error('Spotify token request returned HTTP ' + response.status);
  const data = await response.json();
  spotifyTokenCache = {
    value: data.access_token,
    expiresAt: Date.now() + Math.max(60000, Number(data.expires_in || 3600) * 1000)
  };
  return spotifyTokenCache.value;
}

async function apiJson(url, options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      ...(options || {}),
      signal: controller.signal,
      headers: {
        'user-agent': 'RealmsNetwork-Bot/0.2',
        accept: 'application/json,*/*;q=0.8',
        ...((options && options.headers) || {})
      }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    return await response.json();
  } finally {
    clearTimeout(timer);
  }
}

async function pageMeta(url) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  timer.unref?.();
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'user-agent': 'RealmsNetwork-Bot/0.2', accept: 'text/html,*/*;q=0.5' }
    });
    if (!response.ok) throw new Error('HTTP ' + response.status);
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > 1024 * 1024) throw new Error('Remote page too large.');
    const source = Buffer.from(buffer).toString('utf8');
    const titleRe = /<meta[^>]+(?:property|name)=["']og:title["'][^>]+content=["']([^"']+)["']/i;
    const imageRe = /<meta[^>]+(?:property|name)=["']og:image["'][^>]+content=["']([^"']+)["']/i;
    const titleMatch = source.match(titleRe) || source.match(/<title[^>]*>([^<]+)<\/title>/i);
    const imageMatch = source.match(imageRe);
    return { title: clean(titleMatch?.[1] || '', 200), thumbnail: imageMatch?.[1] || null };
  } finally {
    clearTimeout(timer);
  }
}

async function spotifyMeta(url) {
  const id = url.match(/spotify\.com\/track\/([A-Za-z0-9]+)/i)?.[1];
  const token = await spotifyToken().catch(() => null);
  if (id && token) {
    const data = await apiJson('https://api.spotify.com/v1/tracks/' + id, {
      headers: { authorization: 'Bearer ' + token }
    });
    return {
      title: clean(data.name, 200),
      artist: clean(data.artists?.map(x => x.name).join(', ') || '', 120),
      duration: Number(data.duration_ms || 0) / 1000,
      thumbnail: data.album?.images?.[0]?.url || null,
      popularity: Number(data.popularity || 0)
    };
  }
  const oembed = await apiJson('https://open.spotify.com/oembed?url=' + encodeURIComponent(url)).catch(() => null);
  const meta = await pageMeta(url).catch(() => ({}));
  return {
    title: clean(oembed?.title || meta.title || 'Spotify track', 200),
    artist: '',
    duration: 0,
    thumbnail: oembed?.thumbnail_url || meta.thumbnail || null,
    popularity: 0
  };
}

async function appleMeta(url) {
  const id = url.match(/[?&]i=(\d+)/)?.[1] || url.match(/\/song\/[^/]+\/(\d+)/i)?.[1];
  if (id) {
    const data = await apiJson('https://itunes.apple.com/lookup?id=' + id + '&entity=song');
    const track = data.results?.find(x => x.wrapperType === 'track');
    if (track) {
      return {
        title: clean(track.trackName, 200),
        artist: clean(track.artistName || '', 120),
        duration: Number(track.trackTimeMillis || 0) / 1000,
        thumbnail: track.artworkUrl100?.replace('100x100', '600x600') || null
      };
    }
  }
  const meta = await pageMeta(url).catch(() => ({}));
  return { title: clean(meta.title || 'Apple Music track', 200), artist: '', duration: 0, thumbnail: meta.thumbnail || null };
}

async function deezerMeta(url) {
  let target = url;
  if (url.includes('deezer.page.link')) {
    const r = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'RealmsNetwork-Bot/0.2' } });
    target = r.url;
  }
  const id = target.match(/deezer\.com\/(?:[\w-]+\/)?track\/(\d+)/i)?.[1];
  if (id) {
    const data = await apiJson('https://api.deezer.com/track/' + id);
    if (!data.error) {
      return {
        title: clean(data.title, 200),
        artist: clean(data.artist?.name || '', 120),
        duration: Number(data.duration || 0),
        thumbnail: data.album?.cover_xl || data.album?.cover_big || null
      };
    }
  }
  const meta = await pageMeta(url).catch(() => ({}));
  return { title: clean(meta.title || 'Deezer track', 200), artist: '', duration: 0, thumbnail: meta.thumbnail || null };
}

async function tidalMeta(url) {
  const meta = await pageMeta(url).catch(() => ({}));
  let title = meta.title || 'Tidal track';
  let artist = '';
  const match = title.match(/^(.+?)\s*[-–]\s*(.+)$/);
  if (match) {
    artist = clean(match[1], 120);
    title = clean(match[2], 200);
  }
  return { title: clean(title, 200), artist, duration: 0, thumbnail: meta.thumbnail || null };
}

async function ensureYtdlp(client) {
  if (ytdlp) return ytdlp;
  if (ytdlpPromise) return ytdlpPromise;
  ytdlpPromise = (async () => {
    YTDlpWrap = YTDlpWrap || require('yt-dlp-wrap-plus').default;
    const configured = String(mc(client).ytDlpBinaryPath || process.env.RN_YTDLP_PATH || '').trim();
    const binary = configured || path.join(process.cwd(), '.cache', 'yt-dlp');
    fs.mkdirSync(path.dirname(binary), { recursive: true });

    if (!fs.existsSync(binary)) {
      await YTDlpWrap.downloadFromGithub(binary);
      try { await fs.promises.chmod(binary, 0o755); } catch {}
    }

    ytdlp = new YTDlpWrap(binary);

    // yt-dlp's full YouTube support requires the EJS challenge solver.
    // Refresh stale cached binaries that predate the EJS transition.
    try {
      const version = String(await ytdlp.getVersion()).trim().split(/\s+/)[0];
      if (!configured && /^\d{4}\.\d{2}\.\d{2}$/.test(version) && version < '2025.11.12') {
        await YTDlpWrap.downloadFromGithub(binary);
        try { await fs.promises.chmod(binary, 0o755); } catch {}
        ytdlp = new YTDlpWrap(binary);
      }
    } catch {}
    return ytdlp;
  })();
  try { return await ytdlpPromise; }
  finally { ytdlpPromise = null; }
}

function ytdlpCommonArgs() {
  const args = [
    '--no-playlist',
    '--no-warnings',
    '--quiet',
    '--js-runtimes',
    'node:' + process.execPath,
    '--remote-components',
    'ejs:github'
  ];
  const cookies = String(process.env.RN_YOUTUBE_COOKIES_PATH || path.join(process.cwd(), 'cookies.txt')).trim();
  if (cookies && fs.existsSync(cookies)) args.push('--cookies', cookies);
  return args;
}

async function ytdlpInfo(client, url) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error('The resolved music URL is empty or invalid.');
  const wrapper = await ensureYtdlp(client);
  const info = await wrapper.getVideoInfo([...ytdlpCommonArgs(), '-f', 'bestaudio/best', normalized]);
  return info || {};
}

let ffmpegPathPromise = null;
let ffmpegInstallPromise = null;

function npmExecutable() {
  return process.platform === 'win32' ? 'npm.cmd' : 'npm';
}

async function installFfmpegStaticPackage() {
  if (ffmpegInstallPromise) return ffmpegInstallPromise;
  ffmpegInstallPromise = (async () => {
    const child = spawn(npmExecutable(), [
      'install', '--no-save', '--no-audit', '--no-fund', '--prefer-online', 'ffmpeg-static@5.3.0'
    ], { cwd: process.cwd(), env: { ...process.env }, stdio: ['ignore', 'pipe', 'pipe'] });
    let output = '';
    child.stdout.on('data', x => { output = (output + x.toString()).slice(-8192); });
    child.stderr.on('data', x => { output = (output + x.toString()).slice(-8192); });
    await new Promise((resolve, reject) => {
      child.once('error', reject);
      child.once('close', code => code === 0 ? resolve() : reject(new Error(
        'npm install ffmpeg-static@5.3.0 failed with code ' + code + (output ? ': ' + output.trim() : '')
      )));
    });
  })();
  try { return await ffmpegInstallPromise; } finally { ffmpegInstallPromise = null; }
}

async function verifyFfmpeg(binary) {
  if (!binary) return false;
  try {
    if (binary !== 'ffmpeg' && !fs.existsSync(binary)) return false;
    const check = spawn(binary, ['-version'], { stdio: ['ignore', 'ignore', 'ignore'] });
    const code = await new Promise(resolve => {
      check.once('error', () => resolve(null));
      check.once('close', value => resolve(value));
    });
    return code === 0;
  } catch { return false; }
}

async function getInstalledFfmpegStatic() {
  try {
    const resolved = require.resolve('ffmpeg-static');
    delete require.cache[resolved];
    const candidate = require('ffmpeg-static');
    if (candidate && await verifyFfmpeg(candidate)) {
      try { fs.chmodSync(candidate, 0o755); } catch {}
      return candidate;
    }
  } catch {}
  return null;
}

async function ensureFfmpeg() {
  const configured = String(process.env.FFMPEG_PATH || '').trim();
  if (configured && await verifyFfmpeg(configured)) return configured;
  if (ffmpegPathPromise) return ffmpegPathPromise;

  ffmpegPathPromise = (async () => {
    const systemCandidates = process.platform === 'win32'
      ? ['ffmpeg.exe', 'ffmpeg']
      : ['/usr/bin/ffmpeg', '/usr/local/bin/ffmpeg', 'ffmpeg'];

    for (const candidate of systemCandidates) {
      if (await verifyFfmpeg(candidate)) {
        console.log('[Voice/Music] Using system FFmpeg:', candidate);
        return candidate;
      }
    }

    const cacheDir = path.join(process.cwd(), '.cache', 'ffmpeg');
    const cached = path.join(cacheDir, process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
    fs.mkdirSync(cacheDir, { recursive: true });
    if (await verifyFfmpeg(cached)) {
      try { fs.chmodSync(cached, 0o755); } catch {}
      console.warn('[Voice/Music] Using cached FFmpeg:', cached);
      return cached;
    }

    const installed = await getInstalledFfmpegStatic();
    if (installed) {
      console.warn('[Voice/Music] Using ffmpeg-static fallback:', installed);
      return installed;
    }

    console.log('[Voice/Music] ffmpeg-static missing/broken. Installing ffmpeg-static@5.3.0...');
    await installFfmpegStaticPackage();

    const installedAfterNpm = await getInstalledFfmpegStatic();
    if (installedAfterNpm) {
      console.warn('[Voice/Music] Using repaired ffmpeg-static fallback:', installedAfterNpm);
      return installedAfterNpm;
    }

    throw new Error('No working FFmpeg executable was found.');
  })();

  try { return await ffmpegPathPromise; }
  catch (error) { ffmpegPathPromise = null; throw error; }
}
function ffmpegBinary() {
  const configured = String(process.env.FFMPEG_PATH || '').trim();
  if (configured && fs.existsSync(configured)) return configured;
  try {
    const candidate = require('ffmpeg-static');
    if (candidate && fs.existsSync(candidate)) return candidate;
  } catch {}
  const cached = path.join(process.cwd(), '.cache', 'ffmpeg', process.platform === 'win32' ? 'ffmpeg.exe' : 'ffmpeg');
  if (fs.existsSync(cached)) return cached;
  return configured || 'ffmpeg';
}

function ffmpegErrorText(stderr) {
  return String(stderr || '').replace(/\x1b\[[0-9;]*m/g, '').trim().split('\n').filter(Boolean).slice(-4).join(' | ');
}

async function ytdlpStream(client, url, startSeconds) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error('The resolved playback URL is empty or invalid.');

  const wrapper = await ensureYtdlp(client);
  const info = await wrapper.getVideoInfo([
    ...ytdlpCommonArgs(),
    '-f', 'bestaudio/best',
    normalized
  ]);

  const format = info?.requested_formats?.find(x => x?.url) ||
    (info?.url ? info : null) ||
    [...(info?.formats || [])]
      .filter(x => x?.url && x?.acodec && x.acodec !== 'none')
      .sort((a, b) => Number(b.abr || b.tbr || 0) - Number(a.abr || a.tbr || 0))[0];

  const directUrl = normalizeUrl(format?.url);
  if (!directUrl) throw new Error('yt-dlp resolved the track, but did not return a playable media URL.');

  const headers = format?.http_headers || info?.http_headers || {};
  return ffmpegUrlStream(directUrl, startSeconds, headers);
}

async function ffmpegUrlStream(url, startSeconds, headers = {}) {
  const normalized = normalizeUrl(url);
  const binary = await ensureFfmpeg();
  if (!normalized) throw new Error('The audio stream URL is empty or invalid.');

  // Keep HTTPS/network handling in Node. ffmpeg-static has an open SIGSEGV
  // report for remote HTTPS inputs, while this process only receives local
  // bytes over stdin.
  const controller = new AbortController();
  const fetchTimer = setTimeout(() => controller.abort(), 20000);
  fetchTimer.unref?.();

  let response;
  try {
    const requestHeaders = {};
    for (const [key, value] of Object.entries(headers || {})) {
      if (!key || value == null || /^(host|content-length|content-type)$/i.test(key)) continue;
      requestHeaders[key] = String(value);
    }

    response = await fetch(normalized, {
      headers: requestHeaders,
      redirect: 'follow',
      signal: controller.signal
    });

    if (!response.ok) throw new Error('Media request returned HTTP ' + response.status + '.');
    if (!response.body) throw new Error('Media request returned no body.');
  } catch (e) {
    throw e?.name === 'AbortError'
      ? new Error('Media request timed out while opening the stream.')
      : e;
  } finally {
    clearTimeout(fetchTimer);
  }

  const ffmpeg = spawn(binary, [
    '-hide_banner',
    '-loglevel', 'error',
    '-nostdin',
    '-i', 'pipe:0',
    ...(Number(startSeconds) > 0 ? ['-ss', String(Number(startSeconds))] : []),
    '-vn',
    '-ar', '48000',
    '-ac', '2',
    '-f', 's16le',
    'pipe:1'
  ], { stdio: ['pipe', 'pipe', 'pipe'] });

  let stderr = '';
  let output = new PassThrough({ highWaterMark: 64 * 1024 });
  let sourceStream = null;
  let cleaned = false;

  ffmpeg.stderr.on('data', chunk => {
    stderr = (stderr + chunk.toString()).slice(-8192);
  });

  const cleanup = () => {
    if (cleaned) return;
    cleaned = true;
    try { sourceStream?.destroy?.(); } catch {}
    try { response?.body?.cancel?.(); } catch {}
    try { ffmpeg.stdin?.destroy(); } catch {}
    try { output?.destroy(); } catch {}
    try { ffmpeg.stdout?.destroy(); } catch {}
    try { ffmpeg.stderr?.destroy(); } catch {}
    if (!ffmpeg.killed) {
      try { ffmpeg.kill('SIGKILL'); } catch {}
    }
  };

  output.once('close', cleanup);

  sourceStream = Readable.fromWeb(response.body);
  sourceStream.once('error', error => {
    if (!cleaned && !ffmpeg.stdin.destroyed) {
      try { ffmpeg.stdin.destroy(error); } catch {}
    }
  });

  return await new Promise((resolve, reject) => {
    let settled = false;
    let gotOutput = false;

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error('FFmpeg timeout: no playable audio data received within 20 seconds.'));
    }, 20000);
    timeout.unref?.();

    const fail = error => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      cleanup();
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve({
        stream: output,
        inputType: StreamType.Raw,
        cleanup
      });
    };

    ffmpeg.once('error', fail);
    ffmpeg.once('close', code => {
      if (!settled && code !== 0) {
        const signal = ffmpeg.signalCode ? ' (' + ffmpeg.signalCode + ')' : '';
        fail(new Error('FFmpeg exited with code ' + code + signal + (ffmpegErrorText(stderr) ? ': ' + ffmpegErrorText(stderr) : '.')));
      } else if (!settled && !gotOutput) {
        fail(new Error('FFmpeg produced no audio output.'));
      }
    });

    ffmpeg.stdout.once('error', fail);
    ffmpeg.stdin.once('error', fail);
    sourceStream.once('error', fail);

    sourceStream.pipe(ffmpeg.stdin);

    ffmpeg.stdout.once('data', chunk => {
      if (settled) return;
      gotOutput = true;
      output.write(chunk);
      ffmpeg.stdout.pipe(output);
      succeed();
    });
  });
}
async function ffmpegDirectStream(url, startSeconds) {
  return ffmpegUrlStream(url, startSeconds);
}

function infoToTrack(info, source, fallbackUrl = '') {
  const resolvedUrl = normalizeUrl(info?.webpage_url || info?.original_url || fallbackUrl);
  return {
    id: String(info?.id || resolvedUrl || Date.now()),
    title: clean(info?.title || 'Unknown track', 200),
    artist: clean(info?.artist || info?.uploader || info?.channel || '', 120),
    url: resolvedUrl,
    playbackUrl: resolvedUrl,
    sourceUrl: resolvedUrl,
    sourceProvider: source || info?.extractor_key || 'Direct',
    playbackProvider: 'yt-dlp',
    duration: seconds(info?.duration),
    views: Number(info?.view_count || 0),
    popularity: Number(info?.like_count || info?.view_count || 0),
    thumbnail: info?.thumbnail || null,
    positionMs: 0
  };
}

async function youtubeSearch(query, limit) {
  const found = await play.search(query, {
    limit: clamp(limit || 10, 1, 25),
    source: { youtube: 'video' }
  });
  return found.map(x => ({
    id: x.id || x.url,
    title: clean(x.title, 200),
    artist: clean(x.channel?.name || x.author?.name || '', 120),
    url: normalizeUrl(x.url || x.webpage_url || (x.id ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(x.id) : '')),
    playbackUrl: normalizeUrl(x.url || x.webpage_url || (x.id ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(x.id) : '')),
    sourceUrl: normalizeUrl(x.url || x.webpage_url || (x.id ? 'https://www.youtube.com/watch?v=' + encodeURIComponent(x.id) : '')),
    sourceProvider: 'YouTube',
    playbackProvider: 'yt-dlp',
    duration: seconds(x.durationInSec),
    views: Number(x.views || 0),
    popularity: Number(x.views || 0),
    thumbnail: x.thumbnails?.[0]?.url || null,
    positionMs: 0
  }));
}

async function soundcloudSearch(query, limit) {
  const found = await play.search(query, {
    limit: clamp(limit || 10, 1, 25),
    source: { soundcloud: 'track' }
  });
  return found.map(x => ({
    id: x.id || x.url,
    title: clean(x.name || x.title, 200),
    artist: clean(x.user?.username || x.publisher_metadata?.artist || '', 120),
    url: normalizeUrl(x.url || x.webpage_url),
    playbackUrl: normalizeUrl(x.url || x.webpage_url),
    sourceUrl: normalizeUrl(x.url || x.webpage_url),
    sourceProvider: 'SoundCloud',
    playbackProvider: 'yt-dlp',
    duration: seconds(x.durationInSec),
    views: Number(x.playback_count || 0),
    popularity: Number(x.likes_count || x.playback_count || 0),
    thumbnail: x.thumbnail || x.artwork_url || null,
    positionMs: 0
  }));
}

async function bridgeSearch(query, source, limit) {
  let metadata = [];

  if (source === 'spotify') {
    const token = await spotifyToken().catch(() => null);
    if (token) {
      const data = await apiJson('https://api.spotify.com/v1/search?q=' + encodeURIComponent(query) + '&type=track&limit=' + clamp(limit || 10, 1, 20), {
        headers: { authorization: 'Bearer ' + token }
      });
      metadata = (data.tracks?.items || []).map(x => ({
        title: clean(x.name, 200),
        artist: clean(x.artists?.map(a => a.name).join(', ') || '', 120),
        duration: Number(x.duration_ms || 0) / 1000,
        thumbnail: x.album?.images?.[0]?.url || null,
        sourceProvider: 'Spotify',
        sourceUrl: x.external_urls?.spotify || '',
        popularity: Number(x.popularity || 0)
      }));
    } else {
      const found = await youtubeSearch(query, limit);
      return found.map(x => ({ ...x, sourceProvider: 'Spotify search', playbackProvider: 'YouTube mirror' }));
    }
  } else if (source === 'apple') {
    const data = await apiJson('https://itunes.apple.com/search?term=' + encodeURIComponent(query) + '&entity=song&country=US&limit=' + clamp(limit || 10, 1, 25));
    metadata = (data.results || []).map(x => ({
      title: clean(x.trackName, 200),
      artist: clean(x.artistName || '', 120),
      duration: Number(x.trackTimeMillis || 0) / 1000,
      thumbnail: x.artworkUrl100?.replace('100x100', '600x600') || null,
      sourceProvider: 'Apple Music',
      sourceUrl: x.trackViewUrl || '',
      popularity: 0
    }));
  } else if (source === 'deezer') {
    const data = await apiJson('https://api.deezer.com/search?q=' + encodeURIComponent(query) + '&limit=' + clamp(limit || 10, 1, 25));
    metadata = (data.data || []).map(x => ({
      title: clean(x.title, 200),
      artist: clean(x.artist?.name || '', 120),
      duration: Number(x.duration || 0),
      thumbnail: x.album?.cover_xl || x.album?.cover_big || null,
      sourceProvider: 'Deezer',
      sourceUrl: x.link || '',
      popularity: Number(x.rank || 0)
    }));
  } else {
    return youtubeSearch(query, limit);
  }

  const results = [];
  for (const item of metadata) {
    const q = clean((item.artist ? item.artist + ' - ' : '') + item.title, 240);
    const candidates = await youtubeSearch(q, 5);
    if (!candidates.length) continue;
    candidates.sort((a, b) => {
      const sa = similarity(q, a.title + ' ' + a.artist) * 100 + Math.log10(Math.max(1, a.views || 0));
      const sb = similarity(q, b.title + ' ' + b.artist) * 100 + Math.log10(Math.max(1, b.views || 0));
      return sb - sa;
    });
    const mirror = candidates[0];
    results.push({
      ...mirror,
      id: item.sourceProvider.toLowerCase().replace(/\s+/g, '-') + ':' + mirror.id,
      title: item.title,
      artist: item.artist,
      duration: item.duration || mirror.duration,
      thumbnail: item.thumbnail || mirror.thumbnail,
      sourceProvider: item.sourceProvider,
      playbackProvider: 'YouTube mirror',
      sourceUrl: item.sourceUrl || mirror.sourceUrl,
      playbackUrl: mirror.playbackUrl
    });
  }
  return results;
}

async function searchTracks(client, query, source, limit) {
  const s = String(source || 'auto').toLowerCase();
  const q = clean(query, 200);

  if (!q) return [];
  if (s === 'soundcloud') return sourceSearchEnabled(client, 'soundcloud') ? soundcloudSearch(q, limit) : Promise.reject(new Error('SoundCloud search is disabled.'));
  if (s === 'spotify' || s === 'apple' || s === 'deezer') return sourceSearchEnabled(client, s) ? bridgeSearch(q, s, limit) : Promise.reject(new Error(sourceLabel(s) + ' search is disabled.'));
  if (s === 'tidal') {
    if (!sourceSearchEnabled(client, 'tidal')) throw new Error('Tidal search is disabled.');
    const found = await youtubeSearch(q, limit);
    return found.map(x => ({ ...x, sourceProvider: 'Tidal search', playbackProvider: 'YouTube mirror' }));
  }
  if (s === 'bandcamp') {
    if (!sourceSearchEnabled(client, 'bandcamp')) throw new Error('Bandcamp search is disabled.');
    const found = await youtubeSearch(q, limit);
    return found.map(x => ({ ...x, sourceProvider: 'Bandcamp search', playbackProvider: 'YouTube mirror' }));
  }
  return youtubeSearch(q, limit);
}

async function resolveUrl(client, url) {
  const normalized = normalizeUrl(url);
  if (!normalized) throw new Error('Please provide a valid http(s) music URL.');
  url = normalized;
  const type = detect(url);

  if (type === 'spotify' || type === 'apple' || type === 'deezer') {
    const meta = type === 'spotify' ? await spotifyMeta(url) : type === 'apple' ? await appleMeta(url) : await deezerMeta(url);
    const found = await bridgeSearch(clean((meta.artist ? meta.artist + ' - ' : '') + meta.title, 240), type === 'spotify' ? 'spotify' : type === 'apple' ? 'apple' : 'deezer', 5);
    const best = found.find(x => normalize(x.title) === normalize(meta.title)) || found[0];
    if (!best) throw new Error('No playable YouTube result was found for that ' + sourceLabel(type) + ' track.');
    return {
      ...best,
      title: meta.title,
      artist: meta.artist,
      duration: meta.duration || best.duration,
      thumbnail: meta.thumbnail || best.thumbnail,
      sourceProvider: sourceLabel(type),
      sourceUrl: url
    };
  }

  if (type === 'tidal') {
    const meta = await tidalMeta(url);
    const found = await youtubeSearch(clean((meta.artist ? meta.artist + ' - ' : '') + meta.title, 240), 8);
    if (!found.length) throw new Error('No playable YouTube result was found for that Tidal track.');
    return { ...found[0], title: meta.title, artist: meta.artist, duration: meta.duration || found[0].duration, thumbnail: meta.thumbnail || found[0].thumbnail, sourceProvider: 'Tidal', sourceUrl: url };
  }

  if (type === 'youtube' || type === 'youtube_music') {
    try {
      const info = await play.video_basic_info(url);
      return infoToTrack(info.video_details, type === 'youtube_music' ? 'YouTube Music' : 'YouTube', url);
    } catch {
      return infoToTrack(await ytdlpInfo(client, url), type === 'youtube_music' ? 'YouTube Music' : 'YouTube', url);
    }
  }

  if (type === 'soundcloud' || type === 'bandcamp' || type === 'unknown') {
    return infoToTrack(await ytdlpInfo(client, url), type === 'soundcloud' ? 'SoundCloud' : type === 'bandcamp' ? 'Bandcamp' : null, url);
  }

  if (type === 'direct' || type === 'radio') {
    let title = url;
    try { title = decodeURIComponent(new URL(url).pathname.split('/').pop() || new URL(url).hostname).replace(/\.[^.]+$/, '').replace(/[-_]/g, ' '); } catch {}
    return {
      id: url,
      title: clean(title, 200),
      artist: host(url),
      duration: 0,
      url,
      playbackUrl: url,
      sourceUrl: url,
      sourceProvider: type === 'radio' ? 'Radio' : 'Direct URL',
      playbackProvider: 'FFmpeg',
      thumbnail: null,
      positionMs: 0
    };
  }

  throw new Error('That music URL is not supported.');
}

function tooLong(client, track) {
  const max = Math.max(0, Number(mc(client).maxTrackLengthSeconds ?? 7200));
  return max > 0 && Number(track.duration || 0) > max;
}

function currentPosition(s) {
  if (!s?.current) return 0;

  const offset = Math.max(0, Number(s.current.positionMs || 0));
  const state = s.player?.state;
  const status = state?.status;

  if (
    status === AudioPlayerStatus.Playing ||
    status === AudioPlayerStatus.Paused ||
    status === AudioPlayerStatus.AutoPaused ||
    status === AudioPlayerStatus.Buffering
  ) {
    const playback = Math.max(0, Number(state?.playbackDuration ?? s.resource?.playbackDuration ?? 0));
    return Math.max(offset, offset + playback);
  }

  return offset;
}

function progressBar(pos, dur) {
  if (!dur) return 'LIVE  ━━━━━━━━━━━━━━━━━━━━━━━━';

  const ratio = clamp(pos / Math.max(1, dur * 1000), 0, 1);
  const size = 24;
  const cursor = Math.min(size - 1, Math.floor(ratio * size));
  return '━'.repeat(cursor) + '●' + '━'.repeat(Math.max(0, size - cursor - 1));
}

function currentSummary(s) {
  if (!s?.current) return 'Nothing is playing.';

  const pos = currentPosition(s);
  const durationMs = Math.max(0, Number(s.current.duration || 0) * 1000);
  const percent = durationMs ? Math.round(clamp(pos / durationMs, 0, 1) * 100) : null;
  const status = s.player?.state?.status === AudioPlayerStatus.Paused ? 'Paused' :
    s.player?.state?.status === AudioPlayerStatus.Playing ? 'Playing' :
    s.player?.state?.status === AudioPlayerStatus.Buffering ? 'Buffering' : 'Ready';

  return '**' + clean(s.current.title, 180) + '**' +
    (s.current.artist ? '\n' + clean(s.current.artist, 120) : '') +
    '\n\n' + progressBar(pos, s.current.duration) +
    '\n**' + fmtMs(pos) + '** / **' + (s.current.duration ? fmt(s.current.duration) : 'LIVE') + '**' +
    (percent == null ? '' : ' · **' + percent + '%**') +
    '\n' + status + ' · ' + sourceLabel(s.current.sourceProvider);
}

function queueText(s) {
  const lines = [];
  if (s?.current) lines.push('▶ **Now Playing:** ' + clean(s.current.title, 80) + ' · ' + fmt(s.current.duration));
  if (s?.queue?.length) {
    lines.push(...s.queue.slice(0, 12).map((x, i) =>
      (i + 1) + '. **' + clean(x.title, 80) + '** · ' + fmt(x.duration)
    ));
    if (s.queue.length > 12) lines.push('…and ' + (s.queue.length - 12) + ' more.');
  }
  return lines.join('\n') || 'The queue is empty.';
}

function sortResults(results, sort) {
  const list = [...(results || [])];
  if (sort === 'newest') return list.sort((a, b) => String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || '')));
  if (sort === 'oldest') return list.sort((a, b) => String(a.uploadedAt || '').localeCompare(String(b.uploadedAt || '')));
  if (sort === 'shortest') return list.sort((a, b) => (a.duration || Infinity) - (b.duration || Infinity));
  if (sort === 'longest') return list.sort((a, b) => (b.duration || 0) - (a.duration || 0));
  if (sort === 'az') return list.sort((a, b) => a.title.localeCompare(b.title));
  if (sort === 'za') return list.sort((a, b) => b.title.localeCompare(a.title));
  if (sort === 'relevance') return list;
  return list.sort((a, b) => Number(b.popularity || b.views || 0) - Number(a.popularity || a.views || 0));
}

function panelPayload(client, s) {
  const pages = Math.max(1, Math.ceil(s.panel.results.length / 10));
  const e = makeEmbed(client, s.panel.view === 'queue' ? 'Music Center · Queue' : 'Music Center', currentSummary(s));
  if (s.current?.thumbnail) e.setThumbnail(s.current.thumbnail);

  if (s.panel.view === 'queue') {
    e.addFields(
      { name: 'Queue', value: queueText(s), inline: false },
      { name: 'Volume', value: String(s.volume) + '%', inline: true },
      { name: 'Loop', value: s.loop, inline: true },
      { name: 'Queued', value: String(s.queue.length), inline: true }
    );
  } else {
    const start = s.panel.page * 10;
    const list = s.panel.results.slice(start, start + 10);
    e.addFields({
      name: s.panel.query ? 'Search · ' + clean(s.panel.query, 90) : 'Search',
      value: list.length ? list.map((x, i) => (start + i + 1) + '. **' + clean(x.title, 65) + '** · ' + fmt(x.duration) + ' · ' + clean(x.sourceProvider, 25)).join('\n') : 'Use Search to find music.',
      inline: false
    });
    e.addFields(
      { name: 'Page', value: (s.panel.page + 1) + ' / ' + pages, inline: true },
      { name: 'Sort', value: SORTS.find(x => x[0] === s.panel.sort)?.[1] || 'Popular', inline: true },
      { name: 'Volume', value: String(s.volume) + '%', inline: true }
    );
  }

  const rows = [];
  if (s.panel.view === 'search') {
    const start = s.panel.page * 10;
    const options = s.panel.results.slice(start, start + 10).map((x, i) => ({
      label: clean(x.title || 'Unknown track', 100),
      description: clean((x.artist ? x.artist + ' · ' : '') + fmt(x.duration) + ' · ' + x.sourceProvider, 100),
      value: String(start + i),
      default: Number(s.panel.selected) === start + i
    }));
    if (options.length) rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('rn-music:result').setPlaceholder('Choose a track').addOptions(options)
    ));
    rows.push(new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder().setCustomId('rn-music:sort').setPlaceholder('Sort · Popular by default').addOptions(SORTS.map(x => ({ label: x[1], value: x[0], default: s.panel.sort === x[0] })))
    ));
  }

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rn-music:search').setLabel('Search').setStyle(ButtonStyle.Primary),
    new ButtonBuilder().setCustomId('rn-music:play').setLabel('Play Selected').setStyle(ButtonStyle.Success).setDisabled(!s.panel.results.length || s.panel.selected == null),
    new ButtonBuilder().setCustomId('rn-music:prev-page').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(s.panel.view !== 'search' || s.panel.page <= 0),
    new ButtonBuilder().setCustomId('rn-music:next-page').setLabel('Next').setStyle(ButtonStyle.Secondary).setDisabled(s.panel.view !== 'search' || s.panel.page >= pages - 1),
    new ButtonBuilder().setCustomId('rn-music:queue').setLabel(s.panel.view === 'queue' ? 'Search' : 'Queue').setStyle(ButtonStyle.Secondary)
  ));

  const paused = s.player.state.status === AudioPlayerStatus.Paused;
  const playing = s.player.state.status === AudioPlayerStatus.Playing;

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rn-music:previous').setLabel('Previous').setStyle(ButtonStyle.Secondary).setDisabled(!s.history.length),
    new ButtonBuilder().setCustomId('rn-music:rewind').setLabel('Rewind 10s').setStyle(ButtonStyle.Secondary).setDisabled(!s.current),
    new ButtonBuilder().setCustomId('rn-music:pause').setLabel(paused ? 'Resume' : 'Pause').setStyle(ButtonStyle.Primary).setDisabled(!s.current || (!playing && !paused)),
    new ButtonBuilder().setCustomId('rn-music:forward').setLabel('Forward 10s').setStyle(ButtonStyle.Secondary).setDisabled(!s.current),
    new ButtonBuilder().setCustomId('rn-music:skip').setLabel('Skip').setStyle(ButtonStyle.Secondary).setDisabled(!s.current)
  ));

  rows.push(new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('rn-music:stop').setLabel('Stop').setStyle(ButtonStyle.Danger).setDisabled(!s.current && !s.queue.length),
    new ButtonBuilder().setCustomId('rn-music:shuffle').setLabel('Shuffle').setStyle(ButtonStyle.Secondary).setDisabled(s.queue.length < 2),
    new ButtonBuilder().setCustomId('rn-music:loop').setLabel('Loop: ' + s.loop).setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('rn-music:volume-down').setLabel('Vol -').setStyle(ButtonStyle.Secondary).setDisabled(s.volume <= 0),
    new ButtonBuilder().setCustomId('rn-music:volume-up').setLabel('Vol +').setStyle(ButtonStyle.Secondary).setDisabled(s.volume >= s.maxVolume)
  ));

  return { embeds: [e], components: rows };
}

async function refreshPanel(guildId, client) {
  const s = sessions.get(guildId);
  if (!s?.panel?.messageId || !s.panel.channelId) return;
  const ch = client.channels.cache.get(s.panel.channelId);
  const message = await ch?.messages?.fetch(s.panel.messageId).catch(() => null);
  if (message) await message.edit(panelPayload(client, s)).catch(() => {});
}

async function cleanupActiveStream(s) {
  if (!s?.streamCleanup) return;
  const cleanup = s.streamCleanup;
  s.streamCleanup = null;
  try { cleanup(); } catch {}
  // Let the destroyed stream/child process settle before another FFmpeg
  // instance is attached to the same audio player.
  await new Promise(resolve => setImmediate(resolve));
}

async function playTrack(guildId, client, track, offsetMs) {
  const s = getSession(guildId, client);
  s.transition = true;

  let streamCleanup = null;

  try {
    await cleanupActiveStream(s);
    try { s.player.stop(true); } catch {}
    s.resource = null;

    const input = normalizeUrl(track.playbackUrl || track.url || track.sourceUrl);
    if (!input) throw new Error('This track has no valid playback URL.');

    let stream;
    let inputType = StreamType.Raw;
    const provider = String(track.playbackProvider || '').toLowerCase();

    if (provider === 'ffmpeg') {
      const result = await ffmpegDirectStream(input, Number(offsetMs || 0) / 1000);
      stream = result.stream;
      inputType = result.inputType;
      streamCleanup = result.cleanup;
    } else {
      const result = await ytdlpStream(client, input, Number(offsetMs || 0) / 1000);
      stream = result.stream;
      inputType = result.inputType;
      streamCleanup = result.cleanup;
    }

    s.streamCleanup = streamCleanup;
    streamCleanup = null;

    s.current = { ...track, positionMs: Number(offsetMs || 0) };
    s.startedAt = Date.now();
    s.pausedAt = 0;

    s.resource = createAudioResource(stream, {
      inputType,
      inlineVolume: true,
      silencePaddingFrames: 5,
      metadata: { trackId: track.id || track.url }
    });

    s.resource.volume?.setVolume(clamp(s.volume / 100, 0, 1.5));
    s.connection?.subscribe(s.player);
    s.player.play(s.resource);
    s.skipVotes.clear();
  } catch (error) {
    if (streamCleanup) {
      try { streamCleanup(); } catch {}
    }
    throw error;
  } finally {
    s.transition = false;
  }

  await refreshPanel(guildId, client);
}

async function advance(guildId, client, reason) {
  const s = sessions.get(guildId);
  if (!s || s.transition) return;
  s.transition = true;

  const old = s.current;
  if (old) old.positionMs = currentPosition(s);

  try {
    if (old && reason !== 'stop' && reason !== 'error') {
      if (s.loop === 'track') s.queue.unshift({ ...old, positionMs: 0 });
      else if (s.loop === 'queue') s.queue.push({ ...old, positionMs: 0 });
      else {
        s.history.push({ ...old, positionMs: 0 });
        if (s.history.length > 50) s.history.shift();
      }
    }

    const next = s.queue[0];
    if (!next) {
      s.current = null;
      s.resource = null;
      s.transition = false;
      await refreshPanel(guildId, client);
      return;
    }

    s.current = null;
    s.resource = null;
    s.transition = false;

    try {
      await playTrack(guildId, client, next, 0);
      // Only remove a queued track after its stream has successfully started.
      s.queue.shift();
    } catch (e) {
      // Drop only the track that actually failed, then try the next queued track.
      s.queue.shift();
      console.error('[Voice/Music] Failed track:', next.title, e?.message || e);

      if (s.queue.length) {
        await advance(guildId, client, 'error');
      } else {
        s.current = null;
        s.resource = null;
        await refreshPanel(guildId, client);
        if (!old) throw e;
      }
    }
  } finally {
    s.transition = false;
  }
}

function installHooks(guildId, client) {
  const s = getSession(guildId, client);
  if (s.hooks) return;
  s.hooks = true;

  s.player.on(AudioPlayerStatus.Idle, () => {
    if (s.transition) return;
    const fadeSeconds = clamp(mc(client).crossfadeSeconds || mc(client).crossfadeDuration || 0, 0, 10);
    if (fadeSeconds > 0 && s.current?.duration && s.resource?.volume) {
      const steps = Math.max(1, Math.floor(fadeSeconds * 10));
      let step = 0;
      const interval = setInterval(() => {
        step++;
        s.resource?.volume?.setVolume(clamp((s.volume / 100) * (1 - step / steps), 0, 1.5));
        if (step >= steps) {
          clearInterval(interval);
          advance(guildId, client, 'natural').catch(() => {});
        }
      }, 100);
      return;
    }
    advance(guildId, client, 'natural').catch(() => {});
  });

  s.player.on('error', error => {
    console.error('[Voice/Music] AudioPlayer error:', error?.message || error);
    if (!s.transition) advance(guildId, client, 'error').catch(() => {});
  });
}

function activeTtsRoom(client, guildId, channelId) {
  return [...(client.voiceRooms?.values?.() || []), ...(client.voiceTtsRooms?.values?.() || [])]
    .find(room => room?.guildId === guildId &&
      room?.voiceChannelId === channelId &&
      (room.ttsPlaying || room.ttsPump || room.ttsQueue?.length));
}

async function addTrack(client, interaction, track) {
  const s = getSession(interaction.guildId, client);
  if (!interaction.member?.voice?.channelId) throw new Error('Join a voice channel first.');

  // Search results from external providers can occasionally have metadata but no
  // playable mirror URL. Recover it here instead of sending an empty URL to yt-dlp.
  const playbackUrl = normalizeUrl(track?.playbackUrl || track?.url);
  if (!playbackUrl) {
    const fallbackQuery = clean((track?.artist ? track.artist + ' - ' : '') + (track?.title || ''), 240);
    if (!fallbackQuery) throw new Error('That track has no playable URL.');
    const fallback = (await youtubeSearch(fallbackQuery, 5))[0];
    if (!fallback?.playbackUrl) throw new Error('Could not find a playable URL for that track.');
    track = {
      ...track,
      ...fallback,
      title: track.title || fallback.title,
      artist: track.artist || fallback.artist,
      duration: track.duration || fallback.duration,
      thumbnail: track.thumbnail || fallback.thumbnail,
      sourceProvider: track.sourceProvider || fallback.sourceProvider,
      sourceUrl: track.sourceUrl || fallback.sourceUrl,
      playbackProvider: 'YouTube mirror'
    };
  } else if (track.playbackUrl !== playbackUrl || track.url !== playbackUrl) {
    track = { ...track, playbackUrl, url: playbackUrl };
  }

  if (tooLong(client, track)) throw new Error('That track is over the configured maximum length.');

  const max = Math.max(1, Number(mc(client).maxQueueSize || 100));
  if (s.current && s.queue.length >= max) throw new Error('The music queue is full.');

  if (activeTtsRoom(client, interaction.guildId, interaction.member.voice.channelId)) {
    throw new Error('TTS is currently active in this voice room. Wait for it to finish before starting music.');
  }

  // Always follow the requester's current voice channel.
  await connect(interaction.member, client);

  s.textChannelId = interaction.channelId;
  s.queue.push({ ...track, positionMs: 0 });

  if (!s.current) {
    await advance(interaction.guildId, client, 'start');
    return 'started';
  }
  return 'queued';
}

async function lyricsFor(client, track) {
  if (!track) throw new Error('Nothing is playing.');
  if (!process.env.GENIUS_ACCESS_TOKEN) throw new Error('Set GENIUS_ACCESS_TOKEN to enable lyrics.');
  let Genius;
  try { Genius = require('genius-lyrics'); } catch { throw new Error('Lyrics dependency is not installed.'); }
  const g = new Genius.Client(process.env.GENIUS_ACCESS_TOKEN);
  const q = clean((track.artist ? track.title + ' ' + track.artist : track.title), 240);
  const result = await g.songs.search(q);
  if (!result?.length) throw new Error('No lyrics found.');
  const lyrics = await result[0].lyrics();
  return clean(lyrics || 'No lyrics found.', 3900);
}

async function voteSkip(interaction, client) {
  const s = sessions.get(interaction.guildId);
  if (!s?.current) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });

  const channel = interaction.guild.channels.cache.get(s.connection?.joinConfig?.channelId || interaction.member?.voice?.channelId);
  const humans = channel?.members?.filter(m => !m.user.bot).size || 1;
  const threshold = clamp(mc(client).voteSkipThreshold || 50, 1, 100) / 100;
  const required = Math.max(1, Math.ceil(humans * threshold));

  s.skipVotes.add(interaction.user.id);
  if (s.skipVotes.size >= required) {
    const title = s.current.title;
    s.skipVotes.clear();
    s.player.stop(true);
    await advance(interaction.guildId, client, 'skip');
    return interaction.reply('Vote passed. Skipped **' + clean(title, 180) + '**.');
  }

  return interaction.reply({ content: 'Vote registered: **' + s.skipVotes.size + '/' + required + '**.', flags: MessageFlags.Ephemeral });
}

async function controlAllowed(interaction, client) {
  const s = sessions.get(interaction.guildId);
  const botChannel = s?.connection?.joinConfig?.channelId;
  if (!botChannel) return Boolean(interaction.member?.voice?.channelId);
  if (interaction.member?.voice?.channelId === botChannel) return true;
  const role = String(mc(client).djRoleId || '');
  return Boolean(role && interaction.member?.roles?.cache?.has(role));
}

async function panelSearch(interaction, client) {
  const s = getSession(interaction.guildId, client);
  const modal = new ModalBuilder().setCustomId('rn-music-modal:search').setTitle('Search Music');

  const q = new TextInputBuilder()
    .setCustomId('query')
    .setLabel('Song, artist, album, or URL')
    .setStyle(TextInputStyle.Short)
    .setRequired(true)
    .setMaxLength(200)
    .setPlaceholder('Search or paste a link');

  const source = new TextInputBuilder()
    .setCustomId('source')
    .setLabel('Source (optional)')
    .setStyle(TextInputStyle.Short)
    .setRequired(false)
    .setMaxLength(30)
    .setPlaceholder('auto, spotify, apple, soundcloud...');

  void s;
  return interaction.showModal(modal.addComponents(
    new ActionRowBuilder().addComponents(q),
    new ActionRowBuilder().addComponents(source)
  ));
}

async function openMusic(interaction, client) {
  const s = getSession(interaction.guildId, client);
  s.textChannelId = interaction.channelId;
  s.panel.channelId = interaction.channelId;
  s.panel.view = 'search';
  s.panel.messageId = null;

  const query = interaction.options?.getString('query');
  const source = interaction.options?.getString('source') || 'auto';

  if (query) {
    await interaction.deferReply();
    try {
      s.panel.query = clean(query, 200);
      s.panel.source = source;
      s.panel.page = 0;
      s.panel.results = sortResults(
        /^https?:\/\//i.test(query) ? [await resolveUrl(client, query)] : await searchTracks(client, query, source, Number(mc(client).panelSearchLimit || 25)),
        s.panel.sort
      );
      // A query/URL produces an immediately playable first result.
      s.panel.selected = s.panel.results.length ? 0 : null;
    } catch (e) {
      return interaction.editReply('Music search failed: ' + (e?.message || e));
    }
    const message = await interaction.editReply(panelPayload(client, s));
    s.panel.messageId = message.id;
    return;
  }

  await interaction.reply(panelPayload(client, s));
  const message = await interaction.fetchReply();
  s.panel.messageId = message.id;
}

async function handleModal(interaction, client) {
  if (interaction.customId !== 'rn-music-modal:search') return;
  const s = getSession(interaction.guildId, client);
  const query = clean(interaction.fields.getTextInputValue('query'), 200);
  const raw = clean(interaction.fields.getTextInputValue('source') || 'auto', 30).toLowerCase();
  const source = SOURCES.some(x => x[0] === raw) ? raw : 'auto';

  await interaction.deferUpdate();
  try {
    s.panel.query = query;
    s.panel.source = source;
    s.panel.page = 0;
    s.panel.results = sortResults(
      /^https?:\/\//i.test(query) ? [await resolveUrl(client, query)] : await searchTracks(client, query, source, Number(mc(client).panelSearchLimit || 25)),
      s.panel.sort
    );
    s.panel.selected = s.panel.results.length ? 0 : null;
    s.panel.messageId = interaction.message.id;
    s.panel.channelId = interaction.channelId;
    await interaction.message.edit(panelPayload(client, s));
  } catch (e) {
    await interaction.followUp({ content: 'Music search failed: ' + (e?.message || e), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function handleComponent(interaction, client) {
  const id = interaction.customId || '';
  const s = getSession(interaction.guildId, client);

  if (s.panel.messageId && interaction.message?.id && s.panel.messageId !== interaction.message.id) {
    return interaction.reply({ content: 'This music panel is no longer active.', flags: MessageFlags.Ephemeral });
  }

  if (id === 'rn-music:search') return panelSearch(interaction, client);

  if (id === 'rn-music:result') {
    s.panel.selected = Number(interaction.values?.[0]);
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:sort') {
    s.panel.sort = interaction.values?.[0] || 'popular';
    s.panel.results = sortResults(s.panel.results, s.panel.sort);
    s.panel.page = 0;
    s.panel.selected = s.panel.results.length ? 0 : null;
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:prev-page' || id === 'rn-music:next-page') {
    const pages = Math.max(1, Math.ceil(s.panel.results.length / 10));
    s.panel.page = id.endsWith('prev-page') ? Math.max(0, s.panel.page - 1) : Math.min(pages - 1, s.panel.page + 1);
    const start = s.panel.page * 10;
    s.panel.selected = start < s.panel.results.length ? start : null;
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:queue') {
    s.panel.view = s.panel.view === 'queue' ? 'search' : 'queue';
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:play') {
    const selected = Number(s.panel.selected);
    const track = Number.isInteger(selected) && selected >= 0 ? s.panel.results[selected] : null;
    if (!track) return interaction.reply({ content: 'Select a track first.', flags: MessageFlags.Ephemeral });
    if (!interaction.member?.voice?.channelId) {
      return interaction.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
    }

    await interaction.deferUpdate();
    try {
      // Play/queue follows the user's current voice channel.
      const state = await addTrack(client, interaction, track);
      await interaction.message.edit(panelPayload(client, s));
      if (state === 'queued') await interaction.followUp({ content: 'Queued **' + clean(track.title, 180) + '**.', flags: MessageFlags.Ephemeral });
    } catch (e) {
      await interaction.followUp({ content: 'Could not play that track: ' + (e?.message || e), flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  if (!(await controlAllowed(interaction, client))) {
    return interaction.reply({ content: 'Join the bot in its music voice channel to use playback controls.', flags: MessageFlags.Ephemeral });
  }

  if (id === 'rn-music:pause') {
    if (!s.current) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    if (s.player.state.status === AudioPlayerStatus.Playing) {
      s.pausedAt = currentPosition(s);
      s.player.pause(false);
    } else if (s.player.state.status === AudioPlayerStatus.Paused) {
      s.startedAt = Date.now() - s.pausedAt;
      s.player.unpause();
    }
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:rewind' || id === 'rn-music:forward') {
    if (!s.current) return interaction.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
    const target = Math.max(0, currentPosition(s) + (id.endsWith('rewind') ? -10000 : 10000));
    await interaction.deferUpdate();
    try {
      await playTrack(interaction.guildId, client, { ...s.current }, target);
      await interaction.message.edit(panelPayload(client, s));
    } catch (e) {
      await interaction.followUp({ content: 'Seek failed: ' + (e?.message || e), flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  if (id === 'rn-music:previous') {
    const previous = s.history.pop();
    if (!previous) return interaction.reply({ content: 'No previous track.', flags: MessageFlags.Ephemeral });
    await interaction.deferUpdate();
    try {
      if (s.current) s.queue.unshift({ ...s.current, positionMs: 0 });
      await playTrack(interaction.guildId, client, previous, 0);
      await interaction.message.edit(panelPayload(client, s));
    } catch (e) {
      await interaction.followUp({ content: 'Could not go back: ' + (e?.message || e), flags: MessageFlags.Ephemeral }).catch(() => {});
    }
    return;
  }

  if (id === 'rn-music:skip') {
    if (s.transition) return interaction.reply({ content: 'The player is already changing tracks.', flags: MessageFlags.Ephemeral });
    s.transition = true;
    try { s.player.stop(true); } catch {}
    s.transition = false;
    await advance(interaction.guildId, client, 'skip');
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:stop') {
    s.transition = true;
    await cleanupActiveStream(s);
    s.queue = [];
    s.history = [];
    s.current = null;
    s.resource = null;
    try { s.player.stop(true); } catch {}
    s.transition = false;
    try { s.connection?.destroy(); } catch {}
    s.connection = null;
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:shuffle') {
    for (let i = s.queue.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [s.queue[i], s.queue[j]] = [s.queue[j], s.queue[i]];
    }
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:loop') {
    s.loop = s.loop === 'off' ? 'track' : s.loop === 'track' ? 'queue' : 'off';
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:lyrics') {
    try {
      const lyrics = await lyricsFor(client, s.current);
      return interaction.reply({ embeds: [makeEmbed(client, 'Lyrics · ' + clean(s.current.title, 150), lyrics)], flags: MessageFlags.Ephemeral });
    } catch (e) {
      return interaction.reply({ content: e?.message || 'Lyrics unavailable.', flags: MessageFlags.Ephemeral });
    }
  }

  if (id === 'rn-music:volume-down') {
    s.volume = clamp(s.volume - 10, 0, s.maxVolume);
    s.resource?.volume?.setVolume(s.volume / 100);
    return interaction.update(panelPayload(client, s));
  }

  if (id === 'rn-music:volume-up') {
    s.volume = clamp(s.volume + 10, 0, s.maxVolume);
    s.resource?.volume?.setVolume(s.volume / 100);
    return interaction.update(panelPayload(client, s));
  }
}

const newCommands = [
  {
    data: new SlashCommandBuilder()
      .setName('music')
      .setDescription('Open the full music player GUI')
      .addStringOption(o => o.setName('query').setDescription('Optional song search or URL'))
      .addStringOption(o => o.setName('source').setDescription('Search source').addChoices(...SOURCES.map(x => ({ name: x[1], value: x[0] })))),
    execute: (i, c) => openMusic(i, c)
  },
  {
    data: new SlashCommandBuilder().setName('pause').setDescription('Pause music'),
    execute: async (i, c) => {
      const s = sessions.get(i.guildId);
      if (!s?.current) return i.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      if (!(await controlAllowed(i, c))) return i.reply({ content: 'Join the bot in the music voice channel first.', flags: MessageFlags.Ephemeral });
      s.pausedAt = currentPosition(s);
      s.player.pause(false);
      return i.reply('Paused.');
    }
  },
  {
    data: new SlashCommandBuilder().setName('resume').setDescription('Resume music'),
    execute: async (i, c) => {
      const s = sessions.get(i.guildId);
      if (!s?.current) return i.reply({ content: 'Nothing is paused.', flags: MessageFlags.Ephemeral });
      if (!(await controlAllowed(i, c))) return i.reply({ content: 'Join the bot in the music voice channel first.', flags: MessageFlags.Ephemeral });
      s.startedAt = Date.now() - s.pausedAt;
      s.player.unpause();
      return i.reply('Resumed.');
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('seek')
      .setDescription('Seek in the current song')
      .addIntegerOption(o => o.setName('seconds').setDescription('Absolute position in seconds').setRequired(true).setMinValue(0).setMaxValue(86400)),
    execute: async (i, c) => {
      const s = sessions.get(i.guildId);
      if (!s?.current) return i.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      if (!(await controlAllowed(i, c))) return i.reply({ content: 'Join the bot in the music voice channel first.', flags: MessageFlags.Ephemeral });
      await i.deferReply();
      try {
        const offset = i.options.getInteger('seconds', true) * 1000;
        await playTrack(i.guildId, c, { ...s.current }, offset);
        return i.editReply('Seeked to ' + fmtMs(offset) + '.');
      } catch (e) {
        return i.editReply('Seek failed: ' + (e?.message || e));
      }
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('loop')
      .setDescription('Set loop mode')
      .addStringOption(o => o.setName('mode').setDescription('Loop mode').setRequired(true).addChoices(
        { name: 'Off', value: 'off' },
        { name: 'Track', value: 'track' },
        { name: 'Queue', value: 'queue' }
      )),
    execute: async (i, c) => {
      const s = getSession(i.guildId, c);
      s.loop = i.options.getString('mode', true);
      await refreshPanel(i.guildId, c);
      return i.reply('Loop mode: **' + s.loop + '**.');
    }
  },
  {
    data: new SlashCommandBuilder().setName('lyrics').setDescription('Show lyrics for the current song'),
    execute: async (i, c) => {
      const s = sessions.get(i.guildId);
      if (!s?.current) return i.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      try {
        const lyrics = await lyricsFor(c, s.current);
        return i.reply({ embeds: [makeEmbed(c, 'Lyrics · ' + clean(s.current.title, 150), lyrics)], flags: MessageFlags.Ephemeral });
      } catch (e) {
        return i.reply({ content: e?.message || 'Lyrics unavailable.', flags: MessageFlags.Ephemeral });
      }
    }
  },
  {
    data: new SlashCommandBuilder().setName('vote_skip').setDescription('Vote to skip the current song'),
    execute: (i, c) => voteSkip(i, c)
  },
  {
    data: new SlashCommandBuilder()
      .setName('add_to_playlist')
      .setDescription('Save a music URL to a playlist')
      .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true))
      .addStringOption(o => o.setName('url').setDescription('Music URL').setRequired(true)),
    execute: async (i, c) => {
      await i.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        const track = await resolveUrl(c, i.options.getString('url', true));
        const name = clean(i.options.getString('name', true), 60).toLowerCase();
        const key = 'music:playlist:' + name;
        const list = await c.db.get(i.guildId, key, []).catch(() => []);
        if (list.length >= Number(mc(c).maxPlaylistSize || 200)) throw new Error('Playlist is full.');
        list.push({ url: track.sourceUrl || track.url, title: track.title });
        await c.db.set(i.guildId, key, list);
        const index = await c.db.get(i.guildId, 'music:playlist:index', []).catch(() => []);
        const rows = Array.isArray(index) ? index.filter(x => x && x.name) : [];
        const entry = rows.find(x => String(x.name).toLowerCase() === name);
        if (entry) entry.count = list.length;
        else rows.push({ name, count: list.length });
        await c.db.set(i.guildId, 'music:playlist:index', rows);
        return i.editReply('Added **' + clean(track.title, 160) + '** to **' + name + '**.');
      } catch (e) {
        return i.editReply('Playlist failed: ' + (e?.message || e));
      }
    }
  },
  {
    data: new SlashCommandBuilder()
      .setName('play_playlist')
      .setDescription('Queue a saved playlist')
      .addStringOption(o => o.setName('name').setDescription('Playlist name').setRequired(true)),
    execute: async (i, c) => {
      if (!i.member?.voice?.channel) return i.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
      await i.deferReply();
      const name = clean(i.options.getString('name', true), 60).toLowerCase();
      try {
        const list = await c.db.get(i.guildId, 'music:playlist:' + name, []);
        if (!Array.isArray(list) || !list.length) return i.editReply('Playlist **' + name + '** does not exist or is empty.');
        const s = getSession(i.guildId, c);
        let added = 0;
        for (const entry of list.slice(0, Number(mc(c).maxQueueSize || 100))) {
          try {
            const track = await resolveUrl(c, entry.url);
            if (!tooLong(c, track) && s.queue.length < Number(mc(c).maxQueueSize || 100)) {
              s.queue.push(track);
              added++;
            }
          } catch {}
        }
        s.textChannelId = i.channelId;
        await connect(i.member, c);
        if (!s.current) await advance(i.guildId, c, 'start');
        return i.editReply('Queued **' + added + '** track(s) from **' + name + '**.');
      } catch (e) {
        return i.editReply('Playlist failed: ' + (e?.message || e));
      }
    }
  },
  {
    data: new SlashCommandBuilder().setName('playlists').setDescription('List saved playlists'),
    execute: async (i, c) => {
      const rows = await c.db.get(i.guildId, 'music:playlist:index', []).catch(() => []);
      return i.reply({ embeds: [makeEmbed(c, 'Music Playlists', Array.isArray(rows) && rows.length ? rows.map(x => '• **' + clean(x.name, 50) + '** · ' + x.count).join('\n') : 'No playlists saved.')] });
    }
  }
];

function installLegacyCommands(commands) {
  const handlers = {
    play: async (i, c) => {
      const query = i.options.getString('query', true);
      const source = i.options.getString('source') || 'auto';
      if (!i.member?.voice?.channel) return i.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
      const s = getSession(i.guildId, c);
      const tts = [...(c.voiceRooms?.values?.() || []), ...(c.voiceTtsRooms?.values?.() || [])].find(r => r.guildId === i.guildId && r.voiceChannelId === i.member.voice.channelId && (r.ttsPlaying || r.ttsQueue?.length || r.ttsPump));
      if (tts) return i.reply({ content: 'TTS is active in this voice channel. Wait for it to finish before starting music.', flags: MessageFlags.Ephemeral });
      await i.deferReply();
      try {
        const track = /^https?:\/\//i.test(query) ? await resolveUrl(c, query) : (await searchTracks(c, query, source, mc(c).searchLimit || 5))[0];
        if (!track) return i.editReply('No music results found.');
        const state = await addTrack(c, i, track);
        return i.editReply((state === 'started' ? 'Starting **' : 'Queued **') + clean(track.title, 180) + '**.');
      } catch (e) {
        return i.editReply('Music failed: ' + (e?.message || e));
      }
    },
    skip: async (i, c) => {
      const s = sessions.get(i.guildId);
      if (!s?.current) return i.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      if (!(await controlAllowed(i, c))) return i.reply({ content: 'Join the bot in its music voice channel first.', flags: MessageFlags.Ephemeral });
      if (s.transition) return i.reply({ content: 'The player is already changing tracks.', flags: MessageFlags.Ephemeral });
      s.transition = true;
      try { s.player.stop(true); } catch {}
      s.transition = false;
      await advance(i.guildId, c, 'skip');
      return i.reply('Skipped.');
    },
    stop: async (i, c) => {
      const s = sessions.get(i.guildId);
      if (!s) return i.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      if (!(await controlAllowed(i, c))) return i.reply({ content: 'Join the bot in its music voice channel first.', flags: MessageFlags.Ephemeral });
      await cleanupActiveStream(s);
      s.queue = [];
      s.history = [];
      s.current = null;
      s.resource = null;
      s.player.stop(true);
      try { s.connection?.destroy(); } catch {}
      sessions.delete(i.guildId);
      return i.reply('Stopped and cleared the queue.');
    },
    queue: async (i, c) => {
      if (!i.member?.voice?.channelId) return i.reply({ content: 'Join a voice channel first.', flags: MessageFlags.Ephemeral });
      const s = sessions.get(i.guildId);
      return i.reply({ embeds: [makeEmbed(c, 'Music Queue', queueText(s))] });
    },
    volume: async (i, c) => {
      const s = sessions.get(i.guildId);
      if (!s) return i.reply({ content: 'Nothing is playing.', flags: MessageFlags.Ephemeral });
      s.volume = clamp(i.options.getInteger('percent', true), 0, s.maxVolume);
      s.resource?.volume?.setVolume(s.volume / 100);
      return i.reply('Volume set to **' + s.volume + '%**.');
    },
    nowplaying: async (i, c) => i.reply({ embeds: [makeEmbed(c, 'Now Playing', currentSummary(sessions.get(i.guildId)))] })
  };

  for (const [name, execute] of Object.entries(handlers)) {
    const command = commands.find(x => x.data.name === name);
    if (command) command.execute = execute;
  }
}

async function autoLeave(client) {
  const delayMs = clamp(mc(client).leaveDelaySeconds == null ? 180 : mc(client).leaveDelaySeconds, 30, 3600) * 1000;

  for (const [guildId, s] of [...sessions.entries()]) {
    const channelId = s.connection?.joinConfig?.channelId;
    if (!channelId) continue;
    const guild = client.guilds.cache.get(guildId);
    const channel = guild?.channels?.cache.get(channelId);
    if (!channel) continue;

    const humans = channel.members.filter(m => !m.user.bot).size;
    if (humans > 0) {
      s.emptySince = 0;
      continue;
    }

    if (!s.emptySince) s.emptySince = Date.now();
    if (Date.now() - s.emptySince < delayMs) continue;

    for (const room of [...(client.voiceRooms?.values?.() || []), ...(client.voiceTtsRooms?.values?.() || [])]) {
      if (room?.guildId !== guildId || room.voiceChannelId !== channelId) continue;
      try {
        const tts = require('./tts-service');
        await tts.stop(room, client);
      } catch {}
      if (room.ttsConnection === s.connection) room.ttsConnection = null;
    }

    s.transition = true;
    await cleanupActiveStream(s);
    try { s.player.stop(true); } catch {}
    try { s.connection?.destroy(); } catch {}
    sessions.delete(guildId);
  }
}

const listeners = [
  {
    event: 'interactionCreate',
    handle: async (interaction, client) => {
      try {
        if (interaction.isModalSubmit?.() && interaction.customId?.startsWith('rn-music-modal:')) return handleModal(interaction, client);
        if ((interaction.isButton?.() || interaction.isStringSelectMenu?.()) && interaction.customId?.startsWith('rn-music:')) return handleComponent(interaction, client);
      } catch (e) {
        console.error('[Voice/Music/Panel]', e?.stack || e);
        if (!interaction.replied && !interaction.deferred) await interaction.reply({ content: 'Music panel action failed.', flags: MessageFlags.Ephemeral }).catch(() => {});
      }
    }
  }
];

async function initialize(client, sharedSessions) {
  sessions = sharedSessions;
  client.voiceSessions = sessions;
  for (const [guildId] of sessions) installHooks(guildId, client);

  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = setInterval(() => autoLeave(client).catch(e => console.error('[Voice/Music] Auto leave:', e?.message || e)), 5000);
  monitorTimer.unref?.();

  if (panelTimer) clearInterval(panelTimer);
  // Warm the static FFmpeg dependency during module startup so the first /play
  // does not have to discover a missing package/binary silently.
  ensureFfmpeg()
    .then(binary => console.log('[Voice/Music] Static FFmpeg ready:', binary))
    .catch(error => console.error('[Voice/Music] Static FFmpeg bootstrap failed:', error?.message || error));

  panelTimer = setInterval(() => {
    for (const [guildId] of sessions) refreshPanel(guildId, client).catch(() => {});
  }, 5000);
  panelTimer.unref?.();
}

async function destroy() {
  if (monitorTimer) clearInterval(monitorTimer);
  if (panelTimer) clearInterval(panelTimer);
  monitorTimer = null;
  panelTimer = null;
}

module.exports = {
  newCommands,
  listeners,
  initialize,
  destroy,
  installLegacyCommands,
  searchTracks,
  resolveUrl,
  panelPayload,
  connect,
  advance,
  getSession
};
