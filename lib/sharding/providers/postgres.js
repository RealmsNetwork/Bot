class PostgresShardProvider {
  constructor(config = {}, options = {}) {
    this.config = config;
    this.instanceId = options.instanceId;
    this.hostname = options.hostname || 'localhost';
    this.pid = options.pid || process.pid;
    this.heartbeatInterval = Number(options.heartbeatInterval || config.sharding?.heartbeatInterval || 30000);
    this.timeout = Number(options.timeout || config.sharding?.timeout || 120000);
    this.key = options.key || 'realmsbot_shards';
    this.pool = null;
  }

  async connect() {
    const { Pool } = require('pg');
    const connectionString = this.config.database?.postgres?.url || process.env.DATABASE_URL;
    if (!connectionString) throw new Error('DATABASE_URL is required for PostgreSQL shard coordination');
    this.pool = new Pool({ connectionString, max: this.config.database?.postgres?.maxConnections || 5 });
    await this.pool.query(`CREATE TABLE IF NOT EXISTS ${this.key} (shard_id INTEGER PRIMARY KEY, instance_id TEXT NOT NULL, hostname TEXT NOT NULL, pid INTEGER NOT NULL, heartbeat BIGINT NOT NULL, status TEXT NOT NULL)`);
  }

  async claimShard(shardId, meta = {}) {
    const now = Date.now();
    const { rows } = await this.pool.query(`SELECT * FROM ${this.key} WHERE shard_id = $1`, [shardId]);
    const existing = rows[0];
    if (existing && existing.status === 'online' && (now - Number(existing.heartbeat || 0)) < this.timeout) {
      return false;
    }
    await this.pool.query(`INSERT INTO ${this.key} (shard_id, instance_id, hostname, pid, heartbeat, status) VALUES ($1, $2, $3, $4, $5, 'online') ON CONFLICT (shard_id) DO UPDATE SET instance_id = EXCLUDED.instance_id, hostname = EXCLUDED.hostname, pid = EXCLUDED.pid, heartbeat = EXCLUDED.heartbeat, status = EXCLUDED.status`, [shardId, meta.instanceId || this.instanceId, meta.hostname || this.hostname, meta.pid || this.pid, now]);
    return true;
  }

  async releaseShard(shardId, instanceId) {
    await this.pool.query(`DELETE FROM ${this.key} WHERE shard_id = $1 AND instance_id = $2`, [shardId, instanceId]);
    return true;
  }

  async heartbeat(shardId, instanceId) {
    const now = Date.now();
    const res = await this.pool.query(`UPDATE ${this.key} SET heartbeat = $1, status = 'online', hostname = $2, pid = $3 WHERE shard_id = $4 AND instance_id = $5`, [now, this.hostname, this.pid, shardId, instanceId]);
    return (res.rowCount || 0) > 0;
  }

  async getActiveShards() {
    const cutoff = Date.now() - this.timeout;
    const { rows } = await this.pool.query(`SELECT * FROM ${this.key} WHERE status = 'online' AND heartbeat >= $1 ORDER BY shard_id ASC`, [cutoff]);
    return rows.map((row) => ({
      shardId: Number(row.shard_id),
      instanceId: row.instance_id,
      hostname: row.hostname,
      pid: Number(row.pid),
      heartbeat: Number(row.heartbeat),
      status: row.status || 'online',
    }));
  }
}

module.exports = PostgresShardProvider;
