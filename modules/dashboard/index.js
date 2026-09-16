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

function now() { return new Date().toISOString(); }
function json(res, status, data) {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(JSON.stringify(data));
}
function text(res, status, data, type = 'text/plain; charset=utf-8') {
  if (res.headersSent) return;
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' });
  res.end(data);
}
function log(action, meta = {}) {
  audit.unshift({ id: crypto.randomUUID(), at: now(), action, ...meta });
  if (audit.length > 500) audit.length = 500;
}
function readYaml(file, fallback = {}) {
  try { return yaml.load(fs.readFileSync(file, 'utf8')) ?? fallback; } catch { return fallback; }
}
function readRaw(file) { return fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : ''; }
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
    let raw = '';
    req.on('data', chunk => {
      raw += chunk;
      if (Buffer.byteLength(raw) > maxBytes) {
        req.destroy();
        reject(Object.assign(new Error('Request too large'), { status: 413 }));
      }
    });
    req.on('end', () => {
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
function moduleInfo(name, client) {
  const dir = path.join(root, 'modules', name);
  const basicFile = path.join(dir, 'config.yml');
  const advancedFile = path.join(dir, 'advanced.yml');
  const basic = readYaml(basicFile, { enabled: false, advanced: false });
  return {
    name,
    enabled: basic.enabled === true,
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
    modules: moduleNames().map(name => moduleInfo(name, client)),
    guildList: [...client.guilds.cache.values()].map(guildInfo).sort((a, b) => a.name.localeCompare(b.name))
  };
}
function sendFile(res, file, type) {
  if (!file || !fs.existsSync(file)) return text(res, 404, 'Not found');
  res.writeHead(200, { 'content-type': type, 'cache-control': 'no-cache', 'x-content-type-options': 'nosniff' });
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
  const maxBodyBytes = Number(cfg.maxBodyBytes || 1024 * 1024);
  if (cfg.public === true && host === '127.0.0.1') console.warn('[AdminPanel] public=true while host=127.0.0.1; use a reverse proxy or change host deliberately.');

  server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || host}`);
      if (req.method === 'GET' && url.pathname === '/health') return json(res, 200, { ok: true, service: 'realmsnetwork-admin-panel', uptime: Math.floor((Date.now() - client.metrics.startedAt) / 1000) });
      if (req.method === 'GET' && url.pathname === '/api/session') return json(res, 200, { authenticated: getToken(req, token), server: client.brand.serverName, bot: client.brand.botName });
      if (req.method === 'POST' && url.pathname === '/api/auth') {
        const data = await body(req, maxBodyBytes);
        if (!safeEqual(String(data.token || ''), token)) {
          log('login_failed', { ip: req.socket.remoteAddress });
          return json(res, 401, { error: 'Invalid admin token' });
        }
        const sid = crypto.randomBytes(32).toString('hex');
        const hours = Math.max(1, Number(cfg.sessionHours || 8));
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
        const file = path.join(root, 'modules', name, 'config.yml');
        if (!fs.existsSync(file)) return json(res, 404, { error: 'Module not found' });
        const data = await body(req, maxBodyBytes);
        const current = readYaml(file, { enabled: false });
        current.enabled = data.enabled === true;
        fs.writeFileSync(file, yaml.dump(current, { noRefs: true, lineWidth: -1 }), 'utf8');
        log('module_toggle', { module: name, enabled: current.enabled });
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
        else if (scope === 'module' && safeModule(name)) file = path.join(root, 'modules', name, kind === 'advanced' ? 'advanced.yml' : 'config.yml');
        else return json(res, 400, { error: 'Invalid config target' });
        if (!fs.existsSync(file)) return json(res, 404, { error: 'Config file not found' });
        return json(res, 200, { scope, module: name, kind, content: readRaw(file) });
      }

      if (req.method === 'PUT' && url.pathname === '/api/config') {
        if (cfg.readOnly === true || cfg.allowConfigWrite === false) return json(res, 403, { error: 'Configuration editing is disabled' });
        const data = await body(req, maxBodyBytes);
        const scope = String(data.scope || '');
        const name = String(data.module || '');
        const kind = String(data.kind || 'basic');
        let file;
        if (scope === 'root') file = path.join(root, 'config.yml');
        else if (scope === 'module' && safeModule(name)) file = path.join(root, 'modules', name, kind === 'advanced' ? 'advanced.yml' : 'config.yml');
        else return json(res, 400, { error: 'Invalid config target' });
        const content = String(data.content || '');
        if (content.length > 512 * 1024) return json(res, 413, { error: 'Configuration too large' });
        try { yaml.load(content); } catch (e) { return json(res, 400, { error: `Invalid YAML: ${e.message}` }); }
        fs.writeFileSync(file, content, 'utf8');
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
  await new Promise(resolve => server ? server.close(resolve) : resolve());
  server = null;
  sessions.clear();
}

module.exports = { initialize, destroy };
