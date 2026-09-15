const fs = require('node:fs');
const path = require('node:path');

const localFile = path.join(__dirname, '..', 'data', 'kv.json');
const sqliteFile = path.join(__dirname, '..', 'data', 'realmsbot.sqlite');
let local = {};

function loadLocal() { try { local = JSON.parse(fs.readFileSync(localFile, 'utf8')); } catch { local = {}; } }
function saveLocal() { fs.mkdirSync(path.dirname(localFile), { recursive: true }); const tmp = `${localFile}.tmp`; fs.writeFileSync(tmp, JSON.stringify(local, null, 2)); fs.renameSync(tmp, localFile); }
function key(guildId, keyName) { return `${guildId}:${keyName}`; }
function remote(type) { return ['redis', 'mongodb', 'mysql', 'postgres'].includes(type); }

async function createDatabase(config) {
  loadLocal();
  const db = { type: 'none', client: null, mongo: null, sqlite: null };
  const root = config.database || {};
  if (root.enabled !== true) return api(db);
  const provider = String(root.primary || 'none').toLowerCase();
  try {
    if (provider === 'sqlite') {
      const BetterSqlite3 = require('better-sqlite3');
      fs.mkdirSync(path.dirname(root.sqlite?.path || sqliteFile), { recursive: true });
      db.sqlite = new BetterSqlite3(root.sqlite?.path || sqliteFile);
      db.sqlite.pragma(`journal_mode = ${root.sqlite?.journalMode || 'WAL'}`);
      db.sqlite.pragma('foreign_keys = ON');
      db.sqlite.exec('CREATE TABLE IF NOT EXISTS bot_kv (guild_id TEXT NOT NULL, k TEXT NOT NULL, v TEXT NOT NULL, updated_at INTEGER NOT NULL, PRIMARY KEY (guild_id,k))');
      db.type = 'sqlite';
    } else if (provider === 'redis') {
      const { createClient } = require('redis');
      const client = createClient({ url: root.redis?.url || process.env.REDIS_URL || 'redis://127.0.0.1:6379' });
      client.on('error', e => console.error('[Redis]', e.message)); await client.connect(); db.type = 'redis'; db.client = client;
    } else if (provider === 'mongodb') {
      const { MongoClient } = require('mongodb'); const client = new MongoClient(root.mongodb?.url || process.env.MONGODB_URI); await client.connect(); db.type = 'mongodb'; db.client = client; db.mongo = client.db(root.mongodb?.database || 'realmsbot');
    } else if (provider === 'mysql') {
      const mysql = require('mysql2/promise'); db.type = 'mysql'; db.client = mysql.createPool({ uri: root.mysql?.url || process.env.MYSQL_URL, waitForConnections: true, connectionLimit: root.mysql?.connectionLimit || 5 }); await db.client.query('CREATE TABLE IF NOT EXISTS bot_kv (guild_id VARCHAR(64) NOT NULL, k VARCHAR(191) NOT NULL, v LONGTEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (guild_id,k))');
    } else if (provider === 'postgres') {
      const { Pool } = require('pg'); db.type = 'postgres'; db.client = new Pool({ connectionString: root.postgres?.url || process.env.DATABASE_URL, max: root.postgres?.maxConnections || 5 }); await db.client.query('CREATE TABLE IF NOT EXISTS bot_kv (guild_id VARCHAR(64) NOT NULL, k VARCHAR(191) NOT NULL, v TEXT NOT NULL, updated_at BIGINT NOT NULL, PRIMARY KEY (guild_id,k))');
    } else return api(db);
    console.log(`[Database] Connected to ${db.type}${remote(db.type) ? ' (remote)' : ''}`);
  } catch (e) {
    console.error(`[Database] ${provider} failed:`, e.message);
    if (root.fallbackToLocal !== false) { console.warn('[Database] Falling back to local JSON storage.'); db.type = 'none'; db.client = null; db.mongo = null; db.sqlite = null; } else throw e;
  }
  return api(db);
}

function api(db) {
  return {
    get type() { return db.type; },
    get isRemote() { return remote(db.type); },
    async get(guildId, k, fallback = null) {
      try {
        const id = key(guildId, k);
        if (db.type === 'sqlite') { const row = db.sqlite.prepare('SELECT v FROM bot_kv WHERE guild_id=? AND k=?').get(String(guildId), k); return row ? JSON.parse(row.v) : fallback; }
        if (db.type === 'redis') { const v = await db.client.get(id); return v == null ? fallback : JSON.parse(v); }
        if (db.type === 'mongodb') { const row = await db.mongo.collection('bot_kv').findOne({ guildId: String(guildId), key: k }); return row ? row.value : fallback; }
        if (db.type === 'mysql') { const [rows] = await db.client.query('SELECT v FROM bot_kv WHERE guild_id=? AND k=?', [String(guildId), k]); return rows[0] ? JSON.parse(rows[0].v) : fallback; }
        if (db.type === 'postgres') { const { rows } = await db.client.query('SELECT v FROM bot_kv WHERE guild_id=$1 AND k=$2', [String(guildId), k]); return rows[0] ? JSON.parse(rows[0].v) : fallback; }
        return Object.prototype.hasOwnProperty.call(local, id) ? local[id] : fallback;
      } catch (error) { console.error('[Database] get failed:', error.message); return fallback; }
    },
    async set(guildId, k, value) {
      const id = key(guildId, k), serialized = JSON.stringify(value), now = Date.now();
      if (db.type === 'sqlite') { db.sqlite.prepare('INSERT INTO bot_kv (guild_id,k,v,updated_at) VALUES (?,?,?,?) ON CONFLICT(guild_id,k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at').run(String(guildId), k, serialized, now); return value; }
      if (db.type === 'redis') return db.client.set(id, serialized);
      if (db.type === 'mongodb') { await db.mongo.collection('bot_kv').updateOne({ guildId: String(guildId), key: k }, { $set: { value, updatedAt: now } }, { upsert: true }); return value; }
      if (db.type === 'mysql') { await db.client.query('INSERT INTO bot_kv (guild_id,k,v,updated_at) VALUES (?,?,?,?) ON DUPLICATE KEY UPDATE v=VALUES(v), updated_at=VALUES(updated_at)', [String(guildId), k, serialized, now]); return value; }
      if (db.type === 'postgres') { await db.client.query('INSERT INTO bot_kv (guild_id,k,v,updated_at) VALUES ($1,$2,$3,$4) ON CONFLICT (guild_id,k) DO UPDATE SET v=EXCLUDED.v, updated_at=EXCLUDED.updated_at', [String(guildId), k, serialized, now]); return value; }
      local[id] = value; saveLocal(); return value;
    },
    async delete(guildId, k) {
      const id = key(guildId, k);
      if (db.type === 'sqlite') { db.sqlite.prepare('DELETE FROM bot_kv WHERE guild_id=? AND k=?').run(String(guildId), k); return true; }
      if (db.type === 'redis') { await db.client.del(id); return true; }
      if (db.type === 'mongodb') { await db.mongo.collection('bot_kv').deleteOne({ guildId: String(guildId), key: k }); return true; }
      if (db.type === 'mysql') { await db.client.query('DELETE FROM bot_kv WHERE guild_id=? AND k=?', [String(guildId), k]); return true; }
      if (db.type === 'postgres') { await db.client.query('DELETE FROM bot_kv WHERE guild_id=$1 AND k=$2', [String(guildId), k]); return true; }
      delete local[id]; saveLocal(); return true;
    },
    async increment(guildId, k, amount = 1) { const value = Number(await this.get(guildId, k, 0)) + Number(amount); await this.set(guildId, k, value); return value; },
    async close() { try { if (db.type === 'sqlite') db.sqlite.close(); else if (db.type === 'redis') await db.client.quit(); else if (db.type === 'mongodb') await db.client.close(); else if (db.type === 'mysql') await db.client.end(); else if (db.type === 'postgres') await db.client.end(); } catch {} }
  };
}

module.exports = { createDatabase };
