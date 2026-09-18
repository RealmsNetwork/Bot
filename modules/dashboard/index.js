const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const yaml = require('js-yaml');
const { refreshCommands } = require('../../lib/module-loader');
const { handle: handleDiscord } = require('./discord-api');

let server = null;
const sessions = new Map();
const audit = [];
const root = path.join(__dirname, '..', '..');
const webRoot = path.join(__dirname, 'web');
const publicRoot = path.join(__dirname, 'public');
const auditFile = path.join(root, 'data', 'admin-audit.json');
const loginAttempts = new Map();
const requestBuckets = new Map();
let cleanupTimer = null;

function now() { return new Date().toISOString(); }
function headers(type, cache = 'no-store') {
  return {
    'content-type': type,
    'cache-control': cache,
    'x-content-type-options': 'nosniff',
    'referrer-policy': 'no-referrer',
    'x-frame-options': 'DENY',
    'permissions-policy': 'camera=(), microphone=(), geolocation=(), payment=()',
    'content-security-policy': "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'"
  };
}
function json(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, headers('application/json; charset=utf-8'));
  res.end(JSON.stringify(data));
}
function text(res, status, data, type = 'text/plain; charset=utf-8') {
  if (res.headersSent) return;
  res.writeHead(status, headers(type));
  res.end(data);
}
function loadAudit() {
  audit.length = 0;
  try {
    const data = JSON.parse(fs.readFileSync(auditFile, 'utf8'));
    if (Array.isArray(data)) audit.push(...data.slice(0, 500));
  } catch {}
}
function persistAudit() {
  try {
    fs.mkdirSync(path.dirname(auditFile), { recursive: true });
    const tmp = `${auditFile}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(audit.slice(0, 500), null, 2), 'utf8');
    fs.renameSync(tmp, auditFile);
  } catch (error) {
    console.error('[AdminPanel] Failed to persist audit log:', error.message);
  }
}
function log(action, meta = {}) {
  audit.unshift({ id: crypto.randomUUID(), at: now(), action, ...meta });
  if (audit.length > 500) audit.length = 500;
  persistAudit();
}
function readYaml(file, fallback = {}) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) ?? fallback; } catch { return fallback; }
}
function readRaw(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }
function writeYamlAtomic(file, data) { const tmp = `${file}.tmp`; fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(tmp, yaml.dump(data, { noRefs: true, lineWidth: -1 }), 'utf8'); fs.renameSync(tmp, file); }
const SECRET_KEY = /^(token|secret|password|passphrase|apiKey|api_key|privateKey|private_key|webhookToken|connectionString|databaseUrl)$/i;
const REDACTED = '__REALMS_REDACTED__';
function redactSecrets(value) {
  if (Array.isArray(value)) return value.map(redactSecrets);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [key, item] of Object.entries(value)) out[key] = SECRET_KEY.test(key) ? REDACTED : redactSecrets(item);
    return out;
  }
  return value;
}
function restoreSecrets(next, current) {
  if (Array.isArray(next) || Array.isArray(current)) return next;
  if (next && typeof next === 'object' && current && typeof current === 'object') {
    for (const [key, value] of Object.entries(next)) {
      if (value === REDACTED && Object.prototype.hasOwnProperty.call(current, key)) next[key] = current[key];
      else next[key] = restoreSecrets(value, current[key]);
    }
  }
  return next;
}
function safePlainObject(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function parseCookies(header = '') {
  return Object.fromEntries(header.split(';').map(x => x.trim()).filter(Boolean).map(x => {
    const i = x.indexOf('=');
    return [i < 0 ? x : x.slice(0, i), i < 0 ? '' : decodeURIComponent(x.slice(i + 1))];
  }));
}
function safeEqual(a, b) {
  const left = Buffer.from(String(a ?? ''));
  const right = Buffer.from(String(b ?? ''));
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
function getToken(req, token) {
  const auth = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (auth && safeEqual(auth, token)) return true;
  const cookies = parseCookies(req.headers.cookie || '');
  const sid = cookies.realms_admin_session;
  const session = sid && sessions.get(sid);
  if (session && session.expires > Date.now() && safeEqual(session.token, token)) return true;
  if (sid) sessions.delete(sid);
  return false;
}
function requireAuth(req, res, token) {
  if (getToken(req, token)) return true;
  json(res, 401, { error: 'Unauthorized' });
  return false;
}
function body(req, maxBytes = 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const advertised = Number(req.headers['content-length'] || 0);
    if (advertised > maxBytes) return reject(Object.assign(new Error('Request too large'), { status: 413 }));
    let raw = '';
    let rejected = false;
    req.on('data', chunk => {
      if (rejected) return;
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        rejected = true;
        req.resume();
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
      if (rejected) return;
      if (!raw) return resolve({});
      try { resolve(JSON.parse(raw)); } catch { reject(Object.assign(new Error('Invalid JSON'), { status: 400 })); }
    });
    req.on('error', reject);
  });
}
function moduleNames() {
  const dir = path.join(root, 'modules');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).filter(x => x.isDirectory()).map(x => x.name).sort((a, b) => a.localeCompare(b));
}
function safeModule(name) { return /^[a-zA-Z0-9_-]+$/.test(name); }
function moduleEnabled(name, config) {
  return name === 'dashboard' ? config.adminPanel?.enabled === true || config.dashboard?.enabled === true : config[name]?.enabled === true;
}
function moduleInfo(name, client, config) {
  const dir = path.join(root, 'modules', name);
  const basicFile = path.join(dir, 'config.yml');
  const advancedFile = path.join(dir, 'advanced.yml');
  const basic = readYaml(basicFile, { enabled: false, advanced: false });
  return {
    name,
    enabled: moduleEnabled(name, config),
    advancedEnabled: basic.advanced === true,
    advancedFile: fs.existsSync(advancedFile),
    loaded: client.modules.has(name),
    commands: client.modules.get(name)?.definition?.commands?.length || 0,
    basic,
    advanced: readYaml(advancedFile, {})
  };
}
function guildInfo(guild) {
  return {
    id: guild.id,
    name: guild.name,
    icon: guild.iconURL({ size: 128 }),
    ownerId: guild.ownerId,
    memberCount: guild.memberCount || guild.members.cache.size,
    channels: guild.channels.cache.size,
    roles: guild.roles.cache.size,
    createdAt: guild.createdAt?.toISOString() || null
  };
}
function bootstrap(client, config) {
  const memory = process.memoryUsage();
  return {
    server: client.brand.serverName,
    bot: client.brand.botName,
    color: client.brand.color,
    version: client.framework.release,
    framework: client.framework.version,
    uptime: Math.floor((Date.now() - client.metrics.startedAt) / 1000),
    startedAt: new Date(client.metrics.startedAt).toISOString(),
    readyAt: client.metrics.readyAt ? new Date(client.metrics.readyAt).toISOString() : null,
    shards: client.ws.shards.size,
    guilds: client.guilds.cache.size,
    users: client.guilds.cache.reduce((n, g) => n + (g.memberCount || 0), 0),
    commands: client.commands.size + client.contextMenus.size,
    prefixCommands: client.prefixCommands.size,
    modulesLoaded: client.modules.size,
    modulesTotal: moduleNames().length,
    metrics: client.metrics,
    memory: { rss: memory.rss, heapUsed: memory.heapUsed, heapTotal: memory.heapTotal, external: memory.external },
    config: { environment: config.runtime?.environment || 'production', sharding: config.sharding || {}, adminPanel: config.adminPanel || {}, database: config.database ? { enabled: config.database.enabled, primary: config.database.primary } : {} },
    database: { type: config.database?.primary || 'none', remote: config.database?.primary && config.database.primary !== 'sqlite' && config.database.primary !== 'none' },
    modules: moduleNames().map(name => moduleInfo(name, client, config)),
    guildList: [...client.guilds.cache.values()].map(guildInfo).sort((a, b) => a.name.localeCompare(b.name))
  };
}
function sendFile(res, file, type) {
  if (!file || !fs.existsSync(file)) return text(res, 404, 'Not found');
  res.writeHead(200, headers(type, 'no-cache'));
  fs.createReadStream(file).pipe(res);
}
function mime(file) {
  const ext = path.extname(file);
  return { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' }[ext] || 'application/octet-stream';
}
function assetFile(name) {
  if (name === 'app.js') return path.join(webRoot, 'app.js');
  if (name === 'management.js') return path.join(webRoot, 'management.js');
  if (name === 'admin.css') return path.join(publicRoot, 'admin.css');
  return null;
}

async function initialize(client, config, moduleConfig) {
  const cfg = { ...moduleConfig, ...(config.adminPanel || {}) };
  if (cfg.enabled !== true) return;
  const tokenEnv = cfg.tokenEnv || 'DASHBOARD_TOKEN';
  const token = process.env[tokenEnv];
  if (!token) {
    console.warn(`[AdminPanel] ${tokenEnv} is not set; panel will not start.`);
    return;
  }
  const host = cfg.host || '127.0.0.1';
  const port = Number(cfg.port || 8787);
  const maxBodyBytes = Math.min(8 * 1024 * 1024, Math.max(16 * 1024, Number(cfg.maxBodyBytes || 1024 * 1024)));
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Admin panel port must be 1-65535');
  if (cfg.public === true && host === '127.0.0.1') console.warn('[AdminPanel] public=true while host=127.0.0.1; use a reverse proxy or change host deliberately.');
  loadAudit();
  cleanupTimer = setInterval(() => {
      for (const [ip, item] of loginAttempts) if (item.resetAt <= Date.now()) loginAttempts.delete(ip);
    for (const [ip, item] of requestBuckets) if (item.resetAt <= Date.now()) requestBuckets.delete(ip);
  }, 60_000);

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || host}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'realmsnetwork-admin-panel', uptime: Math.floor((Date.now() - client.metrics.startedAt) / 1000) });
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { authenticated: getToken(req, token), server: client.brand.serverName, bot: client.brand.botName });
      if (req.method === 'POST' && url.pathname === '/api/auth') {
        const ip = req.socket.remoteAddress || 'unknown';
        const nowMs = Date.now();
        const attempt = loginAttempts.get(ip);
        if (attempt && attempt.lockedUntil > nowMs) return json(res, 429, { error: 'Too many failed authentication attempts; try again later' });
        const data = await body(req, maxBodyBytes);
        if (!safeEqual(String(data.token || ''), token)) {
          const next = attempt && attempt.resetAt > nowMs ? attempt : { failures: 0, resetAt: nowMs + 5 * 60 * 1000, lockedUntil: 0 };
          next.failures += 1;
          if (next.failures >= 5) next.lockedUntil = nowMs + 10 * 60 * 1000;
          loginAttempts.set(ip, next);
          log('login_failed', { ip });
          return json(res, next.lockedUntil ? 429 : 401, { error: next.lockedUntil ? 'Too many failed authentication attempts; try again later' : 'Invalid admin token' });
        }
        loginAttempts.delete(ip);
        const sid = crypto.randomBytes(32).toString('hex');
        const hours = Math.max(1, Number(cfg.sessionHours || 8));
        if (sessions.size >= Math.min(500, Math.max(10, Number(cfg.maxSessions || 100)))) { const oldest = sessions.keys().next().value; if (oldest) sessions.delete(oldest); }
        sessions.set(sid, { token, expires: Date.now() + hours * 60 * 60 * 1000 });
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'set-cookie': `realms_admin_session=${encodeURIComponent(sid)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${Math.floor(hours * 3600)}${cfg.public === true ? '; Secure' : ''}` });
        log('login_success', { ip: req.socket.remoteAddress });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.method === 'POST' && url.pathname === '/api/logout') {
        const cookies = parseCookies(req.headers.cookie || '');
        if (cookies.realms_admin_session) sessions.delete(cookies.realms_admin_session);
        res.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'set-cookie': 'realms_admin_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
        return res.end(JSON.stringify({ ok: true }));
      }
      if (req.method === 'GET' && url.pathname.startsWith('/assets/')) {
        const name = decodeURIComponent(url.pathname.slice('/assets/'.length));
        if (!/^[a-zA-Z0-9._-]+$/.test(name)) return text(res, 403, 'Forbidden');
        const file = assetFile(name);
        if (!file) return text(res, 404, 'Not found');
        return sendFile(res, file, mime(file));
      }
      if (req.method === 'GET' && (url.pathname === '/' || url.pathname === '/admin.html')) return sendFile(res, path.join(webRoot, 'admin.html'), 'text/html; charset=utf-8');
      if (!requireAuth(req, res, token)) return;
      const ip = req.socket.remoteAddress || 'unknown';
      const bucket = requestBuckets.get(ip) || { count: 0, resetAt: Date.now() + 60_000 };
      if (bucket.resetAt <= Date.now()) { bucket.count = 0; bucket.resetAt = Date.now() + 60_000; }
      bucket.count += 1;
      requestBuckets.set(ip, bucket);
      if (bucket.count > Math.min(1000, Math.max(30, Number(cfg.requestsPerMinute || 240)))) return json(res, 429, { error: 'Rate limit exceeded' });

      const handledDiscord = await handleDiscord(req, res, url, client, cfg, () => body(req, maxBodyBytes), log);
      if (handledDiscord) return;

      if (req.method === 'GET' && url.pathname === '/api/bootstrap') return json(res, 200, bootstrap(client, config));
      if (req.method === 'GET' && url.pathname === '/api/status') return json(res, 200, { ok: true, ...bootstrap(client, config) });
      if (req.method === 'GET' && url.pathname === '/api/audit') return json(res, 200, { items: audit.slice(0, Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 100)))) });
      if (req.method === 'GET' && url.pathname === '/api/guilds') return json(res, 200, { items: [...client.guilds.cache.values()].map(guildInfo).sort((a, b) => a.name.localeCompare(b.name)) });

      if (req.method === 'POST' && url.pathname === '/api/reload') {
        if (cfg.readOnly !== false || cfg.allowReload === false) return json(res, 403, { error: 'Writes are disabled in read-only mode' });
        await refreshCommands(client, client.config);
        log('commands_reload');
        return json(res, 200, { ok: true, message: 'Command registry reloaded', commands: client.commands.size + client.contextMenus.size });
      }

      const modToggle = url.pathname.match(/^\/api\/module\/([^/]+)\/toggle$/);
      if (req.method === 'POST' && modToggle) {
        if (cfg.readOnly !== false || cfg.allowModuleToggle === false) return json(res, 403, { error: 'Module controls are disabled' });
        const name = decodeURIComponent(modToggle[1]);
        if (!safeModule(name)) return json(res, 400, { error: 'Invalid module name' });
        const data = await body(req, maxBodyBytes);
        if (name === 'dashboard' && cfg.readOnly === false && data.enabled === false) return json(res, 409, { error: 'The running admin panel cannot disable itself through its own session' });
        const moduleDir = path.join(root, 'modules', name);
        if (!fs.existsSync(moduleDir)) return json(res, 404, { error: 'Module not found' });
        const rootConfigFile = path.join(root, 'config.yml');
        if (!fs.existsSync(rootConfigFile)) return json(res, 404, { error: 'Root configuration not found' });
        const current = readYaml(rootConfigFile, {});
        if (!safePlainObject(current)) return json(res, 500, { error: 'Root configuration is invalid' });
        const key = name === 'dashboard' ? 'adminPanel' : name;
        if (!safePlainObject(current[key])) current[key] = {};
        current[key].enabled = data.enabled === true;
        writeYamlAtomic(rootConfigFile, current);
        if (!safePlainObject(client.config[key])) client.config[key] = {};
        client.config[key].enabled = current[key].enabled;
        log('module_toggle', { module: name, configKey: key, enabled: current[key].enabled });
        return json(res, 200, { ok: true, restartRequired: true, message: `${name} is now ${current.enabled ? 'enabled' : 'disabled'} in configuration. Restart is required for listener lifecycle changes.` });
      }

      const modMatch = url.pathname.match(/^\/api\/module\/([^/]+)$/);
      if (req.method === 'GET' && modMatch) {
        const name = decodeURIComponent(modMatch[1]);
        if (!safeModule(name)) return json(res, 400, { error: 'Invalid module name' });
        if (!fs.existsSync(path.join(root, 'modules', name))) return json(res, 404, { error: 'Module not found' });
        return json(res, 200, moduleInfo(name, client));
      }

      if (req.method === 'GET' && url.pathname === '/api/commands') return json(res, 200, { items: [...client.commands.values()].map(c => ({ name: c.data.name, description: c.data.description || '', cooldown: Number(c.cooldown || 0), permissionGroup: c.permissionGroup || null })).sort((a, b) => a.name.localeCompare(b.name)) });

      if (req.method === 'POST' && url.pathname === '/api/presence') {
        if (cfg.readOnly !== false) return json(res, 403, { error: 'Writes are disabled in read-only mode' });
        const data = await body(req, maxBodyBytes);
        const activity = String(data.activity || '').slice(0, 128);
        const type = Number.isInteger(data.type) ? data.type : 0;
        const status = ['online', 'idle', 'dnd', 'invisible'].includes(data.status) ? data.status : 'online';
        client.user?.setPresence({ activities: activity ? [{ name: activity, type }] : [], status });
        log('presence_update', { activity, status });
        return json(res, 200, { ok: true });
      }

      if (req.method === 'GET' && url.pathname === '/api/config') {
        const scope = url.searchParams.get('scope') || 'root';
        const name = url.searchParams.get('module') || '';
        const kind = url.searchParams.get('kind') || 'basic';
        let file;
        if (scope === 'root') file = path.join(root, 'config.yml');
        else if (scope === 'module' && safeModule(name)) {
          const dir = path.join(root, 'modules', name);
          if (!fs.existsSync(dir)) return json(res, 404, { error: 'Module not found' });
          file = path.join(dir, kind === 'advanced' ? 'advanced.yml' : 'config.yml');
        } else return json(res, 400, { error: 'Invalid config target' });
        if (!fs.existsSync(file)) return json(res, 404, { error: 'Config file not found' });
        const raw = readRaw(file);
        if (kind === 'basic' && scope === 'root') {
          let parsed;
          try { parsed = yaml.load(raw); } catch { parsed = null; }
          if (safePlainObject(parsed)) return json(res, 200, { scope, module: name, kind, content: yaml.dump(redactSecrets(parsed), { noRefs: true, lineWidth: -1 }) });
        }
        return json(res, 200, { scope, module: name, kind, content: raw });
      }

      if (req.method === 'PUT' && url.pathname === '/api/config') {
        if (cfg.readOnly === true || cfg.allowConfigWrite === false) return json(res, 403, { error: 'Configuration editing is disabled' });
        const data = await body(req, maxBodyBytes);
        const scope = String(data.scope || '');
        const name = String(data.module || '');
        const kind = String(data.kind || 'basic');
        if (!['basic', 'advanced'].includes(kind)) return json(res, 400, { error: 'Invalid config kind' });
        let file;
        if (scope === 'root') file = path.join(root, 'config.yml');
        else if (scope === 'module' && safeModule(name)) {
          const dir = path.join(root, 'modules', name);
          if (!fs.existsSync(dir)) return json(res, 404, { error: 'Module not found' });
          file = path.join(dir, kind === 'advanced' ? 'advanced.yml' : 'config.yml');
        } else return json(res, 400, { error: 'Invalid config target' });
        const content = String(data.content || '');
        if (content.length > 512 * 1024) return json(res, 413, { error: 'Configuration too large' });
        let parsed;
        try { parsed = yaml.load(content); } catch (e) { return json(res, 400, { error: `Invalid YAML: ${e.message}` }); }
        if (!safePlainObject(parsed)) return json(res, 400, { error: 'Configuration root must be a YAML mapping/object' });
        if (scope === 'module' && Object.prototype.hasOwnProperty.call(parsed, 'enabled')) return json(res, 400, { error: 'Module enable state is controlled by the root configuration' });
        const existing = readYaml(file, {});
        parsed = restoreSecrets(parsed, existing);
        writeYamlAtomic(file, parsed);
        log('config_write_validation', { scope, module: name, kind, keys: Object.keys(parsed).length });
        log('config_write', { scope, module: name, kind, restartRequired: scope === 'root' || kind === 'basic' });
        return json(res, 200, { ok: true, restartRequired: scope === 'root' || kind === 'basic', message: 'Configuration saved. Restart is required for core/bootstrap changes.' });
      }

      return json(res, 404, { error: 'Not found' });
    } catch (error) {
      console.error('[AdminPanel]', error);
      if (!res.headersSent) json(res, Number(error.status) || 500, { error: error.message || 'Internal server error' });
    }
  });
  server.listen(port, host, () => console.log(`[AdminPanel] Listening on http://${host}:${port}`));
}

async function destroy() {
  for (const [id, session] of sessions) if (session.expires <= Date.now()) sessions.delete(id);
  if (cleanupTimer) clearInterval(cleanupTimer);
  cleanupTimer = null;
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  server = null;
  sessions.clear();
}

module.exports = { initialize, destroy };
